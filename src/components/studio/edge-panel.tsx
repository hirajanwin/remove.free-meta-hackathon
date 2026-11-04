import * as React from "react"
import { Layers, RotateCcw } from "lucide-react"

import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { MATERIALS, materialById } from "@/lib/recipe/materials"
import type { EdgeConfig } from "@/lib/recipe/schema"

/**
 * What you are cutting out.
 *
 * Presented before the export settings and after the model, because that is the
 * order the decisions actually happen in: which network, then what it is
 * looking at, then how the result leaves. It changes the matte rather than the
 * presentation, so it belongs above the background controls conceptually — but
 * below them in the panel, since the background is what people reach for first
 * and a control nobody touches should not sit in front of one everybody does.
 */
export function EdgePanel({
  edge,
  onChange,
  onRerun,
  canRerun,
}: {
  edge: EdgeConfig
  onChange: (next: EdgeConfig) => void
  onRerun: () => void
  canRerun: boolean
}) {
  const material = materialById(edge.material)
  const isDefault = edge.material === "auto"

  return (
    <div className="pt-3 space-y-3">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Layers className="size-3" />
        Subject
      </label>

      {/* A wrapping grid rather than a tab strip: six options do not fit one
          row at sidebar width, and a scrolling tab strip hides the ones nobody
          scrolls to. */}
      <div role="radiogroup" aria-label="What is being cut out" className="grid grid-cols-3 gap-1">
        {MATERIALS.map((m) => {
          const selected = m.id === edge.material
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange({ ...edge, material: m.id })}
              className={cn(
                "rounded-md px-1.5 py-1 text-[11px] transition-colors duration-80",
                selected
                  ? "bg-selected text-foreground"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground"
              )}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">{material.hint}</p>

      {!isDefault && (
        <>
          <Slider
            min={0}
            max={2}
            step={0.05}
            value={[edge.strength]}
            onValueChange={([v]) => onChange({ ...edge, strength: v })}
            label="Amount"
            formatValue={(v) => `${v.toFixed(2)}×`}
            size="compact"
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            A studio portrait on a sweep and a windblown shot against foliage
            both want the hair treatment, and not the same amount of it.
          </p>
        </>
      )}

      {/* The material is applied during matting, so it cannot be previewed on a
          cutout that already exists — saying so beats a control that silently
          does nothing until the next image. */}
      <Button
        variant="outline"
        size="compact"
        disabled={!canRerun}
        onClick={onRerun}
        className="w-full gap-1.5 text-[11px] h-7"
      >
        <RotateCcw className="size-3" />
        Re-cut with this
      </Button>
      <p className="text-[10px] leading-snug text-muted-foreground">
        The subject changes how the edge is found, so it applies on the next cut
        rather than to the one on screen.
      </p>
    </div>
  )
}
