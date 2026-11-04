import * as React from "react"
import { Eye, EyeOff, Layers } from "lucide-react"

import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import type { StudioControlsState } from "./studio-context"
import { useStudio } from "./studio-context"

/**
 * The layer stack, Photoshop-style but semantic: backdrop, SAM object
 * layers (each with its measured coverage), the subject, and the finish
 * overlays. Eyes toggle real compositing decisions, not decorations.
 */
export function LayersPanel({
  controls,
  onChange,
}: {
  controls: StudioControlsState
  onChange: (updater: (prev: StudioControlsState) => StudioControlsState) => void
}) {
  const studio = useStudio()

  const row = (
    key: string,
    label: string,
    visible: boolean,
    toggle: () => void,
    extra?: React.ReactNode
  ) => (
    <div key={key} className="rounded-lg bg-surface-2 shadow-surface-1 px-2 py-1.5 space-y-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={`${visible ? "Hide" : "Show"} ${label}`}
          aria-pressed={visible}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
        </button>
        <span
          className={cn(
            "text-[11px] flex-1 truncate",
            visible ? "text-foreground" : "text-muted-foreground line-through"
          )}
        >
          {label}
        </span>
        {extra}
      </div>
    </div>
  )

  return (
    <div id="panel-layers" className="pt-3 space-y-1.5 scroll-mt-4">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Layers className="size-3" />
        Layers
      </label>

      {controls.captionText.trim() &&
        row(
          "caption",
          `Caption “${controls.captionText.trim().slice(0, 18)}”`,
          controls.captionVisible,
          () => onChange((p) => ({ ...p, captionVisible: !p.captionVisible }))
        )}

      {controls.badgeText.trim() &&
        row(
          "badge",
          `Badge “${controls.badgeText.trim()}”`,
          controls.badgeVisible,
          () => onChange((p) => ({ ...p, badgeVisible: !p.badgeVisible }))
        )}

      {studio.samLayers.map((layer) =>
        row(
          layer.id,
          `SAM object ${layer.id}`,
          layer.visible,
          () => studio.onToggleSamLayer(layer.id),
          <>
            <span
              aria-hidden
              className="size-2 rounded-full shrink-0"
              style={{ background: layer.color }}
            />
            <span className="text-[10px] font-mono text-muted-foreground">
              {layer.coverage === 0 ? "<0.1" : layer.coverage}%
            </span>
          </>
        )
      )}

      {row(
        "subject",
        "Subject (cutout)",
        controls.subjectVisible,
        () => onChange((p) => ({ ...p, subjectVisible: !p.subjectVisible })),
        <span className="text-[10px] font-mono text-muted-foreground">
          {Math.round(controls.subjectOpacity * 100)}%
        </span>
      )}
      {controls.subjectVisible && (
        <Slider
          min={0.1}
          max={1}
          step={0.05}
          value={[controls.subjectOpacity]}
          onValueChange={([v]) => onChange((p) => ({ ...p, subjectOpacity: v }))}
          label="Subject opacity"
          formatValue={(v) => `${Math.round(v * 100)}%`}
          size="compact"
          variant="compact"
        />
      )}

      {row(
        "backdrop",
        "Backdrop",
        controls.backdropVisible,
        () => onChange((p) => ({ ...p, backdropVisible: !p.backdropVisible }))
      )}

      <p className="text-[10px] leading-snug text-muted-foreground">
        SAM layers appear after a text or agent selection; toggling one
        re-proposes the visible objects.
      </p>
    </div>
  )
}
