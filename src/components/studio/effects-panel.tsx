import * as React from "react"
import { Sparkles, Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { effectSchema, type EffectConfig, type EffectType } from "@/lib/recipe/schema"

const ADDABLE: { type: EffectType; label: string }[] = [
  { type: "outline", label: "Outline" },
  { type: "shadow", label: "Shadow" },
  { type: "glow", label: "Glow" },
]

/**
 * What happens to the cutout after it is cut.
 *
 * A LIST rather than a set of toggles, and that is the whole design: an outline
 * under a shadow and a shadow under an outline are different pictures, and both
 * are ones people want. The same effect can appear twice — two outlines at
 * different widths is how you get a two-colour sticker border.
 */
export function EffectsPanel({
  effects,
  onChange,
}: {
  effects: EffectConfig[]
  onChange: (next: EffectConfig[]) => void
}) {
  const add = (type: EffectType) => {
    // Parsed rather than hand-built, so every default comes from the schema and
    // an effect added here is identical to one arriving in a recipe.
    onChange([...effects, effectSchema.parse({ type })])
  }

  const patch = (index: number, next: Partial<EffectConfig>) => {
    onChange(
      effects.map((e, i) => (i === index ? ({ ...e, ...next } as EffectConfig) : e))
    )
  }

  const remove = (index: number) => onChange(effects.filter((_, i) => i !== index))

  return (
    <div className="pt-3 space-y-3">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Sparkles className="size-3" />
        Effects
      </label>

      <div className="grid grid-cols-3 gap-1">
        {ADDABLE.map((a) => (
          <Button
            key={a.type}
            variant="ghost"
            size="compact"
            onClick={() => add(a.type)}
            disabled={effects.length >= 8}
            className="gap-1 text-[11px] h-7"
          >
            <Plus className="size-3" />
            {a.label}
          </Button>
        ))}
      </div>

      {effects.length === 0 && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          Drawn under the subject, in the order you add them. Add the same one
          twice for a two-colour border.
        </p>
      )}

      {effects.map((effect, i) => (
        <div
          key={`${effect.type}-${i}`}
          className={cn("rounded-lg bg-surface-2 shadow-surface-1 p-2.5 space-y-2.5")}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium text-foreground capitalize">
              {i + 1}. {effect.type}
            </span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${effect.type}`}
              className="size-5 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-hover transition-colors duration-80"
            >
              <X className="size-3" />
            </button>
          </div>

          {effect.type === "outline" && (
            <>
              <Slider
                min={1}
                max={64}
                step={1}
                value={[effect.width]}
                onValueChange={([v]) => patch(i, { width: v })}
                label="Width"
                formatValue={(v) => `${v}px`}
                size="compact"
              />
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[effect.tightness]}
                onValueChange={([v]) => patch(i, { tightness: v })}
                label="Tightness"
                formatValue={(v) => (v < 0.3 ? "round" : v > 0.7 ? "exact" : v.toFixed(2))}
                size="compact"
              />
              <Swatch value={effect.color} onChange={(color) => patch(i, { color })} />
            </>
          )}

          {effect.type === "shadow" && (
            <>
              <Slider
                min={0}
                max={128}
                step={1}
                value={[effect.blur]}
                onValueChange={([v]) => patch(i, { blur: v })}
                label="Blur"
                formatValue={(v) => `${v}px`}
                size="compact"
              />
              <Slider
                min={0}
                max={128}
                step={1}
                value={[effect.distance]}
                onValueChange={([v]) => patch(i, { distance: v })}
                label="Distance"
                formatValue={(v) => `${v}px`}
                size="compact"
              />
              <Slider
                min={0}
                max={360}
                step={5}
                value={[effect.angle]}
                onValueChange={([v]) => patch(i, { angle: v })}
                label="Angle"
                formatValue={(v) => `${v}°`}
                size="compact"
              />
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[effect.opacity]}
                onValueChange={([v]) => patch(i, { opacity: v })}
                label="Opacity"
                formatValue={(v) => v.toFixed(2)}
                size="compact"
              />
              <Swatch value={effect.color} onChange={(color) => patch(i, { color })} />
            </>
          )}

          {effect.type === "glow" && (
            <>
              <Slider
                min={1}
                max={128}
                step={1}
                value={[effect.radius]}
                onValueChange={([v]) => patch(i, { radius: v })}
                label="Radius"
                formatValue={(v) => `${v}px`}
                size="compact"
              />
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={[effect.opacity]}
                onValueChange={([v]) => patch(i, { opacity: v })}
                label="Opacity"
                formatValue={(v) => v.toFixed(2)}
                size="compact"
              />
              <Swatch value={effect.color} onChange={(color) => patch(i, { color })} />
            </>
          )}
        </div>
      ))}
    </div>
  )
}

function Swatch({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        Colour
      </label>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{value}</span>
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="size-6 shrink-0 cursor-pointer rounded-md border border-border/60 bg-transparent p-0.5"
        />
      </span>
    </div>
  )
}
