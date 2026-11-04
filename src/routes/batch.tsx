import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import JSZip from "jszip"
import {
  Layers,
  UploadCloud,
  FileArchive,
  Download,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FileImage,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CardGroup, Card } from "@/components/ui/card"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import { removeBackground } from "@/lib/bg-removal"
import { RightSidebarPanel } from "@/components/layout/right-sidebar"
import { ModelPicker } from "@/components/studio/model-picker"
import { AuditPanel } from "@/components/studio/audit-panel"
import { PanelCard, PanelTabs, PillTabs, TabPane, FieldLabel, FileBar, type PanelTab } from "@/components/studio/chrome"
import { ModelLoadBar } from "@/components/studio/model-load-bar"
import { PACK_SPECS, canvasBlob, renderPackImage } from "@/lib/pack"
import { qaProductPhoto, verifyMask } from "@/lib/muse"
import { getMetaKey, segmentConcept } from "@/lib/meta"
import { MetaKeyField } from "@/components/studio/meta-key-field"
import { recordRun } from "@/lib/run-info"
import { parseTemplateCsv, templateFor, type TemplateRow } from "@/lib/template-csv"

export const Route = createFileRoute("/batch")({
  component: BatchStudioPage,
})

/**
 * "Pick object" matte for one photo: SAM 3.1 finds the concept in a
 * downscaled copy, the mask is scaled back to full resolution, and it becomes
 * the alpha channel of the original (inverted for "remove it, keep the rest").
 */
async function samCutout(file: File, concept: string, key: string, invert: boolean) {
  const bitmap = await createImageBitmap(file)
  const width = bitmap.width
  const height = bitmap.height
  const out = document.createElement("canvas")
  out.width = width
  out.height = height
  const ctx = out.getContext("2d", { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  const sam = await segmentConcept(out, concept, key)
  if (sam.objects.length === 0) throw new Error(`No "${concept}" found in this photo`)

  const maskCanvas = document.createElement("canvas")
  maskCanvas.width = sam.width
  maskCanvas.height = sam.height
  const mctx = maskCanvas.getContext("2d")!
  const mimg = mctx.createImageData(sam.width, sam.height)
  for (let i = 0, j = 3; i < sam.mask.length; i++, j += 4) mimg.data[j] = sam.mask[i] ? 255 : 0
  mctx.putImageData(mimg, 0, 0)

  // Scaling the mask up with smoothing gives a slightly soft edge.
  const full = document.createElement("canvas")
  full.width = width
  full.height = height
  const fctx = full.getContext("2d", { willReadFrequently: true })!
  fctx.imageSmoothingEnabled = true
  fctx.imageSmoothingQuality = "high"
  fctx.drawImage(maskCanvas, 0, 0, width, height)
  const maskData = fctx.getImageData(0, 0, width, height).data

  const img = ctx.getImageData(0, 0, width, height)
  const alpha = new Uint8Array(width * height)
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) {
    const a = invert ? 255 - maskData[j] : maskData[j]
    alpha[i] = a
    img.data[j] = a
  }
  ctx.putImageData(img, 0, 0)
  return { cutoutCanvas: out, alpha, width, height }
}

interface BatchItem {
  id: string
  file: File
  name: string
  previewUrl: string
  status: "pending" | "processing" | "done" | "failed"
  error?: string
  cutoutBlob?: Blob
  cutoutDataUrl?: string
  cutoutCanvas?: HTMLCanvasElement
  width?: number
  height?: number
  duration?: string
  /** Measured QA: subject share of frame, and how much of the edge is soft. */
  coverage?: number
  softEdge?: number
  /** Muse Spark vision QA line, when the user asked for it (BYOK). */
  aiQa?: string
}

function BatchStudioPage() {
  const [panelTab, setPanelTab] = React.useState<PanelTab>("edit")
  // Subject: the whole subject on this device, or one named object via SAM 3.1.
  const [subjectMode, setSubjectMode] = React.useState<"auto" | "pick">("auto")
  const [samPrompt, setSamPrompt] = React.useState("")
  const [samInvert, setSamInvert] = React.useState(false)
  const [hasKey, setHasKey] = React.useState(() => !!getMetaKey())
  const [items, setItems] = React.useState<BatchItem[]>([])
  const [isProcessingBatch, setIsProcessingBatch] = React.useState(false)
  const [isZipping, setIsZipping] = React.useState(false)
  const [activeItemIndex, setActiveItemIndex] = React.useState<number>(-1)

  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const csvInputRef = React.useRef<HTMLInputElement>(null)
  const [templateRows, setTemplateRows] = React.useState<TemplateRow[]>([])
  const [templateNote, setTemplateNote] = React.useState<string | null>(null)

  const loadTemplateCsv = async (file: File) => {
    const rows = parseTemplateCsv(await file.text())
    setTemplateRows(rows)
    setTemplateNote(
      rows.length
        ? `Template loaded: ${rows.length} row(s). Captions and colours apply in the Seller Pack.`
        : "No usable rows — the CSV needs a file column (file,caption,color)."
    )
  }

  const addFiles = (files: File[]) => {
    const valid = files.filter((f) => f.type.startsWith("image/"))
    const newItems: BatchItem[] = valid.map((f) => ({
      id: "batch_" + Math.random().toString(36).substring(2, 9),
      file: f,
      name: f.name.replace(/\.[^/.]+$/, ""),
      previewUrl: URL.createObjectURL(f),
      status: "pending",
    }))
    setItems((prev) => [...prev, ...newItems])
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    addFiles(Array.from(e.dataTransfer.files))
  }

  const startBatch = async () => {
    if (isProcessingBatch) return
    setIsProcessingBatch(true)

    for (let i = 0; i < items.length; i++) {
      if (items[i].status === "done") continue

      setActiveItemIndex(i)
      setItems((prev) =>
        prev.map((item, idx) =>
          idx === i ? { ...item, status: "processing" } : item
        )
      )

      try {
        const pickKey = subjectMode === "pick" && samPrompt.trim() ? getMetaKey() : null
        if (subjectMode === "pick" && samPrompt.trim() && !pickKey) {
          throw new Error("Add your Meta key under Edit → Subject first")
        }
        const t0 = performance.now()
        const result = pickKey
          ? await samCutout(items[i].file, samPrompt.trim(), pickKey, samInvert)
          : await removeBackground(items[i].file)
        if (pickKey) {
          recordRun({
            action: `Batch SAM "${samPrompt.trim()}"`,
            model: "SAM 3.1",
            where: "cloud",
            ms: performance.now() - t0,
            cost: 0.01,
            detail: items[i].name,
          })
        }
        const blob = await new Promise<Blob>((res) =>
          result.cutoutCanvas.toBlob((b) => res(b!), "image/png")
        )
        const dataUrl = result.cutoutCanvas.toDataURL("image/png")

        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: "done",
                  cutoutBlob: blob,
                  cutoutDataUrl: dataUrl,
                  cutoutCanvas: result.cutoutCanvas,
                  width: result.width,
                  height: result.height,
                  duration: "duration" in result ? result.duration : undefined,
                  coverage: verifyMask(result.alpha).coverage,
                  softEdge: verifyMask(result.alpha).softEdge,
                }
              : item
          )
        )
      } catch (err: any) {
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: "failed",
                  error: err.message || "Failed to segment",
                }
              : item
          )
        )
      }
    }

    setIsProcessingBatch(false)
    setActiveItemIndex(-1)
  }

  const downloadAllZip = async () => {
    const doneItems = items.filter((i) => i.status === "done" && i.cutoutBlob)
    if (!doneItems.length) return

    setIsZipping(true)
    try {
      const zip = new JSZip()
      for (const item of doneItems) {
        zip.file(`${item.name}-no-bg.png`, item.cutoutBlob!)
      }
      const zipBlob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a")
      a.href = url
      a.download = `remove-free-batch-${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      console.error("ZIP creation error:", e)
    } finally {
      setIsZipping(false)
    }
  }

  const [isPacking, setIsPacking] = React.useState(false)

  /** Marketplace pack: every done cutout rendered to each spec, plus a QA manifest. */
  const downloadPack = async () => {
    const doneItems = items.filter((i) => i.status === "done" && i.cutoutCanvas)
    if (!doneItems.length || isPacking) return
    setIsPacking(true)
    try {
      const zip = new JSZip()
      const manifest: Array<Record<string, unknown>> = []
      for (const item of doneItems) {
        const template = templateFor(templateRows, item.name)
        for (const spec of PACK_SPECS) {
          const rendered = renderPackImage(item.cutoutCanvas!, spec, {
            background: template?.color,
            caption: template?.caption,
            badge: template?.badge,
          })
          // White-ground specs need no alpha, so JPEG keeps the pack small
          // enough to be a practical download (PNGs at 2000px are several
          // times larger for the same pixels).
          zip.file(`${item.name}-${spec.id}.jpg`, await canvasBlob(rendered, "image/jpeg"))
        }
        zip.file(`${item.name}-transparent.png`, item.cutoutBlob!)
        manifest.push({
          file: item.name,
          width: item.width,
          height: item.height,
          subjectCoveragePct: item.coverage,
          softEdgePct: item.softEdge,
          specs: PACK_SPECS.map((s) => s.id),
          template: template ?? null,
        })
      }
      zip.file("manifest.json", JSON.stringify(manifest, null, 2))
      const zipBlob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(zipBlob)
      const a = document.createElement("a")
      a.href = url
      a.download = `remove-free-seller-pack-${Date.now()}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) {
      console.error("Pack creation error:", e)
    } finally {
      setIsPacking(false)
    }
  }

  const [qaBusy, setQaBusy] = React.useState(false)
  const [qaNote, setQaNote] = React.useState<string | null>(null)

  /** Opt-in vision QA: sends a 512px white-ground copy of each cutout to Muse. */
  const runAiQa = async () => {
    const key = getMetaKey()
    if (!key) {
      setQaNote("Add your Meta API key in AI Studio first — QA uses it, and sends a 512px copy per photo.")
      return
    }
    const targets = items.filter((i) => i.status === "done" && i.cutoutCanvas && !i.aiQa)
    if (!targets.length || qaBusy) return
    setQaBusy(true)
    setQaNote(null)
    try {
      for (const item of targets) {
        const src = item.cutoutCanvas!
        const thumb = document.createElement("canvas")
        const scale = Math.min(1, 512 / Math.max(src.width, src.height))
        thumb.width = Math.max(1, Math.round(src.width * scale))
        thumb.height = Math.max(1, Math.round(src.height * scale))
        const tctx = thumb.getContext("2d")!
        tctx.fillStyle = "#ffffff"
        tctx.fillRect(0, 0, thumb.width, thumb.height)
        tctx.drawImage(src, 0, 0, thumb.width, thumb.height)
        const flags = await qaProductPhoto(thumb.toDataURL("image/jpeg", 0.85), key)
        setItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, aiQa: flags } : p))
        )
      }
    } catch (err: any) {
      setQaNote(err?.message || "AI QA failed.")
    } finally {
      setQaBusy(false)
    }
  }

  const clearAll = () => {
    setItems([])
  }

  const totalCount = items.length
  const doneCount = items.filter((i) => i.status === "done").length
  const progressPct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0

  const exportActions = items.length > 0 && doneCount > 0

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden select-none">
      <FileBar
        name="Batch Studio"
        detail={items.length ? `(${doneCount} of ${totalCount} done)` : "Unlimited bulk cutouts · on-device"}
        actions={
          items.length > 0 ? (
            <>
              <Button variant="ghost" size="compact" onClick={clearAll} disabled={isProcessingBatch} className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground">
                <Trash2 className="size-3" /> Clear
              </Button>
              {isProcessingBatch ? (
                <ThinkingIndicator size="compact" words={[`Processing ${activeItemIndex + 1} of ${totalCount}...`]} />
              ) : (
                <Button size="compact" variant="primary" onClick={startBatch} disabled={doneCount === totalCount} className="h-7 text-[11px] gap-1.5">
                  <Sparkles className="size-3" /> Start Batch
                </Button>
              )}
            </>
          ) : null
        }
      />

      <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
      {/* Dropping a file here loads the same model the studio uses, and this
          page used to show nothing at all while 109 MiB came down. */}
      <ModelLoadBar className="rounded-2xl" />

      {qaNote && (
        <p className="text-[11px] leading-snug text-warn px-1">{qaNote}</p>
      )}

      {/* Multi-file Dropzone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className={"rounded-2xl transition-colors duration-80 cursor-pointer flex flex-col items-center justify-center text-center group bg-surface-2/70 hover:bg-surface-3 shadow-surface-1 " + (items.length > 0 ? "p-4" : "p-10")}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(Array.from(e.target.files))
          }}
        />

        <div className="size-12 rounded-xl bg-surface-3 flex items-center justify-center text-foreground mb-3 group-hover:scale-105 transition-transform duration-80 shadow-surface-1">
          <UploadCloud className="size-6" />
        </div>

        <h2 className="text-sm sm:text-base font-semibold text-foreground mb-0.5">
          Drop multiple images here to batch process
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Select or drag 10, 50, or 100 photos at once.
        </p>

        {/* The keyboard path in. The surrounding zone stays clickable for the
            mouse, but a click target has to be a real control for anyone who
            isn't using one — same pattern as the studio dropzone. */}
        <Button size="compact" variant="primary">
          <FileImage className="size-3.5" /> Select Images
        </Button>
      </div>

      {items.length > 0 && (
        <div className="space-y-1.5 px-1">
          <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
            <span>{doneCount} of {totalCount} completed</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full bg-surface-3 rounded-full overflow-hidden">
            <div className="h-full bg-foreground transition-all duration-160 rounded-full" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {/* Queue Grid using CardGroup with Proximity Hover */}
      {items.length > 0 && (
        <CardGroup axis="xy" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((item, idx) => (
            <Card
              key={item.id}
              index={idx}
              className={`p-0 overflow-hidden flex flex-col transition-all ${
                item.status === "processing" ? "ring-2 ring-[color:var(--focus-ring,#6B97FF)]" : ""
              }`}
            >
              {/* Thumbnail Container */}
              <div className="relative aspect-square w-full bg-checkered overflow-hidden border-b border-border/40 flex items-center justify-center">
                {item.status === "done" && item.cutoutDataUrl ? (
                  <img
                    src={item.cutoutDataUrl}
                    alt={item.name}
                    className="w-full h-full object-contain p-2"
                  />
                ) : (
                  <img
                    src={item.previewUrl}
                    alt={item.name}
                    className={`w-full h-full object-cover ${
                      item.status === "processing" ? "opacity-60 blur-xs" : ""
                    }`}
                  />
                )}

                {/* Status Overlays */}
                {item.status === "processing" && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex flex-col items-center justify-center text-white gap-2">
                    <ThinkingIndicator size="compact" showIcon={true} />
                  </div>
                )}

                {item.status === "done" && (
                  <div className="absolute top-2 right-2">
                    <Badge variant="success" dot={true} className="text-[10px]">
                      Cutout Ready
                    </Badge>
                  </div>
                )}

                {item.status === "failed" && (
                  <div className="absolute top-2 right-2">
                    <Badge variant="destructive" dot={true} className="text-[10px]">
                      Failed
                    </Badge>
                  </div>
                )}
              </div>

              {/* Item Details */}
              <div className="p-3 flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate text-foreground [text-box:trim-both_cap_alphabetic]">
                    {item.name}
                  </div>
                  <div className="text-[11px] text-muted-foreground font-mono">
                    {item.duration ? `${item.width}×${item.height} · ${item.duration}s` : `${(item.file.size / 1024).toFixed(0)} KB`}
                  </div>
                  {item.coverage !== undefined && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      subject {item.coverage}% · soft edge {item.softEdge}%
                    </div>
                  )}
                  {item.aiQa && (
                    <div
                      className={
                        "text-[10px] font-mono " +
                        (item.aiQa === "OK" ? "text-ok" : "text-warn")
                      }
                    >
                      AI QA: {item.aiQa}
                    </div>
                  )}
                  {(() => {
                    const t = templateFor(templateRows, item.name)
                    return t ? (
                      <div className="text-[10px] font-mono text-muted-foreground truncate">
                        template: {t.caption ?? "—"}
                        {t.color ? ` · ${t.color}` : ""}
                      </div>
                    ) : null
                  })()}
                </div>

                {item.status === "done" && item.cutoutBlob && (
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      const url = URL.createObjectURL(item.cutoutBlob!)
                      const a = document.createElement("a")
                      a.href = url
                      a.download = `${item.name}-no-bg.png`
                      a.click()
                      setTimeout(() => URL.revokeObjectURL(url), 5000)
                    }}
                    title="Download this cutout"
                  >
                    <Download className="size-3.5" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </CardGroup>
      )}
      </div>

      <RightSidebarPanel title="Batch Controls">
        <PanelTabs value={panelTab} onChange={setPanelTab} tabs={["edit", "model", "export", "audit"]} />

        <TabPane active={panelTab} tab="edit">
          <PanelCard
            id="batch-subject"
            title="Subject"
            icon={Sparkles}
            defaultOpen
            autoOpen={subjectMode === "pick"}
            summary={subjectMode === "pick" ? (samPrompt.trim() ? `Pick: ${samPrompt.trim()}${samInvert ? " (removed)" : ""}` : "Pick object") : "Whole subject"}
          >
            <PillTabs
              ariaLabel="Subject mode"
              className="w-full"
              value={subjectMode === "auto" ? 0 : 1}
              onChange={(i) => setSubjectMode(i === 0 ? "auto" : "pick")}
              items={[{ label: "Whole subject" }, { label: "Pick object", icon: Sparkles }]}
            />
            {subjectMode === "auto" ? (
              <p className="text-[10px] leading-snug text-muted-foreground">
                Each photo's main subject is matted on this device. Nothing is uploaded.
                Choose <span className="text-foreground">Pick object</span> to keep one
                specific thing in every photo, like "shoe".
              </p>
            ) : !hasKey ? (
              <MetaKeyField
                onSaved={() => setHasKey(true)}
                hint="Pick object uses SAM 3.1. Your key stays in this browser and goes only to api.meta.ai."
              />
            ) : (
              <div className="space-y-2">
                <input
                  type="text"
                  value={samPrompt}
                  onChange={(e) => setSamPrompt(e.target.value)}
                  placeholder="What should we keep in every photo? e.g. shoe"
                  aria-label="Object to keep in every photo"
                  disabled={isProcessingBatch}
                  className="w-full h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-40"
                />
                <div className="flex flex-wrap gap-1">
                  {["person", "shoe", "bag", "product", "car"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSamPrompt(c)}
                      className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-80"
                    >
                      {c}
                    </button>
                  ))}
                </div>
                <PillTabs
                  ariaLabel="Keep or remove the object"
                  value={samInvert ? 1 : 0}
                  onChange={(i) => setSamInvert(i === 1)}
                  items={[{ label: "Keep it" }, { label: "Remove it" }]}
                />
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Sends a downscaled copy of each photo to Meta, one request per photo
                  (about $0.01 each). Photos with no match are marked failed. SAM edges are
                  hard, trading hair softness for picking the right object.
                </p>
                {doneCount > 0 && (
                  <Button
                    size="compact"
                    variant="outline"
                    className="w-full h-7 text-[11px]"
                    disabled={isProcessingBatch}
                    onClick={() =>
                      setItems((prev) =>
                        prev.map((it) => ({ ...it, status: "pending", error: undefined }))
                      )
                    }
                  >
                    Re-run all photos with this subject
                  </Button>
                )}
              </div>
            )}
          </PanelCard>

<PanelCard
            id="batch-template"
            title="Spreadsheet template"
            icon={FileArchive}
            summary={templateRows.length ? `${templateRows.length} rows` : "None loaded"}
            autoOpen={templateRows.length > 0}
          >
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void loadTemplateCsv(f)
              }}
            />
            <Button variant="outline" size="compact" onClick={() => csvInputRef.current?.click()} className="w-full gap-1.5 text-[11px]">
              <FileArchive className="size-3.5" />
              {templateRows.length ? `Template CSV (${templateRows.length} rows)` : "Load template CSV"}
            </Button>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Columns: file, caption, color — one row per product, applied in the Seller Pack.
            </p>
            {templateNote && <p className="text-[10px] text-muted-foreground">{templateNote}</p>}
          </PanelCard>
        </TabPane>

        <TabPane active={panelTab} tab="model">
          <ModelPicker />
        </TabPane>

        <TabPane active={panelTab} tab="export">
          <div className="space-y-2">
            <FieldLabel>Download</FieldLabel>
            <Button variant="secondary" size="compact" onClick={downloadAllZip} disabled={!exportActions || isZipping} className="w-full gap-1.5">
              <FileArchive className="size-3.5" />
              {isZipping ? "Zipping..." : `Download ZIP (${doneCount})`}
            </Button>
            <Button variant="primary" size="compact" onClick={downloadPack} disabled={!exportActions || isPacking} className="w-full gap-1.5" title="Amazon + Shopify squares on white, with a QA manifest">
              <FileArchive className="size-3.5" />
              {isPacking ? "Packing..." : "Seller Pack"}
            </Button>
            <Button variant="outline" size="compact" onClick={runAiQa} disabled={!exportActions || qaBusy} className="w-full gap-1.5" title="Muse Spark looks at each cutout (sends a 512px copy)">
              <Sparkles className="size-3.5" />
              {qaBusy ? "Checking..." : "AI QA"}
            </Button>
            {!exportActions && (
              <p className="text-[10px] leading-snug text-muted-foreground">Exports unlock once at least one cutout is ready.</p>
            )}
          </div>
        </TabPane>

        <TabPane active={panelTab} tab="audit">
          <AuditPanel />
        </TabPane>
      </RightSidebarPanel>
    </div>
  )
}
