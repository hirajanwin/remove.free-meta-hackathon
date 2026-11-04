import * as React from "react"
import { Pipette, Upload } from "lucide-react"

import { PillTabs } from "@/components/studio/chrome"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { Sparkles, Layers } from "lucide-react"
import { getMetaKey } from "@/lib/meta"
import { generateBackdrop } from "@/lib/muse"
import { recordRun } from "@/lib/run-info"
import type { StudioControlsState } from "./studio-context"

// Background controls at the top of the canvas, where the eye already is:
// what is behind the subject is the most-changed setting in the app, so it
// left the right sidebar. Everything here writes the same controls state
// the sidebar used — one source of truth, closer to the result.

const MODES = ["transparent", "color", "gradient", "blur", "image"] as const
const LABELS = ["Alpha", "Color", "Gradient", "Blur", "Photo"]
const SWATCHES = ["#ffffff", "#f8fafc", "#09090b", "#27272a", "#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899"]
const GRADIENTS: Array<{ style: StudioControlsState["gradient"]; css: string; name: string }> = [
  { style: "dark", css: "radial-gradient(circle at 50% 40%, #3f3f46, #09090b)", name: "Studio" },
  { style: "sunset", css: "linear-gradient(135deg,#f97316,#ec4899,#8b5cf6)", name: "Sunset" },
  { style: "ocean", css: "linear-gradient(135deg,#06b6d4,#3b82f6,#6366f1)", name: "Ocean" },
  { style: "cyberpunk", css: "linear-gradient(135deg,#f43f5e,#a855f7,#06b6d4)", name: "Cyber" },
  { style: "light", css: "linear-gradient(180deg,#f8fafc,#cbd5e1)", name: "Light" },
]

export interface BackgroundValue {
  mode: StudioControlsState["mode"]
  color: string
  gradient: StudioControlsState["gradient"]
  blurRadius: number
  backdropImage: string | null
  /** Blur grows with distance behind the subject (Depth Anything, on device). */
  depthBokeh?: boolean
}

export function BackgroundStrip({
  controls,
  onChange,
  onPickColor,
}: {
  /** Normalised backdrop state (studio controls or video state both fit). */
  controls: BackgroundValue & { pickColor?: boolean }
  onChange: (patch: Partial<BackgroundValue & { pickColor?: boolean }>) => void
  /** Eyedropper handler; omit to hide the Pick button (video has none yet). */
  onPickColor?: () => void
}) {
  const fileRef = React.useRef<HTMLInputElement>(null)
  const [aiPrompt, setAiPrompt] = React.useState("")
  const [aiBusy, setAiBusy] = React.useState(false)
  const [aiNote, setAiNote] = React.useState<string | null>(null)
  const generate = async () => {
    const prompt = aiPrompt.trim()
    if (!prompt || aiBusy) return
    const key = getMetaKey()
    if (!key) {
      setAiNote("Add your Meta key in the AI tab first")
      return
    }
    setAiBusy(true)
    setAiNote(null)
    const t0 = performance.now()
    try {
      // Aspect from the live canvas so the scene matches the frame.
      const cv = document.querySelector<HTMLCanvasElement>("#cv")
      const url = await generateBackdrop(prompt, key, cv?.width ?? 1024, cv?.height ?? 1024)
      set({ mode: "image", backdropImage: url })
      recordRun({
        action: `Backdrop: "${prompt}"`,
        model: "Muse Image",
        where: "cloud",
        ms: performance.now() - t0,
        cost: 0.01,
      })
    } catch (err: any) {
      setAiNote(err?.message || "Generation failed")
    } finally {
      setAiBusy(false)
    }
  }
  const set = (patch: Partial<BackgroundValue & { pickColor?: boolean }>) => onChange(patch)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <PillTabs
        ariaLabel="Backdrop"
        items={LABELS.map((label) => ({ label }))}
        value={Math.max(0, MODES.indexOf(controls.mode))}
        onChange={(i) => set({ mode: MODES[i] })}
      />

      {controls.mode === "color" && (
        <div className="flex items-center gap-1">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={`Backdrop colour ${hex}`}
              onClick={() => set({ color: hex })}
              className={cn(
                "size-5 rounded-md shadow-surface-1 transition-transform hover:scale-110",
                controls.color.toLowerCase() === hex &&
                  "ring-2 ring-[color:var(--focus-ring,#6B97FF)] ring-offset-1 ring-offset-surface-1"
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
          <input
            type="color"
            value={controls.color}
            onChange={(e) => set({ color: e.target.value })}
            aria-label="Custom backdrop colour"
            className="size-5 rounded cursor-pointer border-0 bg-transparent p-0"
          />
          {onPickColor && (
            <button
              type="button"
              aria-pressed={controls.pickColor}
              onClick={onPickColor}
              className={cn(
                "flex items-center gap-1 text-[10px] rounded-md px-1.5 py-1",
                controls.pickColor
                  ? "bg-selected text-foreground"
                  : "text-muted-foreground hover:text-foreground bg-surface-3"
              )}
            >
              <Pipette className="size-3" />
              {controls.pickColor ? "Click photo…" : "Pick"}
            </button>
          )}
        </div>
      )}

      {controls.mode === "gradient" && (
        <div className="flex items-center gap-1">
          {GRADIENTS.map((g) => (
            <button
              key={g.style}
              type="button"
              title={g.name}
              aria-label={`Gradient ${g.name}`}
              onClick={() => set({ gradient: g.style })}
              className={cn(
                "h-5 w-8 rounded-md shadow-surface-1 transition-transform hover:scale-110",
                controls.gradient === g.style &&
                  "ring-2 ring-[color:var(--focus-ring,#6B97FF)] ring-offset-1 ring-offset-surface-1"
              )}
              style={{ background: g.css }}
            />
          ))}
        </div>
      )}

      {controls.mode === "blur" && (
        <div className="flex h-7 items-center gap-2 rounded-full bg-surface-2/95 px-3 shadow-surface-2">
          <span className="text-[12px] text-muted-foreground">Blur</span>
          <div className="w-28 [&>div>div:first-child]:hidden">
            <Slider
              min={2}
              max={40}
              step={1}
              value={[controls.blurRadius]}
              onValueChange={([v]) => set({ blurRadius: v })}
              label=""
              formatValue={() => ""}
              size="compact"
              variant="compact"
            />
          </div>
          <span className="text-[12px] font-mono tabular-nums text-muted-foreground w-9 text-right">
            {controls.blurRadius}px
          </span>
          <button
            type="button"
            aria-pressed={!!controls.depthBokeh}
            onClick={() => set({ depthBokeh: !controls.depthBokeh })}
            title="Depth blur: softer the farther behind you (Depth Anything, on this device, 18 MiB first use)"
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] transition-colors duration-80",
              controls.depthBokeh
                ? "bg-selected text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Layers className="size-3.5" />
            Depth
          </button>
        </div>
      )}

      {controls.mode === "image" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => {
                if (typeof reader.result === "string") set({ backdropImage: reader.result })
              }
              reader.readAsDataURL(file)
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 text-[10px] rounded-md px-1.5 py-1 text-muted-foreground hover:text-foreground bg-surface-3"
          >
            <Upload className="size-3" /> Upload backdrop
          </button>
          <div className="flex h-7 items-center gap-1.5 rounded-full bg-surface-2/95 pl-2.5 pr-0.5 shadow-surface-2">
            <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void generate()}
              placeholder='AI backdrop — "Tokyo street at golden hour"'
              aria-label="Describe an AI-generated backdrop"
              disabled={aiBusy}
              className="w-56 bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => void generate()}
              disabled={!aiPrompt.trim() || aiBusy}
              title="Generate with Muse Image ($0.01, only the text is sent)"
              className="h-6 rounded-full bg-selected px-2.5 text-[12px] text-foreground disabled:opacity-40"
            >
              {aiBusy ? "…" : "Generate"}
            </button>
          </div>
          {aiNote && <span className="text-[11px] text-warn">{aiNote}</span>}
        </>
      )}
    </div>
  )
}
