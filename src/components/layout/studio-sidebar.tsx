import * as React from "react"
import { motion } from "framer-motion"
import {
  PanelRightClose,
  Palette,
  RotateCcw,
  Check,
  Upload,
  Download,
  Copy,
  Pipette,
  ChevronDown,
  Layers as LayersIcon,
  Brush,
  Sparkles,
  Cpu,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { ModelPicker } from "@/components/studio/model-picker"
import { MetaPanel } from "@/components/studio/meta-panel"
import { LayersPanel } from "@/components/studio/layers-panel"
import { AuditPanel } from "@/components/studio/audit-panel"
import { EdgePanel } from "@/components/studio/edge-panel"
import { EffectsPanel } from "@/components/studio/effects-panel"
import { FinishPanel } from "@/components/studio/finish-panel"
import { RecipePanel } from "@/components/studio/recipe-panel"
import { recipeFromControls, controlsFromRecipe } from "@/lib/recipe/studio-bridge"
import { getActiveModelId } from "@/lib/bg-removal"
import { recommendFormat } from "@/lib/export-image"
import type { StudioControlsState } from "@/components/studio/studio-context"
import { Tooltip } from "@/components/ui/tooltip"
import { useRouterState } from "@tanstack/react-router"
import { useSidebarLayout } from "./sidebar-layout-context"
import { useStudio } from "@/components/studio/studio-context"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"
import { addDepthStatusListener, type DepthStatus } from "@/lib/depth"
import { RightSidebarPanel } from "./right-sidebar"
import { PanelTabs, TabPane, PanelCard, type PanelTab } from "@/components/studio/chrome"

export type BgMode = "transparent" | "color" | "gradient" | "blur" | "image"

// StudioControlsState is defined once, in studio-context. A second copy used to
// live here and had silently drifted — it was missing the brush fields, and
// because both were named the same the mismatch surfaced as every `prev`
// parameter in this file inferring as `any`.
interface StudioSidebarProps {
  controls: StudioControlsState
  onChange: (updater: (prev: StudioControlsState) => StudioControlsState) => void
  onDownload: () => void
  onCopy: () => void
  hasCutout: boolean
}

const COLOR_SWATCHES = [
  { name: "Pure White", hex: "#ffffff", border: true },
  { name: "Studio White", hex: "#f8fafc", border: true },
  { name: "Obsidian Black", hex: "#09090b" },
  { name: "Slate 900", hex: "#0f172a" },
  { name: "Zinc 800", hex: "#27272a" },
  { name: "Warm Stone", hex: "#e7e5e4", border: true },
  { name: "Crimson Red", hex: "#ef4444" },
  { name: "Cobalt Blue", hex: "#3b82f6" },
  { name: "Emerald Green", hex: "#10b981" },
  { name: "Amber Sun", hex: "#f59e0b" },
  { name: "Deep Violet", hex: "#8b5cf6" },
  { name: "Rose Pink", hex: "#ec4899" },
]

const GRADIENT_PRESETS: { name: string; style: "dark" | "sunset" | "ocean" | "cyberpunk" | "light"; css: string }[] = [
  { name: "Dark Vignette", style: "dark", css: "radial-gradient(circle at center, #3f3f46 0%, #09090b 100%)" },
  { name: "Sunset Radiance", style: "sunset", css: "linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%)" },
  { name: "Ocean Depth", style: "ocean", css: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #6366f1 100%)" },
  { name: "Cyberpunk", style: "cyberpunk", css: "linear-gradient(135deg, #f43f5e 0%, #a855f7 50%, #06b6d4 100%)" },
  { name: "Minimal Light", style: "light", css: "linear-gradient(180deg, #f8fafc 0%, #cbd5e1 100%)" },
]

const SAMPLE_BACKDROPS = [
  { name: "Minimal Studio Interior", url: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800" },
  { name: "Lush Botanic Garden", url: "https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=800" },
  { name: "Modern Office Loft", url: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=800" },
  { name: "Neon City Street", url: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=800" },
]

const bgModes: BgMode[] = ["transparent", "color", "gradient", "blur", "image"]
const exportFormats: ("png" | "webp" | "jpeg")[] = ["png", "webp", "jpeg"]


/** Studio sections are PanelCards; see chrome.tsx for the open/closed rules. */
const Section = PanelCard

export function StudioSidebar({
  controls: propControls,
  onChange: propOnChange,
  onDownload: propOnDownload,
  onCopy: propOnCopy,
  hasCutout: propHasCutout,
}: Partial<StudioSidebarProps> = {}) {
  const studio = useStudio()
  const controls = propControls || studio.controls
  // Dispatched rather than unioned: the prop's signature and setControls'
  // Dispatch<SetStateAction<...>> are not mutually assignable, and a union of
  // call signatures gives TypeScript nothing to infer the updater's parameter
  // from — every `prev` below silently became `any`.
  const setControls = studio.setControls
  const onChange = React.useCallback(
    (updater: (prev: StudioControlsState) => StudioControlsState) => {
      if (propOnChange) propOnChange(updater)
      else setControls(updater)
    },
    [propOnChange, setControls]
  )
  const onDownload = propOnDownload || studio.onDownload
  const onCopy = propOnCopy || studio.onCopy
  const hasCutout = propHasCutout !== undefined ? propHasCutout : studio.hasCutout

  // Depth model status, surfaced in the blur panel. Without it the toggle looks
  // inert for the several seconds of a first-run download.
  const [depthStatus, setDepthStatus] = React.useState<DepthStatus>({ kind: "idle" })
  React.useEffect(() => addDepthStatusListener(setDepthStatus), [])

  const depthNote =
    depthStatus.kind === "loading"
      ? `Downloading the depth model, ${depthStatus.percent}%.`
      : depthStatus.kind === "estimating"
        ? "Reading the depth of the scene."
        : depthStatus.kind === "error"
          ? `Depth unavailable (${depthStatus.message}). Falling back to a flat blur.`
          : "Blur grows with distance behind the subject, the way a lens defocuses. First use downloads an 18 MiB depth model."
  const estimatedSize = studio.estimatedSize
  const formatSizes = studio.formatSizes

  // "Transparent" is the only mode that leaves alpha in the exported canvas;
  // every other mode fills the background, so JPEG is lossless-enough there.
  const isTransparent = controls.mode === "transparent"
  const recommended_ = formatSizes
    ? recommendFormat(formatSizes, isTransparent)
    : null

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "Calculating..."
    if (bytes === 0) return "0 B"
    const k = 1024
    const sizes = ["B", "KB", "MB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
  }

  const routerState = useRouterState()
  const pathname = routerState.location.pathname
  const backdropInputRef = React.useRef<HTMLInputElement>(null)
  const [panelTab, setPanelTab] = React.useState<PanelTab>("edit")

  if (pathname !== "/") return null

  const selectedBgIndex = Math.max(0, bgModes.indexOf(controls.mode))
  const selectedFmtIndex = Math.max(0, exportFormats.indexOf(controls.exportFormat))

  const handleCustomBackdrop = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const url = reader.result as string
      onChange((prev) => ({
        ...prev,
        mode: "image",
        backdropImage: url,
      }))
    }
    reader.readAsDataURL(file)
  }

  const finishParts: string[] = []
  if (controls.filterPreset !== "none") finishParts.push(controls.filterPreset)
  if (controls.effects.length) finishParts.push(`${controls.effects.length} effect${controls.effects.length > 1 ? "s" : ""}`)
  if (controls.relight.intensity > 0) finishParts.push("relight")
  if (controls.badgeVisible && controls.badgeText) finishParts.push("badge")
  if (controls.captionVisible && controls.captionText) finishParts.push("caption")
  const finishSummary = finishParts.length ? finishParts.join(" · ") : "Crop · Filter · Relight · Badge"

  return (
    <RightSidebarPanel
      title="Studio Controls"
      actions={
        <Tooltip content="Reset to transparent" side="bottom">
          <Button
            variant="ghost"
            size="icon-compact"
            onClick={() =>
              onChange((prev) => ({
                ...prev,
                mode: "transparent",
                color: "#ffffff",
                blurRadius: 16,
                depthBokeh: false,
                backdropImage: null,
              }))
            }
            aria-label="Reset background to transparent"
            className="size-6 rounded-md hover:bg-hover active:bg-active active:scale-95 transition-all duration-80 text-muted-foreground hover:text-foreground shrink-0"
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </Tooltip>
      }
    >

        <div ref={studio.setFileSlotEl} className="empty:hidden" />

        <PanelTabs value={panelTab} onChange={setPanelTab} />

        {panelTab === "audit" ? (
          <AuditPanel />
        ) : (
          <>
        <TabPane active={panelTab} tab="edit">
        {/* ─── Layer stack ─── */}
        <Section id="panel-layers" title="Layers" icon={LayersIcon} summary="Subject · Backdrop">
          <LayersPanel controls={controls} onChange={onChange} />
        </Section>

        {/* ─── Refine (one mode, both gestures) ─── */}
        <Section
          id="panel-refine"
          title="Refine & brush"
          icon={Brush}
          defaultOpen
          autoOpen={controls.tool !== "move" && controls.tool !== "hand"}
          summary={controls.tool === "move" || controls.tool === "hand" ? "Pick a tool below" : `${controls.tool} tool`}
        >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Refine
            </label>
            <button
              type="button"
              disabled={!hasCutout}
              onClick={() =>
                onChange((prev) => {
                  const next = !prev.refineActive
                  return {
                    ...prev,
                    refineActive: next,
                    tool: next ? "select" : "move",
                  }
                })
              }
              className={
                "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded transition-colors duration-80 disabled:opacity-40 " +
                (controls.refineActive
                  ? "text-ok bg-ok/10"
                  : "text-muted-foreground bg-hover/60 hover:bg-hover")
              }
            >
              {controls.refineActive ? "on" : "off"}
            </button>
          </div>

          {controls.tool !== "move" && (
            <>
              <TabsSubtle
                selectedIndex={controls.refineMode === "restore" ? 0 : 1}
                onSelect={(idx) =>
                  onChange((prev) => ({
                    ...prev,
                    refineMode: idx === 0 ? "restore" : "erase",
                  }))
                }
                size="compact"
                className="w-full flex"
              >
                <TabsSubtleItem index={0} label="Keep" />
                <TabsSubtleItem index={1} label="Remove" />
              </TabsSubtle>

              <TabsSubtle
                selectedIndex={controls.selectTool === "object" ? 0 : 1}
                onSelect={(idx) =>
                  onChange((prev) => ({
                    ...prev,
                    selectTool: idx === 0 ? "object" : "similar",
                  }))
                }
                size="compact"
                className="w-full flex"
              >
                <TabsSubtleItem index={0} label="Object" />
                <TabsSubtleItem index={1} label="Similar" />
              </TabsSubtle>

              {controls.selectTool === "similar" && (
                <Slider
                  min={0.3}
                  max={0.9}
                  step={0.05}
                  value={[controls.similarThreshold]}
                  onValueChange={([val]) =>
                    onChange((prev) => ({ ...prev, similarThreshold: val }))
                  }
                  label="Similarity"
                  formatValue={(val) => val.toFixed(2)}
                  size="compact"
                  variant="compact"
                />
              )}

              {/* What the two gestures do, and what the tints mean. */}
              <div className="rounded-md bg-surface-3/50 px-2 py-1.5 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-9">
                    click
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    select the object under the cursor
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-9">
                    drag
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    paint freehand
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-9">
                    alt +
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    click to exclude a region from the selection
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground w-9">
                    shift +
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    click to select everything like it (DINOv2)
                  </span>
                </div>
                <div className="flex items-center gap-2 pt-0.5">
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-sm bg-ok/80" />
                    <span className="text-[10px] text-muted-foreground">keep</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="size-2 rounded-sm bg-danger/80" />
                    <span className="text-[10px] text-muted-foreground">remove</span>
                  </span>
                </div>
              </div>

              {/* Proposed selection: nothing changes until this is applied. */}
              {studio.pendingSelection && (
                <div className="rounded-md border border-ok/25 bg-ok/5 px-2 py-1.5 space-y-1.5">
                  <p className="text-[10px] leading-snug text-ok">
                    Selection proposed — the bright tint is what will change.
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="primary"
                      size="compact"
                      className="flex-1 text-[11px] h-7"
                      onClick={studio.onApplyPending}
                    >
                      Apply
                    </Button>
                    <Button
                      variant="outline"
                      size="compact"
                      className="flex-1 text-[11px] h-7"
                      onClick={studio.onCancelPending}
                    >
                      Discard
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Enter applies, Esc discards.
                  </p>
                </div>
              )}

              {studio.selectStatus && (
                <div className="flex justify-between items-center gap-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Select
                  </span>
                  <span
                    className={
                      "text-[11px] font-mono truncate " +
                      (studio.selectStatus === "ready"
                        ? "text-ok"
                        : /fail|error|not|cannot/i.test(studio.selectStatus)
                          ? "text-danger"
                          : "text-muted-foreground")
                    }
                  >
                    {studio.selectStatus}
                  </span>
                </div>
              )}

              <Slider
                min={2}
                max={200}
                step={1}
                value={[controls.brushSize]}
                onValueChange={([val]) =>
                  onChange((prev) => ({ ...prev, brushSize: val }))
                }
                label="Brush Size"
                formatValue={(val) => `${val}px`}
                size="compact"
                variant="compact"
              />

              <Slider
                min={0.15}
                max={1}
                step={0.05}
                value={[controls.overlayStrength]}
                onValueChange={([val]) =>
                  onChange((prev) => ({ ...prev, overlayStrength: val }))
                }
                label="Overlay"
                formatValue={(val) => `${Math.round(val * 100)}%`}
                size="compact"
                variant="compact"
              />

              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="compact"
                  disabled={!studio.canUndoEdit}
                  onClick={studio.onUndoEdit}
                  className="flex-1 text-[11px] h-7"
                >
                  Undo
                </Button>
                <Button
                  variant="outline"
                  size="compact"
                  onClick={studio.onResetEdits}
                  className="flex-1 text-[11px] h-7"
                >
                  Reset
                </Button>
              </div>

              <p className="text-[10px] leading-snug text-muted-foreground">
                The model's own mask is never overwritten, so Reset always
                returns to the original result.
              </p>
            </>
          )}
        </div>

        </Section>

        {/* ─── Trim the cutout by distance (on-device depth) ─── */}
        <Section
          id="panel-depth-slice"
          title="Depth slice"
          icon={LayersIcon}
          autoOpen={controls.depthSlice.enabled}
          summary={controls.depthSlice.enabled ? `On · ${controls.depthSlice.near}–${controls.depthSlice.far}` : "Off"}
          toggle={{
            checked: controls.depthSlice.enabled,
            onChange: (enabled) =>
              onChange((prev) => ({ ...prev, depthSlice: { ...prev.depthSlice, enabled } })),
          }}
        >
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                Keep only what is within a distance range. Removes floor, chairs or a
                wall the matte caught.
              </span>
            </div>
            {controls.depthSlice.enabled && (
              <div className="space-y-2">
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[controls.depthSlice.near]}
                  onValueChange={([v]) =>
                    onChange((prev) => ({
                      ...prev,
                      depthSlice: { ...prev.depthSlice, near: Math.min(v, prev.depthSlice.far - 1) },
                    }))
                  }
                  label="Nearest"
                  formatValue={(v) => `${v}`}
                  size="compact"
                  variant="compact"
                />
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[controls.depthSlice.far]}
                  onValueChange={([v]) =>
                    onChange((prev) => ({
                      ...prev,
                      depthSlice: { ...prev.depthSlice, far: Math.max(v, prev.depthSlice.near + 1) },
                    }))
                  }
                  label="Farthest"
                  formatValue={(v) => `${v}`}
                  size="compact"
                  variant="compact"
                />
                <Slider
                  min={0}
                  max={30}
                  step={1}
                  value={[controls.depthSlice.feather]}
                  onValueChange={([v]) =>
                    onChange((prev) => ({ ...prev, depthSlice: { ...prev.depthSlice, feather: v } }))
                  }
                  label="Soft edge"
                  formatValue={(v) => `${v}`}
                  size="compact"
                  variant="compact"
                />
                <div className="flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="compact"
                    className="flex-1 h-7 text-[11px]"
                    disabled={!hasCutout}
                    onClick={() => window.dispatchEvent(new Event("depth-slice-fit"))}
                    title="Window around the subject's own distance"
                  >
                    Fit to subject
                  </Button>
                  <Button
                    variant="outline"
                    size="compact"
                    className="flex-1 h-7 text-[11px]"
                    onClick={() =>
                      onChange((prev) => ({
                        ...prev,
                        depthSlice: { ...prev.depthSlice, near: 0, far: 100 },
                      }))
                    }
                  >
                    Reset range
                  </Button>
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  0 is nearest, 100 farthest, from Depth Anything on this device (18 MiB,
                  downloaded once). Brush edits still win over the slice. Open the Depth view
                  to see the distances.
                </p>
              </div>
            )}
          </div>
        </Section>

        {/* ─── What happens after the cut ─── */}
        <Section
          id="panel-finish"
          title="Effects & finish"
          icon={Sparkles}
          summary={finishSummary}
        >
          <EffectsPanel
            effects={controls.effects}
            onChange={(effects) => onChange((prev) => ({ ...prev, effects }))}
          />
          <FinishPanel controls={controls} onChange={onChange} />
        </Section>
        </TabPane>

        {/* ─── Select by text (SAM 3.1, BYOK) ─── */}
        <TabPane active={panelTab} tab="ai">
        <Section id="panel-meta" title="Meta AI" icon={Sparkles} defaultOpen summary="SAM · Agent · Backdrop">
          <MetaPanel />
        </Section>
        </TabPane>

        {/* ─── Neural Model Selection ─── */}
        <TabPane active={panelTab} tab="model">
        <Section id="panel-model" title="Model & subject" icon={Cpu} defaultOpen summary="Neural matting model">
          <ModelPicker />

        {/* ─── What is being cut out ─── */}
        <EdgePanel
          edge={controls.edge}
          onChange={(edge) => onChange((prev) => ({ ...prev, edge }))}
          canRerun={studio.hasCutout}
          onRerun={() => window.dispatchEvent(new Event("recut"))}
          />
        </Section>

        </TabPane>

        <TabPane active={panelTab} tab="export">
        <div className="space-y-1.5 rounded-xl bg-surface-2 p-3">
          <span className="block text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Depth map
          </span>
          <Button
            variant="outline"
            size="compact"
            className="w-full text-[11px] h-7"
            disabled={!hasCutout}
            onClick={() => window.dispatchEvent(new Event("export-depth"))}
          >
            Save depth map (PNG)
          </Button>
          <p className="text-[10px] leading-snug text-muted-foreground">
            Greyscale, brighter is nearer. Read on this device with Depth Anything V2
            (18 MiB, downloaded once). Also visible under the Depth view.
          </p>
        </div>
        {/* ─── The recipe: send it, save it, open one ─── */}
        <Section id="panel-export" title="Share & export" icon={Download} defaultOpen summary={`${controls.exportFormat.toUpperCase()}`}>
        <RecipePanel
          recipe={recipeFromControls(controls, getActiveModelId())}
          onLoad={(recipe) => onChange((prev) => ({ ...prev, ...controlsFromRecipe(recipe) }))}
        />

        {/* ─── Export Settings & Format ─── */}
        <div id="panel-export" className="pt-3 space-y-3 scroll-mt-10">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
            Export Preset
          </label>
          <TabsSubtle
            selectedIndex={selectedFmtIndex}
            onSelect={(idx) => onChange((prev) => ({ ...prev, exportFormat: exportFormats[idx] }))}
            size="compact"
            className="w-full flex"
          >
            <TabsSubtleItem index={0} label="PNG" />
            <TabsSubtleItem index={1} label="WEBP" />
            <TabsSubtleItem index={2} label="JPEG" />
          </TabsSubtle>

          {controls.exportFormat !== "png" && (
            <div className="pt-2 flex flex-col gap-1.5">
              <Slider
                min={10}
                max={100}
                step={1}
                value={[controls.exportQuality]}
                onValueChange={([val]) => onChange((prev) => ({ ...prev, exportQuality: val }))}
                label="Quality"
                formatValue={(val) => `${val}%`}
                size="compact"
                variant="compact"
              />
            </div>
          )}

          {/* Real encoded sizes for every format, so the trade-off is visible
              instead of being one number for whichever tab happens to be
              selected. Measured by actually encoding, not estimated. */}
          <div className="pt-2 space-y-1">
            {(["png", "webp", "jpeg"] as const).map((fmt) => {
              const bytes =
                formatSizes?.find((f) => f.format === fmt)?.bytes ?? null
              const selected = controls.exportFormat === fmt
              const recommended = recommended_ === fmt
              return (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onChange((prev) => ({ ...prev, exportFormat: fmt }))}
                  className={
                    "w-full flex items-center justify-between rounded-md px-2 py-1 transition-colors duration-80 " +
                    (selected ? "bg-hover" : "hover:bg-hover/60")
                  }
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={
                        "text-[11px] font-medium uppercase " +
                        (selected ? "text-foreground" : "text-muted-foreground")
                      }
                    >
                      {fmt}
                    </span>
                    {recommended && (
                      <span className="text-[9px] font-medium uppercase tracking-wide text-ok">
                        best
                      </span>
                    )}
                    {fmt === "jpeg" && isTransparent && (
                      <Tooltip
                        side="left"
                        content={
                          <span className="block max-w-[220px]">
                            JPEG has no alpha channel, so the cutout is flattened
                            onto white. Use PNG or WebP to keep transparency.
                          </span>
                        }
                      >
                        <span className="text-[9px] font-medium uppercase tracking-wide text-warn cursor-help">
                          no alpha
                        </span>
                      </Tooltip>
                    )}
                  </span>
                  <span
                    className={
                      "text-[11px] font-mono " +
                      (selected ? "text-ok font-medium" : "text-muted-foreground")
                    }
                  >
                    {bytes === null ? "—" : formatBytes(bytes)}
                  </span>
                </button>
              )
            })}
            {isTransparent && (
              <p className="text-[10px] leading-snug text-muted-foreground px-2 pt-0.5">
                WebP compresses colour but stores alpha losslessly, so the cutout
                mask is bit-identical to PNG at a fraction of the size.
              </p>
            )}
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button
              id="dl"
              variant="primary"
              onClick={onDownload}
              disabled={!hasCutout}
              className="w-full h-9 text-[12px] gap-2 font-semibold"
            >
              <Download className="size-3.5" />
              Download {controls.exportFormat.toUpperCase()}
            </Button>
            <Button
              variant="outline"
              size="compact"
              onClick={onCopy}
              disabled={!hasCutout}
              className="w-full gap-2 h-8 text-[12px]"
            >
              <Copy className="size-3" />
              Copy to Clipboard
            </Button>
            <Button
              variant="outline"
              size="compact"
              onClick={studio.onSocialPack}
              disabled={!hasCutout}
              className="w-full gap-2 h-8 text-[12px]"
              title="This design at Instagram, X, YouTube and Pinterest sizes in one ZIP"
            >
              <Download className="size-3" />
              Social Pack (5 sizes)
            </Button>
            <Button
              variant="outline"
              size="compact"
              onClick={studio.onAnimate}
              disabled={!hasCutout || studio.animateBusy}
              className="w-full gap-2 h-8 text-[12px]"
              title="A 3-second pan/zoom video of this design for social feeds"
            >
              <Download className="size-3" />
              {studio.animateBusy ? "Animating…" : "Animate (3s video)"}
            </Button>
          </div>
        </div>
        </Section>
        </TabPane>
          </>
        )}
    </RightSidebarPanel>
  )
}
