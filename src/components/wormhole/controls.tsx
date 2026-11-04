import * as React from "react"
import { ChevronRight, RotateCcw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import {
  DEBUG_MODES,
  DITHER_MODES,
  DITHER_SHAPES,
  type GridSettings,
  type ShapeKind,
  type ShapeSettings,
  type WormholePreset,
} from "@/lib/wormhole/presets"

/**
 * Every parameter the reference exposes through Leva, in this app's own
 * controls.
 *
 * Leva shows about fifty of these in a floating dev panel. That is genuinely
 * useful — half the value of the original is being able to find a look by
 * dragging — so none of them are dropped; they are grouped into collapsible
 * sections instead, all closed but the first, so the panel is a short list
 * until you open something.
 */

export interface Overrides {
  preset?: Partial<Omit<WormholePreset, "shape" | "grid">>
  shape?: Partial<ShapeSettings>
  grid?: Partial<GridSettings>
}

interface ControlsProps {
  preset: WormholePreset
  overrides: Overrides
  onOverride: (next: Overrides) => void
  debugMode: number
  onDebugMode: (mode: number) => void
  bloom: boolean
  onBloom: (on: boolean) => void
  speed: number
  onSpeed: (v: number) => void
  imageScale: number
  onImageScale: (v: number) => void
}

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  const id = React.useId()

  return (
    <div className="rounded-xl bg-surface-2 shadow-surface-1 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-hover transition-colors duration-80"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform duration-160",
            open && "rotate-90"
          )}
          aria-hidden="true"
        />
        {title}
      </button>
      {/* Unmounted rather than hidden when closed: nine sections of sliders is
          a lot of Radix primitives to keep mounted for a panel nobody opened. */}
      {open && (
        <div id={id} className="px-2.5 pb-2.5 space-y-2.5">
          {children}
        </div>
      )}
    </div>
  )
}

function Num({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <Slider
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={([v]) => onChange(v)}
      label={label}
      formatValue={format ?? ((v) => (step < 1 ? v.toFixed(2) : String(v)))}
      size="compact"
    />
  )
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <Button
      variant={on ? "secondary" : "ghost"}
      size="compact"
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className="w-full justify-between"
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {on ? "on" : "off"}
      </span>
    </Button>
  )
}

function Swatch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{value}</span>
        {/* A native colour input. The platform picker is better than anything
            worth building here, and it is keyboard-operable for free. */}
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

/** A wrapping row of small radio-ish buttons, for the long option lists. */
function Options<T extends number | string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="space-y-1.5">
      <span
        className="text-[11px] text-muted-foreground"
        id={`${label}-label`}
      >
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${label}-label`}
        className="flex flex-wrap gap-1"
      >
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[10px] transition-colors duration-80",
              o.value === value
                ? "bg-selected text-foreground"
                : "text-muted-foreground hover:bg-hover hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function WormholeControls({
  preset,
  overrides,
  onOverride,
  debugMode,
  onDebugMode,
  bloom,
  onBloom,
  speed,
  onSpeed,
  imageScale,
  onImageScale,
}: ControlsProps) {
  const setP = <K extends keyof Omit<WormholePreset, "shape" | "grid">>(
    key: K,
    value: WormholePreset[K]
  ) => onOverride({ ...overrides, preset: { ...overrides.preset, [key]: value } })

  const setShape = <K extends keyof ShapeSettings>(key: K, value: ShapeSettings[K]) =>
    onOverride({ ...overrides, shape: { ...overrides.shape, [key]: value } })

  const setGrid = <K extends keyof GridSettings>(key: K, value: GridSettings[K]) =>
    onOverride({ ...overrides, grid: { ...overrides.grid, [key]: value } })

  const dirty =
    !!overrides.preset || !!overrides.shape || !!overrides.grid

  return (
    <div className="space-y-2">
      {dirty && (
        <Button
          variant="ghost"
          size="compact"
          onClick={() => onOverride({})}
          className="w-full justify-start gap-1.5"
        >
          <RotateCcw className="size-3.5" />
          Back to the {preset.label} preset
        </Button>
      )}

      <Section title="Motion" defaultOpen>
        <Num
          label="Speed"
          value={speed}
          min={0}
          max={2}
          step={0.05}
          onChange={onSpeed}
          format={(v) => (v === 0 ? "held" : `${v.toFixed(2)}×`)}
        />
        <Num
          label="Slot size"
          value={imageScale}
          min={0.3}
          max={1.6}
          step={0.01}
          onChange={onImageScale}
          format={(v) => `${v.toFixed(2)}×`}
        />
        <Num
          label="Pinch"
          value={preset.squeezeMax}
          min={0}
          max={0.8}
          step={0.01}
          onChange={(v) => setP("squeezeMax", v)}
        />
        <Num
          label="Pinch width"
          value={preset.squeezeWidth}
          min={1}
          max={15}
          step={0.5}
          onChange={(v) => setP("squeezeWidth", v)}
        />
      </Section>

      <Section title="Image">
        <Num
          label="Brightness"
          value={preset.brightness}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => setP("brightness", v)}
        />
        <Num
          label="Saturation"
          value={preset.saturation}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => setP("saturation", v)}
        />
        <Num
          label="Emission"
          value={preset.emission}
          min={0}
          max={3}
          step={0.05}
          onChange={(v) => setP("emission", v)}
        />
        <Num
          label="Aberration"
          value={preset.chromaticAberration}
          min={0}
          max={0.15}
          step={0.005}
          onChange={(v) => setP("chromaticAberration", v)}
          format={(v) => v.toFixed(3)}
        />
        <Num
          label="Fade start"
          value={preset.distanceFadeStart}
          min={0}
          max={20}
          step={0.5}
          onChange={(v) => setP("distanceFadeStart", v)}
        />
        <Num
          label="Fade end"
          value={preset.distanceFadeEnd}
          min={1}
          max={30}
          step={0.5}
          onChange={(v) => setP("distanceFadeEnd", v)}
        />
      </Section>

      <Section title="Scan lines & flicker">
        <Num
          label="Scan lines"
          value={preset.scanLines}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) => setP("scanLines", v)}
        />
        <Num
          label="Scan speed"
          value={preset.scanLineSpeed}
          min={0}
          max={5}
          step={0.1}
          onChange={(v) => setP("scanLineSpeed", v)}
        />
        <Num
          label="Scan density"
          value={preset.scanLineDensity}
          min={5}
          max={100}
          step={1}
          onChange={(v) => setP("scanLineDensity", v)}
        />
        <Num
          label="Flicker"
          value={preset.flickerIntensity}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => setP("flickerIntensity", v)}
        />
        <Num
          label="Flicker speed"
          value={preset.flickerSpeed}
          min={0.1}
          max={5}
          step={0.1}
          onChange={(v) => setP("flickerSpeed", v)}
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          Both are off under reduced motion whatever these say — they animate
          forever with no end state.
        </p>
      </Section>

      <Section title="Dither">
        <Toggle
          label="Dither"
          on={preset.ditherEnabled}
          onChange={(v) => setP("ditherEnabled", v)}
        />
        {preset.ditherEnabled && (
          <>
            <Options
              label="Mode"
              value={preset.ditherMode}
              options={DITHER_MODES}
              onChange={(v) => setP("ditherMode", v)}
            />
            <Options
              label="Shape"
              value={preset.ditherShape}
              options={DITHER_SHAPES}
              onChange={(v) => setP("ditherShape", v as 0 | 1 | 2)}
            />
            <Num
              label="Cell size"
              value={preset.ditherCellSize}
              min={1}
              max={20}
              step={0.5}
              onChange={(v) => setP("ditherCellSize", v)}
            />
            <Num
              label="Gap"
              value={preset.ditherGap}
              min={0}
              max={20}
              step={0.25}
              onChange={(v) => setP("ditherGap", v)}
            />
            <Num
              label="Contrast"
              value={preset.ditherContrast}
              min={-1}
              max={1}
              step={0.01}
              onChange={(v) => setP("ditherContrast", v)}
            />
            <Num
              label="Base scale"
              value={preset.ditherBaseScale}
              min={0.1}
              max={5}
              step={0.01}
              onChange={(v) => setP("ditherBaseScale", v)}
            />
            <Num
              label="Intensity"
              value={preset.ditherIntensity}
              min={0}
              max={5}
              step={0.01}
              onChange={(v) => setP("ditherIntensity", v)}
            />
            <Toggle
              label="Use image colour"
              on={preset.ditherUseColor}
              onChange={(v) => setP("ditherUseColor", v)}
            />
            {!preset.ditherUseColor && (
              <Swatch
                label="Dot colour"
                value={preset.ditherFgColor}
                onChange={(v) => setP("ditherFgColor", v)}
              />
            )}
          </>
        )}
      </Section>

      <Section title="Frame">
        <Num
          label="Border"
          value={preset.borderWidth}
          min={0}
          max={0.1}
          step={0.005}
          onChange={(v) => setP("borderWidth", v)}
          format={(v) => (v === 0 ? "none" : v.toFixed(3))}
        />
        <Num
          label="Border glow"
          value={preset.borderEmission}
          min={0}
          max={5}
          step={0.1}
          onChange={(v) => setP("borderEmission", v)}
        />
        <Swatch
          label="Border colour"
          value={preset.borderColor}
          onChange={(v) => setP("borderColor", v)}
        />
        <Num
          label="Corner size"
          value={preset.cornerSize}
          min={0}
          max={0.3}
          step={0.005}
          onChange={(v) => setP("cornerSize", v)}
          format={(v) => (v === 0 ? "none" : v.toFixed(3))}
        />
        <Num
          label="Corner width"
          value={preset.cornerWidth}
          min={0.002}
          max={0.05}
          step={0.002}
          onChange={(v) => setP("cornerWidth", v)}
          format={(v) => v.toFixed(3)}
        />
        <Num
          label="Corner offset"
          value={preset.cornerOffset}
          min={0}
          max={0.2}
          step={0.005}
          onChange={(v) => setP("cornerOffset", v)}
          format={(v) => v.toFixed(3)}
        />
        <p className="text-[11px] text-muted-foreground leading-snug">
          Off in every preset. A cutout has no rectangle — drawing one back puts
          the box around the subject this app exists to remove.
        </p>
      </Section>

      <Section title="Centre shape">
        <Options<ShapeKind>
          label="Shape"
          value={preset.shape.kind}
          options={[
            { value: "none", label: "None" },
            { value: "torus", label: "Torus" },
            { value: "torusKnot", label: "Knot" },
            { value: "cube", label: "Cube" },
          ]}
          onChange={(v) => setShape("kind", v)}
        />
        {preset.shape.kind !== "none" && (
          <>
            <Swatch
              label="Colour"
              value={preset.shape.color}
              onChange={(v) => setShape("color", v)}
            />
            <Num
              label="Scale"
              value={preset.shape.scale}
              min={0.1}
              max={10}
              step={0.1}
              onChange={(v) => setShape("scale", v)}
            />
            <Num
              label="Opacity"
              value={preset.shape.opacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setShape("opacity", v)}
            />
            <Num
              label="Tilt X"
              value={preset.shape.tiltX}
              min={-Math.PI}
              max={Math.PI}
              step={0.01}
              onChange={(v) => setShape("tiltX", v)}
            />
            <Num
              label="Tilt Z"
              value={preset.shape.tiltZ}
              min={-Math.PI}
              max={Math.PI}
              step={0.01}
              onChange={(v) => setShape("tiltZ", v)}
            />
            <Num
              label="Scroll squash"
              value={preset.shape.scaleReact}
              min={0}
              max={0.5}
              step={0.01}
              onChange={(v) => setShape("scaleReact", v)}
            />
            <Toggle
              label="Single side"
              on={preset.shape.singleSide}
              onChange={(v) => setShape("singleSide", v)}
            />
          </>
        )}
      </Section>

      <Section title="Grid">
        <Toggle
          label="Grid"
          on={preset.grid.enabled}
          onChange={(v) => setGrid("enabled", v)}
        />
        {preset.grid.enabled && (
          <>
            <Swatch
              label="Line colour"
              value={preset.grid.lineColor}
              onChange={(v) => setGrid("lineColor", v)}
            />
            <Swatch
              label="Dot colour"
              value={preset.grid.dotColor}
              onChange={(v) => setGrid("dotColor", v)}
            />
            <Swatch
              label="Fill"
              value={preset.grid.bgColor}
              onChange={(v) => setGrid("bgColor", v)}
            />
            <Num
              label="Fill opacity"
              value={preset.grid.bgOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setGrid("bgOpacity", v)}
            />
            <Num
              label="Radius"
              value={preset.grid.radius}
              min={10}
              max={80}
              step={1}
              onChange={(v) => setGrid("radius", v)}
            />
            <Num
              label="Height"
              value={preset.grid.height}
              min={20}
              max={200}
              step={5}
              onChange={(v) => setGrid("height", v)}
            />
            <Num
              label="Cell size"
              value={preset.grid.cellSize}
              min={0.05}
              max={1}
              step={0.01}
              onChange={(v) => setGrid("cellSize", v)}
            />
            <Num
              label="Subdivisions"
              value={preset.grid.subdivisions}
              min={1}
              max={6}
              step={1}
              onChange={(v) => setGrid("subdivisions", v)}
            />
            <Num
              label="Tile around"
              value={preset.grid.tileX}
              min={1}
              max={40}
              step={1}
              onChange={(v) => setGrid("tileX", v)}
            />
            <Num
              label="Tile up"
              value={preset.grid.tileY}
              min={1}
              max={40}
              step={1}
              onChange={(v) => setGrid("tileY", v)}
            />
            <Num
              label="Major lines"
              value={preset.grid.majorLineOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setGrid("majorLineOpacity", v)}
            />
            <Num
              label="Minor lines"
              value={preset.grid.minorLineOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setGrid("minorLineOpacity", v)}
            />
            <Num
              label="Dots"
              value={preset.grid.dotOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => setGrid("dotOpacity", v)}
            />
            <Num
              label="Dot size"
              value={preset.grid.dotSize}
              min={0.001}
              max={0.03}
              step={0.001}
              onChange={(v) => setGrid("dotSize", v)}
              format={(v) => v.toFixed(3)}
            />
            <Num
              label="Centre gap"
              value={preset.grid.horizontalFade}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setGrid("horizontalFade", v)}
            />
            <Num
              label="Gap softness"
              value={preset.grid.horizontalFadeSoftness}
              min={0.01}
              max={1}
              step={0.05}
              onChange={(v) => setGrid("horizontalFadeSoftness", v)}
            />
          </>
        )}
      </Section>

      <Section title="Bloom">
        <Toggle label="Bloom" on={bloom} onChange={onBloom} />
        {bloom && (
          <>
            <Num
              label="Intensity"
              value={preset.bloomIntensity}
              min={0}
              max={10}
              step={0.1}
              onChange={(v) => setP("bloomIntensity", v)}
            />
            <Num
              label="Threshold"
              value={preset.bloomThreshold}
              min={0}
              max={2}
              step={0.01}
              onChange={(v) => setP("bloomThreshold", v)}
            />
            <Num
              label="Smoothing"
              value={preset.bloomSmoothing}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setP("bloomSmoothing", v)}
            />
            <Num
              label="Radius"
              value={preset.bloomRadius}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => setP("bloomRadius", v)}
            />
          </>
        )}
      </Section>

      <Section title="Debug">
        <TabsSubtle
          selectedIndex={DEBUG_MODES.findIndex((d) => d.value === debugMode)}
          onSelect={(i) => onDebugMode(DEBUG_MODES[i].value)}
          size="compact"
          className="w-full flex"
        >
          {DEBUG_MODES.map((d, i) => (
            <TabsSubtleItem key={d.value} index={i} label={d.label} />
          ))}
        </TabsSubtle>
        <p className="text-[11px] text-muted-foreground leading-snug">
          Colours gives every slot its own hue, which is how you see two slots
          landing on the same spot. Depth shows the front-to-back fade. Flat
          drops the cylinder bend so you can see what it was doing. All three
          switch the grid, the centre shape and bloom off.
        </p>
      </Section>
    </div>
  )
}
