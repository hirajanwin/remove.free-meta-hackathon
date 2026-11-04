import * as React from "react"
import { Crop, FlipHorizontal2, RotateCcw, Type } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { CROP_ASPECTS, type CropAspect } from "@/lib/crop"
import { FILTER_PRESETS } from "@/lib/filters"
import type { StudioControlsState } from "./studio-context"

/**
 * Finishing, borrowed from full editors (crop, adjustments, type) but
 * scoped to what a cutout needs: everything here applies at composite
 * time, so nothing re-runs a model and every slider is instant.
 */
export function FinishPanel({
  controls,
  onChange,
}: {
  controls: StudioControlsState
  onChange: (updater: (prev: StudioControlsState) => StudioControlsState) => void
}) {
  const adj = controls.adjust
  const setAdj = (patch: Partial<typeof adj>) =>
    onChange((prev) => ({ ...prev, adjust: { ...prev.adjust, ...patch } }))
  const neutral = adj.brightness === 1 && adj.contrast === 1 && adj.saturation === 1

  const presets: Array<{
    label: string
    apply: (prev: StudioControlsState) => Partial<StudioControlsState>
  }> = [
    {
      label: "Marketplace",
      apply: () => ({
        mode: "color",
        color: "#ffffff",
        cropAspect: "1:1",
        adjust: { brightness: 1, contrast: 1, saturation: 1 },
        captionText: "",
      }),
    },
    {
      label: "Social Pop",
      apply: () => ({
        cropAspect: "4:5",
        adjust: { brightness: 1.05, contrast: 1.1, saturation: 1.3 },
      }),
    },
    {
      label: "Studio Dark",
      apply: () => ({
        mode: "color",
        color: "#09090b",
        cropAspect: "none",
        adjust: { brightness: 1, contrast: 1.08, saturation: 1.05 },
      }),
    },
  ]

  return (
    <div id="panel-finish" className="pt-3 space-y-3 scroll-mt-10">
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Crop className="size-3" />
        Finish
      </label>

      {/* Treatment presets: design once, reuse on every image. */}
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange((prev) => ({ ...prev, ...p.apply(prev) }))}
            className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-80"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Subject-centred crop */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">Crop (around subject)</span>
        <TabsSubtle
          selectedIndex={Math.max(
            0,
            CROP_ASPECTS.findIndex((a) => a.id === controls.cropAspect)
          )}
          onSelect={(i) =>
            onChange((prev) => ({ ...prev, cropAspect: CROP_ASPECTS[i].id as CropAspect }))
          }
          size="compact"
          className="w-full flex"
        >
          {CROP_ASPECTS.map((a, i) => (
            <TabsSubtleItem key={a.id} index={i} label={a.label} />
          ))}
        </TabsSubtle>
      </div>

      {/* Filter gallery */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">Filter</span>
        <div className="flex flex-wrap gap-1">
          {FILTER_PRESETS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={controls.filterPreset === f.id}
              onClick={() => onChange((prev) => ({ ...prev, filterPreset: f.id }))}
              className={
                "rounded-full px-2 py-0.5 text-[10px] transition-colors duration-80 " +
                (controls.filterPreset === f.id
                  ? "bg-selected text-foreground"
                  : "bg-surface-3 text-muted-foreground hover:text-foreground")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Relighting */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">Relight subject</span>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={[controls.relight.intensity]}
          onValueChange={([v]) =>
            onChange((prev) => ({ ...prev, relight: { ...prev.relight, intensity: v } }))
          }
          label="Intensity"
          formatValue={(v) => (v === 0 ? "off" : v.toFixed(2))}
          size="compact"
          variant="compact"
        />
        {controls.relight.intensity > 0 && (
          <Slider
            min={0}
            max={360}
            step={5}
            value={[controls.relight.angle]}
            onValueChange={([v]) =>
              onChange((prev) => ({ ...prev, relight: { ...prev.relight, angle: v } }))
            }
            label="Light angle"
            formatValue={(v) => `${v}°`}
            size="compact"
            variant="compact"
          />
        )}
      </div>

      {/* Adjustments */}
      <Slider
        min={0.4}
        max={1.8}
        step={0.02}
        value={[adj.brightness]}
        onValueChange={([v]) => setAdj({ brightness: v })}
        label="Brightness"
        formatValue={(v) => v.toFixed(2)}
        size="compact"
        variant="compact"
      />
      <Slider
        min={0.4}
        max={1.8}
        step={0.02}
        value={[adj.contrast]}
        onValueChange={([v]) => setAdj({ contrast: v })}
        label="Contrast"
        formatValue={(v) => v.toFixed(2)}
        size="compact"
        variant="compact"
      />
      <Slider
        min={0}
        max={2}
        step={0.02}
        value={[adj.saturation]}
        onValueChange={([v]) => setAdj({ saturation: v })}
        label="Saturation"
        formatValue={(v) => v.toFixed(2)}
        size="compact"
        variant="compact"
      />
      {!neutral && (
        <button
          type="button"
          onClick={() => setAdj({ brightness: 1, contrast: 1, saturation: 1 })}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        >
          <RotateCcw className="size-3" /> Reset adjustments
        </button>
      )}

      {/* Flip */}
      <Button
        variant={controls.flipSubject ? "secondary" : "ghost"}
        size="compact"
        aria-pressed={controls.flipSubject}
        onClick={() => onChange((prev) => ({ ...prev, flipSubject: !prev.flipSubject }))}
        className="w-full justify-between h-7 text-[11px]"
      >
        <span className="flex items-center gap-1.5">
          <FlipHorizontal2 className="size-3.5" /> Flip subject
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {controls.flipSubject ? "on" : "off"}
        </span>
      </Button>

      {/* Promo badge */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground">Promo badge</span>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={controls.badgeText}
            onChange={(e) => onChange((prev) => ({ ...prev, badgeText: e.target.value }))}
            placeholder="SALE, -20%, NEW…"
            aria-label="Promo badge text"
            maxLength={10}
            className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
          />
          {["SALE", "-20%", "NEW"].map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => onChange((prev) => ({ ...prev, badgeText: b }))}
              className="rounded-full bg-surface-3 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors duration-80"
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      {/* Caption */}
      <div className="space-y-1.5">
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Type className="size-3" /> Caption
        </span>
        <input
          type="text"
          value={controls.captionText}
          onChange={(e) => onChange((prev) => ({ ...prev, captionText: e.target.value }))}
          placeholder="Text over the image"
          aria-label="Caption text"
          className="w-full h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
        />
        {controls.captionText.trim() && (
          <TabsSubtle
            selectedIndex={controls.captionPosition === "bottom" ? 0 : 1}
            onSelect={(i) =>
              onChange((prev) => ({
                ...prev,
                captionPosition: i === 0 ? "bottom" : "top",
              }))
            }
            size="compact"
            className="w-full flex"
          >
            <TabsSubtleItem index={0} label="Bottom" />
            <TabsSubtleItem index={1} label="Top" />
          </TabsSubtle>
        )}
      </div>

      <p className="text-[10px] leading-snug text-muted-foreground">
        Adjustments and flip touch the subject only; the backdrop is left
        alone. Everything applies instantly — no model re-runs.
      </p>
    </div>
  )
}
