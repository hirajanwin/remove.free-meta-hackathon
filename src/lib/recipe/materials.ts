// What you are cutting out, and what that means for the edge.
//
// A matting model answers one question — which pixels are the subject — and
// every model here answers it the same way for every photograph. But the
// finishing a cutout needs is not a property of the model, it is a property of
// the SUBJECT. Hair wants a wide, gentle guided filter and its semi-transparent
// pixels left alone, because a strand thinner than a pixel is genuinely 40%
// opaque and snapping it to 0 or 255 is how you get the plastic-cutout look. A
// machined product edge wants the opposite: a tight filter and a hard snap,
// because every soft pixel there is upscaling error rather than real coverage.
// Glass is the case that breaks a naive pipeline entirely — most of the subject
// IS semi-transparent, so any threshold at all destroys it.
//
// So `material` is a first-class choice, and it drives the one stage that was
// previously fixed: `refineAlpha`'s guided-filter parameters, plus whether to
// snap the result and how hard.
//
// This is the same move Paperlab makes with paper being plastic rather than
// elastic — take the material seriously and the behaviour follows. The
// difference here is that we cannot infer it, so we ask, and default to the
// setting that is never actively wrong.

import type { RefineOptions } from "../refine"

export type MaterialId = "auto" | "hair" | "fur" | "glass" | "hard" | "soft"

export interface MaterialDef {
  id: MaterialId
  label: string
  /** One line, for the picker. */
  hint: string
  /** Guided-filter parameters for this subject. */
  refine: Required<Pick<RefineOptions, "radius" | "eps">>
  /**
   * Alpha below this becomes 0 and above `255 - snapBelow` becomes 255, after
   * refinement. 0 disables snapping entirely.
   *
   * This is the knob that separates hair from a product shot. A guided filter
   * sharpens the boundary but leaves a residue of low-alpha pixels across the
   * whole band; on a hard edge those are artefacts and removing them is what
   * makes the cut look cut. On hair they are the hair.
   */
  snap: number
  /**
   * Pull the subject's colour away from the background it was shot against, in
   * the semi-transparent band.
   *
   * A pixel that is 40% subject over a green wall is 60% green, and compositing
   * it onto white keeps that green — the fringe everyone recognises as a bad
   * cutout. Estimating the unmixed foreground colour is only worth doing where
   * there IS a band, which is exactly where hair and fur live and exactly where
   * a hard edge does not.
   */
  unmix: number
}

export const MATERIALS: MaterialDef[] = [
  {
    id: "auto",
    label: "Auto",
    hint: "The library's defaults. Never actively wrong, rarely the best answer.",
    // refineAlpha's own defaults, so "auto" is genuinely the behaviour that
    // shipped before materials existed.
    refine: { radius: 2, eps: 1e-4 },
    snap: 0,
    unmix: 0,
  },
  {
    id: "hair",
    label: "Hair",
    hint: "Portraits and loose strands. Keeps partial coverage instead of snapping it away.",
    // Wider radius and looser regularisation: a strand is a thin high-contrast
    // line, and a tight edge-preserving filter treats it as an edge to snap TO
    // rather than a structure to carry through.
    refine: { radius: 4, eps: 4e-4 },
    snap: 0,
    unmix: 0.8,
  },
  {
    id: "fur",
    label: "Fur",
    hint: "Animals. Like hair, but coarser and with more of it.",
    refine: { radius: 5, eps: 6e-4 },
    snap: 0,
    unmix: 0.7,
  },
  {
    id: "glass",
    label: "Glass",
    hint: "Bottles, windows, anything you can see through. Snapping is off — the transparency is the subject.",
    // Tight and edge-preserving: the silhouette matters and the interior
    // gradient must survive untouched. Unmix is off because there is no
    // meaningful "foreground colour" behind glass to solve for.
    refine: { radius: 2, eps: 1e-4 },
    snap: 0,
    unmix: 0,
  },
  {
    id: "hard",
    label: "Hard edge",
    hint: "Products, packaging, text. Snaps the boundary — every soft pixel here is upscaling error.",
    refine: { radius: 1, eps: 5e-5 },
    snap: 24,
    unmix: 0.3,
  },
  {
    id: "soft",
    label: "Soft edge",
    hint: "Fabric, plush, anything with a fuzzy but opaque outline.",
    refine: { radius: 3, eps: 2e-4 },
    snap: 8,
    unmix: 0.5,
  },
]

export const DEFAULT_MATERIAL: MaterialId = "auto"

export function materialById(id: string): MaterialDef {
  return MATERIALS.find((m) => m.id === id) ?? MATERIALS[0]
}

/**
 * Apply a material's snap and unmix to a refined alpha channel, in place.
 *
 * Runs after `refineAlpha`, on the full-resolution mask, and only touches the
 * uncertain band — a pixel the model called certain is left alone whatever the
 * material says, because the material is a statement about edges and that pixel
 * is not on one.
 *
 * `pixels` is the source image, used only for unmixing; pass the same buffer
 * `refineAlpha` was given.
 */
export function applyMaterial(
  alpha: Uint8Array,
  pixels: Uint8Array | Uint8ClampedArray,
  channels: number,
  material: MaterialDef
): { snapped: number; unmixed: number } {
  if (material.snap <= 0 && material.unmix <= 0) return { snapped: 0, unmixed: 0 }

  const lo = material.snap
  const hi = 255 - material.snap
  let snapped = 0
  let unmixed = 0

  // Background estimate: the mean colour of the pixels the model called fully
  // transparent. Cheap, and right for the case that matters — a subject shot
  // against a wall, a sky or a sweep, which is most of them. A busy background
  // makes this a poor estimate, which is why unmix is a strength rather than a
  // switch and why no material sets it to 1.
  let bgR = 0
  let bgG = 0
  let bgB = 0
  let bgN = 0
  if (material.unmix > 0) {
    for (let p = 0; p < alpha.length; p++) {
      if (alpha[p] !== 0) continue
      const i = p * channels
      bgR += pixels[i]
      bgG += pixels[i + 1]
      bgB += pixels[i + 2]
      bgN++
    }
    if (bgN > 0) {
      bgR /= bgN
      bgG /= bgN
      bgB /= bgN
    }
  }

  for (let p = 0; p < alpha.length; p++) {
    const a = alpha[p]
    if (a === 0 || a === 255) continue

    if (material.unmix > 0 && bgN > 0) {
      // C = aF + (1-a)B  =>  F = (C - (1-a)B) / a
      //
      // Unstable as a approaches 0, which is why it is scaled by alpha as well
      // as by strength: a 2%-opaque pixel has almost no foreground in it and
      // solving for one amplifies noise into a bright speck.
      const t = material.unmix * (a / 255)
      const af = a / 255
      const i = p * channels
      const inv = 1 - af
      const fr = (pixels[i] - inv * bgR) / af
      const fg = (pixels[i + 1] - inv * bgG) / af
      const fb = (pixels[i + 2] - inv * bgB) / af
      pixels[i] = Math.max(0, Math.min(255, pixels[i] + (fr - pixels[i]) * t))
      pixels[i + 1] = Math.max(0, Math.min(255, pixels[i + 1] + (fg - pixels[i + 1]) * t))
      pixels[i + 2] = Math.max(0, Math.min(255, pixels[i + 2] + (fb - pixels[i + 2]) * t))
      unmixed++
    }

    if (material.snap > 0) {
      if (a <= lo) {
        alpha[p] = 0
        snapped++
      } else if (a >= hi) {
        alpha[p] = 255
        snapped++
      }
    }
  }

  return { snapped, unmixed }
}
