// Turning a depth map into something you can look at or use.
//
// All of this is pure: single-channel bytes in, RGBA bytes out. It lives apart
// from the route so the parts that are easy to get subtly wrong — a colour ramp
// that is not monotonic, a normal map whose Y is flipped, a gamma applied in
// the wrong direction — can be tested rather than eyeballed.
//
// The model hands back inverse depth normalised to 0-255 where BRIGHTER IS
// NEARER. Every function here takes that convention as given and says so where
// it matters, because getting it backwards produces an image that looks
// plausible and is inside out.

export type DepthView = "grey" | "viridis" | "turbo" | "magma" | "normals"

export interface DepthToneOptions {
  /** Swap near and far. */
  invert: boolean
  /**
   * Contrast around the midpoint, 0.5–3. Depth maps are often bunched into a
   * narrow band, and a straight ramp wastes most of the range.
   */
  contrast: number
  /** Gamma on the ramp, 0.2–3. Below 1 lifts the far field. */
  gamma: number
  /** Steepness of the derived normals. Ignored by every other view. */
  normalStrength: number
}

export const DEFAULT_TONE: DepthToneOptions = {
  invert: false,
  contrast: 1,
  gamma: 1,
  normalStrength: 1,
}

/**
 * Apply invert, contrast and gamma to one depth byte.
 *
 * Order matters and is deliberate: invert first so contrast and gamma always
 * act on the value the viewer is actually looking at, then contrast about the
 * midpoint, then gamma. Gamma last because it is the only non-symmetric step —
 * doing it before contrast makes the contrast control behave differently
 * depending on the gamma, which is not what a tone control should do.
 */
export function toneMap(value: number, o: DepthToneOptions): number {
  let v = value / 255
  if (o.invert) v = 1 - v
  v = (v - 0.5) * o.contrast + 0.5
  v = Math.min(1, Math.max(0, v))
  // Math.pow(0, x) is 0 and Math.pow(1, x) is 1, so the endpoints are fixed
  // whatever the gamma — no clamping needed after this.
  v = Math.pow(v, o.gamma)
  return Math.round(v * 255)
}

type Ramp = readonly [number, number, number][]

/**
 * Colour ramps, as control points interpolated linearly.
 *
 * Viridis and magma are perceptually uniform: equal steps in the data are equal
 * steps in apparent lightness, which is why they are the default choice for
 * scientific work and why a depth map read through them does not invent
 * banding that is not in the data. Turbo is not uniform — it trades that for
 * a much larger apparent range, which is genuinely easier to read structure
 * from, so it is offered rather than hidden.
 *
 * Nine stops each, sampled from the reference implementations. Enough that
 * linear interpolation between them is within a couple of levels of the real
 * curve, and few enough to read.
 */
const RAMPS: Record<Exclude<DepthView, "grey" | "normals">, Ramp> = {
  viridis: [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [109, 205, 89],
    [253, 231, 37],
  ],
  turbo: [
    [48, 18, 59],
    [64, 91, 221],
    [37, 165, 251],
    [24, 226, 196],
    [98, 252, 108],
    [186, 250, 55],
    [249, 205, 55],
    [252, 118, 22],
    [122, 4, 3],
  ],
  magma: [
    [0, 0, 4],
    [28, 16, 68],
    [79, 18, 123],
    [129, 37, 129],
    [181, 54, 122],
    [229, 80, 100],
    [251, 135, 97],
    [254, 194, 135],
    [252, 253, 191],
  ],
}

export function sampleRamp(
  ramp: Exclude<DepthView, "grey" | "normals">,
  t: number
): [number, number, number] {
  const stops = RAMPS[ramp]
  const clamped = Math.min(1, Math.max(0, t))
  const scaled = clamped * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const f = scaled - i
  const a = stops[i]
  const b = stops[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/**
 * Derive a tangent-space normal map from depth.
 *
 * A Sobel gradient on the depth field, then normalise. This is an
 * approximation and worth being honest about: a real normal map comes from
 * geometry, and this one comes from the *rate of change* of a monocular depth
 * guess, so it inherits every error in that guess and amplifies the noisy
 * parts. It is useful for relighting and for displacement, not for anything
 * that needs to be correct.
 *
 * The green channel encodes +Y as up, which is the OpenGL convention. Direct3D
 * expects it flipped; anyone importing this into an engine that wants the other
 * one will need to invert green, and that is stated in the UI rather than
 * guessed at here.
 */
export function depthToNormals(
  depth: Uint8Array,
  width: number,
  height: number,
  strength: number,
  tone: DepthToneOptions
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))
  const at = (x: number, y: number) => {
    const cx = Math.min(width - 1, Math.max(0, x))
    const cy = Math.min(height - 1, Math.max(0, y))
    return toneMap(depth[cy * width + cx], tone) / 255
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sobel, 3x3.
      const tl = at(x - 1, y - 1)
      const t = at(x, y - 1)
      const tr = at(x + 1, y - 1)
      const l = at(x - 1, y)
      const r = at(x + 1, y)
      const bl = at(x - 1, y + 1)
      const b = at(x, y + 1)
      const br = at(x + 1, y + 1)

      const dx = tl + 2 * l + bl - (tr + 2 * r + br)
      const dy = tl + 2 * t + tr - (bl + 2 * b + br)

      // Z is the "flatness" term: a larger divisor means a shallower surface.
      // Dividing by strength rather than multiplying dx/dy keeps the vector
      // normalised at any strength instead of saturating.
      const nz = 1 / Math.max(0.001, strength)
      const len = Math.hypot(dx, dy, nz) || 1

      const i = (y * width + x) * 4
      // -1..1 packed into 0..255, the standard encoding.
      out[i] = ((dx / len) * 0.5 + 0.5) * 255
      out[i + 1] = ((dy / len) * 0.5 + 0.5) * 255
      out[i + 2] = ((nz / len) * 0.5 + 0.5) * 255
      out[i + 3] = 255
    }
  }
  return out
}

/** Render a depth map to RGBA under the chosen view and tone. */
export function renderDepth(
  depth: Uint8Array,
  width: number,
  height: number,
  view: DepthView,
  tone: DepthToneOptions
): Uint8ClampedArray<ArrayBuffer> {
  if (view === "normals") {
    return depthToNormals(depth, width, height, tone.normalStrength, tone)
  }

  const out = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))
  for (let p = 0; p < depth.length; p++) {
    const v = toneMap(depth[p], tone)
    const i = p * 4
    if (view === "grey") {
      out[i] = out[i + 1] = out[i + 2] = v
    } else {
      const [r, g, b] = sampleRamp(view, v / 255)
      out[i] = r
      out[i + 1] = g
      out[i + 2] = b
    }
    out[i + 3] = 255
  }
  return out
}

/**
 * Summary statistics, for the readout.
 *
 * A depth map that has collapsed — every pixel within a few levels of each
 * other — looks like a flat grey card and is easy to mistake for a bug in the
 * renderer. Showing the spread makes it obvious that the model, not the
 * display, is what produced it.
 */
export function depthStats(depth: Uint8Array) {
  let min = 255
  let max = 0
  let sum = 0
  for (let i = 0; i < depth.length; i++) {
    const v = depth[i]
    if (v < min) min = v
    if (v > max) max = v
    sum += v
  }
  return {
    min,
    max,
    mean: depth.length ? sum / depth.length : 0,
    spread: max - min,
  }
}
