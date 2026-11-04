// Subject filter presets (the filter-gallery idea from full editors),
// expressed as CSS filter strings so they cost one canvas state change.
//
// Presets and manual adjustments compose: the preset string comes first,
// then brightness/contrast/saturation from the sliders.

export interface FilterPreset {
  id: string
  label: string
  css: string
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "none", label: "None", css: "" },
  { id: "vivid", label: "Vivid", css: "saturate(1.35) contrast(1.08)" },
  { id: "warm", label: "Warm", css: "sepia(0.35) saturate(1.2) hue-rotate(-8deg)" },
  { id: "cool", label: "Cool", css: "saturate(0.9) hue-rotate(12deg) brightness(1.03)" },
  { id: "golden", label: "Golden", css: "sepia(0.45) saturate(1.35) contrast(1.02)" },
  { id: "fade", label: "Fade", css: "contrast(0.88) brightness(1.06) saturate(0.8)" },
  { id: "mono", label: "Mono", css: "grayscale(1)" },
  { id: "noir", label: "Noir", css: "grayscale(1) contrast(1.25) brightness(0.95)" },
]

export function presetById(id: string): FilterPreset {
  return FILTER_PRESETS.find((p) => p.id === id) ?? FILTER_PRESETS[0]
}

/** Full subject filter: preset, plus sliders when they leave neutral. */
export function buildSubjectFilter(
  presetId: string,
  adjust: { brightness: number; contrast: number; saturation: number }
): string {
  const parts: string[] = []
  const preset = presetById(presetId).css
  if (preset) parts.push(preset)
  if (adjust.brightness !== 1 || adjust.contrast !== 1 || adjust.saturation !== 1) {
    parts.push(
      `brightness(${adjust.brightness}) contrast(${adjust.contrast}) saturate(${adjust.saturation})`
    )
  }
  return parts.join(" ")
}
