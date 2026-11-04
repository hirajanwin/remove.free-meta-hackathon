// Baked looks, in place of a GUI.
//
// The reference drives ~50 parameters through Leva, which is the right tool
// while you are finding the values and the wrong thing to ship: it is a
// development panel with its own styling, its own fonts and about 50 KB, and
// this app already has a control vocabulary — segmented tabs and sliders in the
// right sidebar. So the parameters that were worth exposing are exposed through
// those, and the rest are constants here.
//
// Values that came from the reference are kept at the reference's numbers,
// because they are the result of someone tuning them by eye and there is no
// better source for them than that. Where a number had to change, the reason
// is stated.

import type { Backend } from "../models"

/** The thirteen dither modes from the reference, in its own order. */
export const DITHER_MODES = [
  { value: 0, label: "Static" },
  { value: 1, label: "Halftone" },
  { value: 2, label: "Inv Halftone" },
  { value: 3, label: "Rotation" },
  { value: 4, label: "Stretch V" },
  { value: 5, label: "Stretch H" },
  { value: 6, label: "Checkerboard" },
  { value: 8, label: "Glitch" },
  { value: 9, label: "Melt" },
  { value: 10, label: "Edge Detect" },
  { value: 12, label: "Quantize" },
  { value: 13, label: "Noise" },
  { value: 15, label: "Threshold" },
] as const

/** All eleven dot shapes. */
export const DITHER_SHAPES = [
  { value: 0, label: "Circle" },
  { value: 1, label: "Square" },
  { value: 2, label: "Diamond" },
  { value: 3, label: "Hexagon" },
  { value: 4, label: "Rect V" },
  { value: 5, label: "Rect H" },
  { value: 6, label: "Diagonal" },
  { value: 7, label: "Octagon" },
  { value: 8, label: "Star" },
  { value: 9, label: "Hollow" },
  { value: 10, label: "Plus" },
] as const

/** Debug views. The reference exposes these and they earn their keep. */
export const DEBUG_MODES = [
  { value: 0, label: "Off" },
  { value: 1, label: "Colours" },
  { value: 2, label: "Depth" },
  { value: 3, label: "Flat" },
] as const

export type ShapeKind = "none" | "torus" | "torusKnot" | "cube"

export interface ShapeSettings {
  kind: ShapeKind
  scale: number
  color: string
  opacity: number
  tiltX: number
  tiltZ: number
  scaleReact: number
  scaleSmoothing: number
  singleSide: boolean
}

export interface GridSettings {
  enabled: boolean
  radius: number
  height: number
  cellSize: number
  subdivisions: number
  tileX: number
  tileY: number
  majorLineWidth: number
  minorLineWidth: number
  dotSize: number
  lineColor: string
  dotColor: string
  majorLineOpacity: number
  minorLineOpacity: number
  dotOpacity: number
  bgColor: string
  bgOpacity: number
  horizontalFade: number
  horizontalFadeSoftness: number
}

export interface WormholePreset {
  id: string
  label: string
  /** One line, for the picker. */
  hint: string
  ditherMode: number
  ditherIntensity: number
  shape: ShapeSettings
  grid: GridSettings
  bloomIntensity: number
  bloomThreshold: number
  bloomRadius: number
  bloomSmoothing: number
  emission: number
  saturation: number
  brightness: number
  scanLines: number
  scanLineSpeed: number
  scanLineDensity: number
  chromaticAberration: number
  flickerIntensity: number
  flickerSpeed: number
  squeezeMax: number
  squeezeWidth: number
  /** Slots fade out beyond this distance from the ring's centre, in world units. */
  distanceFadeStart: number
  distanceFadeEnd: number
  ditherEnabled: boolean
  ditherCellSize: number
  ditherGap: number
  ditherContrast: number
  ditherBaseScale: number
  ditherShape: 0 | 1 | 2
  ditherUseColor: boolean
  ditherFgColor: string
  borderWidth: number
  borderColor: string
  borderEmission: number
  cornerSize: number
  cornerWidth: number
  cornerOffset: number
  background: string
}

/**
 * The frame is off in every preset here, and that is a deliberate departure.
 *
 * The reference draws a 1px white rectangle and corner brackets around each
 * slot, which frames a photograph nicely. A cutout has no rectangle — removing
 * it is the entire product — so drawing one back puts the box around the
 * subject that the user just paid several seconds of GPU time to delete. The
 * brackets survive as an opt-in because they read as an instrument's reticle
 * rather than as the image's edge.
 */
/** The reference's Torus defaults, verbatim. */
const SHAPE: ShapeSettings = {
  kind: "torus",
  scale: 2.3,
  color: "#6df4ce",
  opacity: 0.8,
  tiltX: -0.5,
  tiltZ: -1.95,
  scaleReact: 0.02,
  scaleSmoothing: 0.04,
  singleSide: true,
}

/**
 * The green grid, at the reference's own values.
 *
 * This is the look the reference actually ships with — its Scene defaults to
 * the `greenScifi` preset with the grid and the centre shape both on, which is
 * why that scene reads as a lit workbench rather than as images in a void.
 */
const GRID: GridSettings = {
  enabled: true,
  radius: 32,
  height: 90,
  cellSize: 0.45,
  subdivisions: 2,
  tileX: 17,
  tileY: 5,
  majorLineWidth: 0.005,
  minorLineWidth: 0.004,
  dotSize: 0.011,
  lineColor: "#6df4ce",
  dotColor: "#6df4ce",
  majorLineOpacity: 0.46,
  minorLineOpacity: 0.14,
  dotOpacity: 1,
  bgColor: "#015a2e",
  bgOpacity: 0.51,
  horizontalFade: 0.1,
  horizontalFadeSoftness: 0.7,
}

const NO_FRAME = {
  borderWidth: 0,
  borderColor: "#ffffff",
  borderEmission: 0,
  cornerSize: 0,
  cornerWidth: 0.01,
  cornerOffset: 0.03,
}

export const PRESETS: WormholePreset[] = [
  {
    id: "vault",
    label: "Vault",
    hint: "Your cutouts, unmodified. The matte is the effect. No grid.",
    ditherMode: 2,
    ditherIntensity: 2.61,
    shape: { ...SHAPE, kind: "none" },
    grid: { ...GRID, enabled: false },
    // Bloom low: a cutout is mostly transparent, so bloom has little to catch
    // and what it does catch is the matte's soft edge — turned up, it fringes
    // exactly the hair detail the models work hardest to preserve.
    bloomIntensity: 0.45,
    bloomThreshold: 0.35,
    bloomRadius: 0.6,
    bloomSmoothing: 0.45,
    emission: 0.15,
    saturation: 1.05,
    brightness: 1.05,
    scanLines: 0,
    scanLineSpeed: 0,
    scanLineDensity: 25,
    chromaticAberration: 0,
    flickerIntensity: 0,
    flickerSpeed: 0,
    squeezeMax: 0.5,
    squeezeWidth: 7.5,
    distanceFadeStart: 3,
    distanceFadeEnd: 8,
    ditherEnabled: false,
    ditherCellSize: 5,
    ditherGap: 2.75,
    ditherContrast: 0,
    ditherBaseScale: 0.76,
    ditherShape: 0,
    ditherUseColor: true,
    ditherFgColor: "#ffffff",
    ...NO_FRAME,
    background: "#0a0a0b",
  },
  {
    id: "hologram",
    label: "Hologram",
    hint: "Scan lines, flicker and aberration, over a white grid.",
    ditherMode: 2,
    ditherIntensity: 2.61,
    shape: { ...SHAPE, color: "#ffffff" },
    grid: {
      ...GRID,
      lineColor: "#ffffff",
      dotColor: "#ffffff",
      bgColor: "#0a0f18",
      majorLineOpacity: 0.22,
      minorLineOpacity: 0.07,
      dotOpacity: 0.5,
      bgOpacity: 0.35,
    },
    bloomIntensity: 1.2,
    bloomThreshold: 0.01,
    bloomRadius: 0.65,
    bloomSmoothing: 0.45,
    emission: 0.65,
    saturation: 1.5,
    brightness: 1.15,
    scanLines: 0.6,
    scanLineSpeed: 3.9,
    scanLineDensity: 25,
    chromaticAberration: 0.02,
    flickerIntensity: 0.18,
    flickerSpeed: 5,
    squeezeMax: 0.5,
    squeezeWidth: 7.5,
    distanceFadeStart: 3,
    distanceFadeEnd: 8,
    ditherEnabled: false,
    ditherCellSize: 5,
    ditherGap: 2.75,
    ditherContrast: 0,
    ditherBaseScale: 0.76,
    ditherShape: 0,
    ditherUseColor: true,
    ditherFgColor: "#ffffff",
    // No brackets, on reflection. They looked good, but the argument above for
    // dropping the frame applies to them too: twenty slots' worth of corner
    // marks redraws the grid the cutout is supposed to have escaped, and this
    // preset's whole point is the aberration and flicker on the subject.
    ...NO_FRAME,
    background: "#05070a",
  },
  {
    id: "halftone",
    label: "Halftone",
    hint: "The cutout resolved into dots, each sized by its own brightness.",
    ditherMode: 2,
    ditherIntensity: 2.61,
    shape: { ...SHAPE, kind: "torusKnot", color: "#ffffff" },
    grid: {
      ...GRID,
      lineColor: "#ffffff",
      dotColor: "#ffffff",
      bgColor: "#101014",
      majorLineOpacity: 0.2,
      minorLineOpacity: 0.06,
      dotOpacity: 0.45,
      bgOpacity: 0.3,
    },
    bloomIntensity: 0.8,
    bloomThreshold: 0.2,
    bloomRadius: 0.6,
    bloomSmoothing: 0.45,
    emission: 0.3,
    saturation: 1.2,
    brightness: 1.1,
    scanLines: 0,
    scanLineSpeed: 0,
    scanLineDensity: 25,
    chromaticAberration: 0,
    flickerIntensity: 0,
    flickerSpeed: 0,
    squeezeMax: 0.5,
    squeezeWidth: 7.5,
    distanceFadeStart: 3,
    distanceFadeEnd: 8,
    ditherEnabled: true,
    // Larger cells than the reference's 5. Its images fill their quad; a cutout
    // covers maybe a third of one, so at cell size 5 the subject dissolves into
    // dots too fine to read as a subject at all.
    ditherCellSize: 7,
    ditherGap: 2.75,
    ditherContrast: 0,
    ditherBaseScale: 0.9,
    ditherShape: 0,
    ditherUseColor: true,
    ditherFgColor: "#ffffff",
    ...NO_FRAME,
    background: "#0a0a0b",
  },
  {
    id: "scifi",
    label: "Cutting Board",
    hint: "The reference's own default: green phosphor on a ruled grid, with the wireframe torus at the centre.",
    ditherMode: 2,
    ditherIntensity: 2.61,
    shape: SHAPE,
    grid: GRID,
    bloomIntensity: 0.9,
    bloomThreshold: 0.01,
    bloomRadius: 0.65,
    bloomSmoothing: 0.45,
    emission: 0.65,
    saturation: 1.5,
    brightness: 1.15,
    scanLines: 0.6,
    scanLineSpeed: 3.9,
    scanLineDensity: 25,
    chromaticAberration: 0.02,
    flickerIntensity: 0.18,
    flickerSpeed: 5,
    squeezeMax: 0.5,
    squeezeWidth: 7.5,
    distanceFadeStart: 3,
    distanceFadeEnd: 8,
    ditherEnabled: true,
    ditherCellSize: 7,
    ditherGap: 5.5,
    ditherContrast: -0.02,
    ditherBaseScale: 0.44,
    ditherShape: 1,
    ditherUseColor: false,
    ditherFgColor: "#6df4ce",
    ...NO_FRAME,
    borderColor: "#6df4ce",
    borderEmission: 1.6,
    // Brackets stay here alone: on a monochrome phosphor look they read as an
    // instrument's reticle rather than as the image's edge, which is the one
    // case where marking the slot is the point.
    cornerSize: 0.06,
    background: "#04100c",
  },
]

/**
 * The reference's Scene defaults to `greenScifi`, and it is the look the
 * project is recognised by, so it is the default here too.
 */
export const DEFAULT_PRESET_ID = "scifi"

export function presetById(id: string): WormholePreset {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0]
}

/** Geometry and layout. Reference values, except where noted. */
export const LAYOUT: {
  radius: number
  planeWidth: number
  planeHeight: number
  segmentsX: number
  segmentsY: number
  imagesPerTurn: number
  spiralStep: number
  imageScale: number
  curvature: number
} = {
  radius: 6,
  /**
   * The reference's slot is 6 x 2.7 — a 2.22:1 letterbox, which is the aspect
   * of the images it ships with. Feed it an ordinary 3:2 photograph and the
   * image occupies about a third of its slot's width with dark bars either
   * side; the ring reads as sparse rather than full, which is what it looked
   * like on the first render here.
   *
   * 4.2 x 2.7 is 1.56:1, near enough to 3:2 that the letterboxing disappears,
   * and it keeps portrait cutouts a usable size. Slots-per-turn follows from
   * it: the circumference at radius 6 is 2*pi*6 = 37.7, so 37.7 / 4.2 = 9.
   */
  planeWidth: 4.2,
  planeHeight: 2.7,
  /**
   * The reference uses 40x20 segments per plane. Each of those vertices runs
   * the cylinder bend, so the cost is real; 24x12 is where the silhouette of
   * the bend stopped visibly improving at this radius.
   */
  segmentsX: 24,
  segmentsY: 12,
  imagesPerTurn: 9,
  spiralStep: 0.8,
  imageScale: 0.83,
  curvature: 1.5,
}

export const MOTION = {
  momentum: 0.87,
  scrollAdvanceSpeed: 0.17,
  autoRotateSpeed: 0.002,
  scrollRotateForce: 1.75,
  maxRotationSpeed: 0.15,
  rotationSmoothing: 0.09,
} as const

export const CAMERA: Record<
  | "fov"
  | "panIntensityX"
  | "panIntensityY"
  | "smoothing"
  | "baseZoom"
  | "maxZoomOut"
  | "zoomSpeed"
  | "zoomDecay",
  number
> = {
  panIntensityX: 0.8,
  panIntensityY: 1.2,
  smoothing: 0.06,
  /**
   * fov 75 and 12 units back, both from the reference.
   *
   * I had 45 and 11, which is a much narrower cone — and it made the grid look
   * broken rather than merely tighter. The grid shader deliberately hides the
   * wall straight ahead (`horizontalFade`) so the ruled surface reads as walls
   * either side of the gallery; at fov 45 the only part in frame IS the hidden
   * part, so the whole enclosure rendered invisible. Nothing was wrong with
   * the grid.
   */
  fov: 75,
  baseZoom: 12,
  maxZoomOut: 28.5,
  zoomSpeed: 0.05,
  zoomDecay: 0.1,
}

/**
 * How many slots the ring holds — and it MUST be a whole multiple of
 * `imagesPerTurn`.
 *
 * This is the bug behind two cutouts landing on top of each other. The ring is
 * finite: the vertex stage wraps a slot's Y with
 * `mod(y + T/2, T) - T/2`, so a slot leaving the top re-enters at the bottom.
 * For that to be seamless the slot arriving at the bottom has to take the angle
 * the slot below it would have had, which means the total angular travel over
 * `count` slots must be a whole number of revolutions:
 * `count / imagesPerTurn` has to be an integer. It was not.
 *
 * Measured, by reproducing the placement on the CPU and sweeping the scroll
 * through a full wrap while tracking the closest pair of slot centres:
 *
 *   count  perTurn  turns   closest pair
 *      20        7  2.857   4.80          (the reference's own defaults)
 *      20        9  2.222   1.60   <-- overlapping
 *      12        9  1.333   2.40   <-- overlapping
 *      18        9  2.000   4.18          closes
 *       9        9  1.000   4.18          closes
 *
 * The slot is 4.2 wide, so a 1.6 separation is not a near miss — it is one
 * cutout drawn through another. Every configuration where `turns` is an
 * integer jumps to a safe 4.18, and every one where it is not collapses. The
 * reference never hit this because 20/7 leaves its seam wide enough to hide;
 * narrowing the slot to fit photographs took `imagesPerTurn` to 9 and turned a
 * latent bug into a visible one.
 */
export function instanceCountFor(backend: Backend): number {
  const turns = backend === "webgpu" ? 2 : 1
  return turns * LAYOUT.imagesPerTurn
}

/**
 * Which atlas tile each slot shows.
 *
 * Not `i % uniqueCount`. Slots `i` and `i + imagesPerTurn` sit at the same
 * angle one turn apart, so they form a vertical column; cycling the textures
 * puts the same picture twice in one column whenever `uniqueCount` divides
 * `imagesPerTurn` — with three cutouts and nine per turn, every column is a
 * pair of identical images stacked on top of each other.
 *
 * Assigning column-major instead walks consecutive textures down each column,
 * which is collision-free whenever `uniqueCount >= turns`. Below that a repeat
 * is unavoidable by pigeonhole — one image cannot fill two rows of a column
 * without repeating.
 */
export function textureIndexFor(
  slot: number,
  count: number,
  uniqueCount: number
): number {
  if (uniqueCount <= 0) return 0
  const turns = Math.max(1, Math.round(count / LAYOUT.imagesPerTurn))
  const column = slot % LAYOUT.imagesPerTurn
  const turn = Math.floor(slot / LAYOUT.imagesPerTurn)
  return (column * turns + turn) % uniqueCount
}
