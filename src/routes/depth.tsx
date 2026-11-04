import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  Mountain,
  AlertTriangle,
  Download,
  ExternalLink,
  Play,
  ImageIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Slider } from "@/components/ui/slider"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { RightSidebarPanel } from "@/components/layout/right-sidebar"
import { useBackend } from "@/hooks/use-backend"
import { formatBytes } from "@/lib/models"
import {
  DEPTH_MODELS,
  DEFAULT_DEPTH_MODEL_ID,
  depthModelById,
} from "@/lib/depth-models"
import {
  estimateDepth,
  addDepthStatusListener,
  type DepthMap,
  type DepthStatus,
} from "@/lib/depth"
import {
  renderDepth,
  depthStats,
  DEFAULT_TONE,
  type DepthToneOptions,
  type DepthView,
} from "@/lib/depth-render"

export const Route = createFileRoute("/depth")({
  component: DepthPage,
})

const SAMPLES = [
  { name: "Portrait", url: "/samples/portrait.jpg" },
  { name: "Sneakers", url: "/samples/sneakers.jpg" },
  { name: "Golden Retriever", url: "/samples/retriever.jpg" },
  { name: "Sports Car", url: "/samples/car.jpg" },
]

const VIEWS: { value: DepthView; label: string }[] = [
  { value: "grey", label: "Grey" },
  { value: "viridis", label: "Viridis" },
  { value: "turbo", label: "Turbo" },
  { value: "magma", label: "Magma" },
  { value: "normals", label: "Normals" },
]

/**
 * Working resolution.
 *
 * Depth Anything resizes its input to 518 internally, so anything above that
 * is thrown away by the model and paid for twice — once in `getImageData` and
 * once in the worker transfer. 512 is the honest default; the higher options
 * exist because the map is upsampled on export and a larger input does give
 * the resize slightly more to work with at the edges.
 */
const RESOLUTIONS = [384, 512, 768, 1024]

function DepthPage() {
  const backend = useBackend()

  const [modelId, setModelId] = React.useState(DEFAULT_DEPTH_MODEL_ID)
  const [view, setView] = React.useState<DepthView>("viridis")
  const [tone, setTone] = React.useState<DepthToneOptions>(DEFAULT_TONE)
  const [maxEdge, setMaxEdge] = React.useState(512)

  const [status, setStatus] = React.useState<DepthStatus>({ kind: "idle" })
  const [depth, setDepth] = React.useState<DepthMap | null>(null)
  const [sourceName, setSourceName] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const sourceCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const outRef = React.useRef<HTMLCanvasElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const model = depthModelById(modelId)
  const variant = model.variants[backend]
  const busy = status.kind === "loading" || status.kind === "estimating"

  React.useEffect(() => addDepthStatusListener(setStatus), [])

  /** Paint whatever we have into the output canvas. */
  React.useEffect(() => {
    const canvas = outRef.current
    if (!canvas || !depth) return
    canvas.width = depth.width
    canvas.height = depth.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const rgba = renderDepth(depth.data, depth.width, depth.height, view, tone)
    ctx.putImageData(new ImageData(rgba, depth.width, depth.height), 0, 0)
  }, [depth, view, tone])

  const run = React.useCallback(
    async (canvas: HTMLCanvasElement, name: string) => {
      sourceCanvasRef.current = canvas
      setSourceName(name)
      setError(null)
      setDepth(null)
      try {
        setDepth(await estimateDepth(canvas, maxEdge, modelId))
      } catch (e: any) {
        setError(e?.message || "Depth estimation failed")
      }
    },
    [maxEdge, modelId]
  )

  const loadFrom = React.useCallback(
    async (src: string, name: string) => {
      setError(null)
      try {
        const img = new Image()
        img.crossOrigin = "anonymous"
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error(`Could not load ${name}`))
          img.src = src
        })
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext("2d")?.drawImage(img, 0, 0)
        await run(canvas, name)
      } catch (e: any) {
        setError(e?.message || "Could not load that image")
      }
    },
    [run]
  )

  const onFile = (file: File) => {
    const url = URL.createObjectURL(file)
    void loadFrom(url, file.name.replace(/\.[^/.]+$/, "")).finally(() =>
      URL.revokeObjectURL(url)
    )
  }

  /** Re-run when the model or resolution changes, if there is something to run on. */
  const rerun = () => {
    const canvas = sourceCanvasRef.current
    if (canvas && sourceName) void run(canvas, sourceName)
  }

  const download = () => {
    const canvas = outRef.current
    if (!canvas) return
    const a = document.createElement("a")
    a.download = `${sourceName || "image"}-depth-${view}.png`
    a.href = canvas.toDataURL("image/png")
    a.click()
  }

  const stats = React.useMemo(
    () => (depth ? depthStats(depth.data) : null),
    [depth]
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Mountain className="size-4" />
          Depth Maps
          <Badge variant="secondary" dot={true} className="text-[10px]">
            {backend === "webgpu" ? "WebGPU" : "WASM CPU"}
          </Badge>
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
          A depth map from a single photograph, on this device. Export it as
          greyscale for a displacement or parallax pass, as a colour ramp to
          look at, or as a tangent-space normal map. Nothing is uploaded.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2">
          <AlertTriangle className="size-3.5 text-warn mt-0.5 shrink-0" />
          <p className="text-[11px] leading-snug text-warn">{error}</p>
        </div>
      )}

      {status.kind === "loading" && (
        <div className="space-y-1.5 p-3 rounded-xl bg-surface-2 shadow-surface-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-foreground">
              Fetching {model.label} — {formatBytes(variant.bytes)}, once
            </span>
            <span className="font-mono text-muted-foreground">
              {status.percent}%
            </span>
          </div>
          <Progress value={status.percent} />
        </div>
      )}

      {/* ─── Result ─── */}
      <div className="flex-1 min-h-[18rem] rounded-2xl bg-surface-1 shadow-surface-2 overflow-hidden relative flex items-center justify-center">
        {depth ? (
          <canvas
            ref={outRef}
            className="max-w-full max-h-full object-contain"
            aria-label={`Depth map of ${sourceName}, ${view} view`}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
            {status.kind === "estimating" ? (
              <>
                <Play className="size-5 text-muted-foreground" />
                <p className="text-[13px] font-medium text-foreground">
                  Estimating depth…
                </p>
              </>
            ) : (
              <>
                <ImageIcon className="size-5 text-muted-foreground" />
                <p className="text-[13px] font-medium text-foreground">
                  Pick an image
                </p>
                <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                  Any photo works. A scene with clear near and far surfaces
                  shows what the model is doing better than a flat product shot.
                </p>
              </>
            )}
          </div>
        )}

        {/* Kept out of the accessible tree while empty so the canvas's own
            label is the only description of the result. */}
        {depth && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2 text-[10px] font-mono text-foreground/50">
            <span>
              {depth.width}×{depth.height}
            </span>
            <span aria-hidden="true">·</span>
            <span>{Math.round(depth.ms)} ms</span>
            {depth.device && (
              <>
                <span aria-hidden="true">·</span>
                <span>{depth.device}</span>
              </>
            )}
            {stats && (
              <>
                <span aria-hidden="true">·</span>
                {/* A collapsed spread looks like a broken renderer. Saying the
                    number makes clear it came from the model. */}
                <span title="Range of the raw depth values. A small spread means the model found little depth variation, not that the display is broken.">
                  spread {stats.spread}/255
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
        }}
      />

      <RightSidebarPanel title="Depth">
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Source
          </label>
          <Button
            size="compact"
            variant="primary"
            onClick={() => fileInputRef.current?.click()}
            className="w-full gap-1.5"
          >
            <ImageIcon className="size-3.5" /> Choose an image
          </Button>
          <div className="grid grid-cols-2 gap-1.5">
            {SAMPLES.map((s) => (
              <Button
                key={s.name}
                size="compact"
                variant="secondary"
                disabled={busy}
                onClick={() => void loadFrom(s.url, s.name)}
                className="justify-start"
              >
                {s.name}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            View
          </label>
          <TabsSubtle
            selectedIndex={VIEWS.findIndex((v) => v.value === view)}
            onSelect={(i) => setView(VIEWS[i].value)}
            size="compact"
            className="w-full flex"
          >
            {VIEWS.map((v, i) => (
              <TabsSubtleItem key={v.value} index={i} label={v.label} />
            ))}
          </TabsSubtle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {view === "grey"
              ? "Brighter is nearer. This is the one to export for a displacement or parallax pass."
              : view === "normals"
                ? "Tangent-space normals derived from the depth gradient, green channel +Y up (OpenGL). Flip green for Direct3D. Derived from a guess, so it inherits every error in it."
                : view === "turbo"
                  ? "Not perceptually uniform, but the widest apparent range — the easiest to read structure from."
                  : "Perceptually uniform: equal steps in the data are equal steps in lightness, so it does not invent banding."}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Model
          </label>
          <TabsSubtle
            selectedIndex={DEPTH_MODELS.findIndex((m) => m.id === modelId)}
            onSelect={(i) => {
              setModelId(DEPTH_MODELS[i].id)
              const canvas = sourceCanvasRef.current
              if (canvas && sourceName) {
                void (async () => {
                  setDepth(null)
                  setError(null)
                  try {
                    setDepth(
                      await estimateDepth(canvas, maxEdge, DEPTH_MODELS[i].id)
                    )
                  } catch (e: any) {
                    setError(e?.message || "Depth estimation failed")
                  }
                })()
              }
            }}
            size="compact"
            className="w-full flex"
          >
            {DEPTH_MODELS.map((m, i) => (
              <TabsSubtleItem
                key={m.id}
                index={i}
                label={m.label.replace("Depth Anything V2 ", "DA2 ").replace("Metric3D ViT ", "M3D ")}
              />
            ))}
          </TabsSubtle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {model.tagline}
          </p>
          <dl className="grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <dt className="text-muted-foreground">Download</dt>
              <dd className="text-foreground font-mono">
                {formatBytes(variant.bytes)} · {variant.dtype}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Output</dt>
              <dd className="text-foreground">
                {model.kind === "metric" ? "metric (metres)" : "relative"}
              </dd>
            </div>
          </dl>
          {model.caveat && (
            <p className="flex items-start gap-1.5 text-[11px] text-warn leading-snug">
              <AlertTriangle className="size-3 shrink-0 mt-0.5" />
              <span>{model.caveat}</span>
            </p>
          )}
          <a
            href={`https://huggingface.co/${model.repo}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-80"
          >
            {model.repo}
            <ExternalLink className="size-3" />
          </a>
        </div>

        <div className="space-y-3">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Tone
          </label>
          <Button
            variant={tone.invert ? "secondary" : "ghost"}
            size="compact"
            onClick={() => setTone({ ...tone, invert: !tone.invert })}
            aria-pressed={tone.invert}
            className="w-full justify-between"
          >
            <span>Invert near/far</span>
            <span className="font-mono text-[10px] text-muted-foreground">
              {tone.invert ? "far is bright" : "near is bright"}
            </span>
          </Button>
          <Slider
            min={0.5}
            max={3}
            step={0.05}
            value={[tone.contrast]}
            onValueChange={([v]) => setTone({ ...tone, contrast: v })}
            label="Contrast"
            formatValue={(v) => `${v.toFixed(2)}×`}
            size="compact"
          />
          <Slider
            min={0.2}
            max={3}
            step={0.05}
            value={[tone.gamma]}
            onValueChange={([v]) => setTone({ ...tone, gamma: v })}
            label="Gamma"
            formatValue={(v) => v.toFixed(2)}
            size="compact"
          />
          {view === "normals" && (
            <Slider
              min={0.1}
              max={5}
              step={0.1}
              value={[tone.normalStrength]}
              onValueChange={([v]) => setTone({ ...tone, normalStrength: v })}
              label="Normal strength"
              formatValue={(v) => `${v.toFixed(1)}×`}
              size="compact"
            />
          )}
          <p className="text-[11px] text-muted-foreground leading-snug">
            Tone is applied on read, so these are instant — the model does not
            run again.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Resolution
          </label>
          <TabsSubtle
            selectedIndex={RESOLUTIONS.indexOf(maxEdge)}
            onSelect={(i) => {
              setMaxEdge(RESOLUTIONS[i])
              const canvas = sourceCanvasRef.current
              if (canvas && sourceName) {
                void (async () => {
                  setDepth(null)
                  try {
                    setDepth(
                      await estimateDepth(canvas, RESOLUTIONS[i], modelId)
                    )
                  } catch (e: any) {
                    setError(e?.message || "Depth estimation failed")
                  }
                })()
              }
            }}
            size="compact"
            className="w-full flex"
          >
            {RESOLUTIONS.map((r, i) => (
              <TabsSubtleItem key={r} index={i} label={String(r)} />
            ))}
          </TabsSubtle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            This model resizes its input to {model.inputSize}px internally, so
            past that you are paying for pixels it discards.
          </p>
        </div>

        <div className="space-y-2">
          <Button
            size="compact"
            variant="primary"
            disabled={!depth}
            onClick={download}
            className="w-full gap-1.5"
          >
            <Download className="size-3.5" /> Download PNG
          </Button>
          <Button
            size="compact"
            variant="ghost"
            disabled={!sourceName || busy}
            onClick={rerun}
            className="w-full gap-1.5"
          >
            <Play className="size-3.5" /> Run again
          </Button>
        </div>
      </RightSidebarPanel>
    </div>
  )
}
