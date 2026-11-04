// What happens to the cutout after it is cut.
//
// Each effect is a pure function of the alpha channel plus its own options,
// composed in declared order onto a canvas behind the subject. That ordering is
// the whole reason they are a list rather than a set of toggles: an outline
// under a shadow and a shadow under an outline are different pictures, and both
// are ones people want.
//
// The shared primitive is a distance field over alpha, because all three
// effects are the same question asked at different radii — "how far is this
// pixel from the subject". Computing it once as a proper Euclidean transform is
// both faster and better-looking than the usual approach of blurring alpha and
// thresholding it, which rounds off corners and cannot give a hard outline at
// all.

import type { EffectConfig } from "./schema"

/**
 * Squared Euclidean distance from every transparent pixel to the nearest
 * covered one, by Felzenszwalb & Huttenlocher's exact separable transform.
 *
 * Two passes of a 1-D lower-envelope scan, O(n) per row and per column, exact
 * rather than the chamfer approximation — which matters because an outline
 * traced from an approximate distance field has visible flats on diagonals.
 */
function distanceSquared(alpha: Uint8Array, width: number, height: number): Float32Array {
  const INF = 1e20
  const out = new Float32Array(width * height)
  for (let i = 0; i < out.length; i++) out[i] = alpha[i] > 127 ? 0 : INF

  const size = Math.max(width, height)
  const f = new Float32Array(size)
  const d = new Float32Array(size)
  // v: the parabola indices forming the lower envelope. z: the breakpoints
  // between them. Both need one more slot than the number of parabolas.
  const v = new Int32Array(size)
  const z = new Float32Array(size + 1)

  const transform1d = (n: number, read: (i: number) => number, write: (i: number, val: number) => void) => {
    for (let i = 0; i < n; i++) f[i] = read(i)
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      const dist = q - v[k]
      d[q] = dist * dist + f[v[k]]
    }
    for (let i = 0; i < n; i++) write(i, d[i])
  }

  for (let y = 0; y < height; y++) {
    const row = y * width
    transform1d(
      width,
      (x) => out[row + x],
      (x, val) => {
        out[row + x] = val
      }
    )
  }
  for (let x = 0; x < width; x++) {
    transform1d(
      height,
      (y) => out[y * width + x],
      (y, val) => {
        out[y * width + x] = val
      }
    )
  }
  return out
}

/** Separable moving-average box blur over a single channel, three passes ≈ gaussian. */
function blurChannel(
  src: Float32Array<ArrayBuffer>,
  width: number,
  height: number,
  radius: number
): Float32Array<ArrayBuffer> {
  if (radius < 1) return src
  const r = Math.round(radius)
  let a = src
  let b = new Float32Array(new ArrayBuffer(src.length * 4))
  for (let pass = 0; pass < 3; pass++) {
    // Horizontal.
    for (let y = 0; y < height; y++) {
      const row = y * width
      let sum = 0
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(width - 1, Math.max(0, x))]
      const scale = 1 / (2 * r + 1)
      for (let x = 0; x < width; x++) {
        b[row + x] = sum * scale
        sum -= a[row + Math.min(width - 1, Math.max(0, x - r))]
        sum += a[row + Math.min(width - 1, Math.max(0, x + r + 1))]
      }
    }
    ;[a, b] = [b, a]
    // Vertical.
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let y = -r; y <= r; y++) sum += a[Math.min(height - 1, Math.max(0, y)) * width + x]
      const scale = 1 / (2 * r + 1)
      for (let y = 0; y < height; y++) {
        b[y * width + x] = sum * scale
        sum -= a[Math.min(height - 1, Math.max(0, y - r)) * width + x]
        sum += a[Math.min(height - 1, Math.max(0, y + r + 1)) * width + x]
      }
    }
    ;[a, b] = [b, a]
  }
  return a
}

function hexToRgb(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

/**
 * Coverage of the outline band, per pixel, antialiased.
 *
 * `tightness` interpolates between a round outline (distance thresholded, so
 * corners are radiused — the sticker look) and one that follows the silhouette,
 * by sharpening the falloff rather than by changing the metric. A second metric
 * would be the textbook answer and would double the cost of the field for a
 * difference visible only at the corners.
 */
function outlineMask(
  dist2: Float32Array,
  width: number,
  height: number,
  widthPx: number,
  tightness: number
): Float32Array {
  const out = new Float32Array(width * height)
  const edge = widthPx
  const feather = 1 + (1 - tightness) * 1.5
  for (let i = 0; i < out.length; i++) {
    const d = Math.sqrt(dist2[i])
    if (d <= 0) continue
    // 1 inside the band, falling to 0 across `feather` pixels at its outer rim.
    out[i] = Math.min(1, Math.max(0, (edge - d) / feather + 1))
  }
  return out
}

export interface EffectLayer {
  /** RGBA, premultiplied by its own coverage, ready to draw under the subject. */
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

/**
 * Render one effect into its own RGBA layer.
 *
 * Returns a layer to be drawn UNDER the cutout rather than compositing here,
 * so the caller controls stacking and can cache layers whose options did not
 * change. `dist2` is shared across every effect in a stack — it is the
 * expensive part and it depends only on alpha.
 */
export function renderEffect(
  effect: EffectConfig,
  alpha: Uint8Array,
  dist2: Float32Array,
  width: number,
  height: number
): EffectLayer {
  const data = new Uint8ClampedArray(new ArrayBuffer(width * height * 4))

  if (effect.type === "outline") {
    const [r, g, b] = hexToRgb(effect.color)
    const mask = outlineMask(dist2, width, height, effect.width, effect.tightness)
    for (let i = 0; i < mask.length; i++) {
      const a = mask[i]
      if (a <= 0) continue
      const o = i * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a * 255
    }
    return { data, width, height }
  }

  if (effect.type === "glow") {
    const [r, g, b] = hexToRgb(effect.color)
    // Blur the coverage itself rather than thresholding the distance field: a
    // glow has no edge, so the field's only job here is to be blurred.
    const src = new Float32Array(new ArrayBuffer(width * height * 4))
    for (let i = 0; i < src.length; i++) src[i] = alpha[i] / 255
    const blurred = blurChannel(src, width, height, effect.radius / 2)
    for (let i = 0; i < blurred.length; i++) {
      const a = Math.min(1, blurred[i] * 1.6) * effect.opacity
      if (a <= 0.002) continue
      const o = i * 4
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = a * 255
    }
    return { data, width, height }
  }

  // Shadow: the alpha channel, offset, blurred and tinted.
  const [r, g, b] = hexToRgb(effect.color)
  const rad = (effect.angle * Math.PI) / 180
  const dx = Math.round(Math.cos(rad) * effect.distance)
  const dy = Math.round(Math.sin(rad) * effect.distance)

  const shifted = new Float32Array(new ArrayBuffer(width * height * 4))
  for (let y = 0; y < height; y++) {
    const sy = y - dy
    if (sy < 0 || sy >= height) continue
    for (let x = 0; x < width; x++) {
      const sx = x - dx
      if (sx < 0 || sx >= width) continue
      shifted[y * width + x] = alpha[sy * width + sx] / 255
    }
  }
  const blurred = blurChannel(shifted, width, height, effect.blur / 2)
  for (let i = 0; i < blurred.length; i++) {
    const a = blurred[i] * effect.opacity
    if (a <= 0.002) continue
    const o = i * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = a * 255
  }
  return { data, width, height }
}

/** The shared distance field. Compute once per alpha, reuse across the stack. */
export function effectDistanceField(
  alpha: Uint8Array,
  width: number,
  height: number
): Float32Array {
  return distanceSquared(alpha, width, height)
}

/** Extract the alpha channel from RGBA pixels. */
export function alphaOf(rgba: Uint8ClampedArray | Uint8Array, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels)
  for (let i = 0; i < pixels; i++) out[i] = rgba[i * 4 + 3]
  return out
}
