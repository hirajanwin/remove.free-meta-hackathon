// Depth-aware background blur.
//
// The uniform version — one `ctx.filter = blur(Npx)` over the whole backdrop —
// is the giveaway that a cutout is synthetic. A lens is sharp at one distance
// and defocuses progressively either side of it, so a wall far behind the
// subject should be much softer than the chair at their shoulder. Flattening
// that to a single radius reads as a cut-and-paste.
//
// The technique here is the standard layered approach used in real-time
// graphics: render a handful of copies at increasing blur radii, then pick per
// pixel between the two levels that bracket its required radius and blend. It
// costs a fixed small number of canvas blurs regardless of image size, where a
// true per-pixel variable-radius convolution would be far slower in JS for a
// difference nobody can see through a lens simulation.

import type { DepthMap } from "./depth"

/**
 * Resolution the blur levels are computed at.
 *
 * This is the most memory-hungry thing in the app: three to six full RGBA
 * copies of the image, plus a padded source, all live at once. At 12 MP that is
 * over 300 MB and a mobile browser simply kills the tab.
 *
 * Working small costs nothing visually. A blur is low-frequency by definition —
 * that is what makes it a blur — so computing it at 2 MP and scaling up is
 * indistinguishable from computing it at full size, and it makes the aperture
 * slider responsive on large photos as a side effect.
 */
const BLUR_SOLVE_PIXELS = 2_000_000

/** Levels bracket the radius range; more only helps at large apertures. */
function levelCount(maxBlur: number) {
  return Math.max(3, Math.min(6, Math.round(maxBlur / 8) + 2))
}

/**
 * Bilinear sample of the depth map in 0..1, addressed in target-image
 * coordinates. Bilinear rather than nearest because the map is computed at
 * 640px and stretched over the full image: nearest produces visible stair-steps
 * along the blur gradient.
 */
function sampleDepth(depth: DepthMap, fx: number, fy: number): number {
  const x = fx * (depth.width - 1)
  const y = fy * (depth.height - 1)
  const x0 = x | 0
  const y0 = y | 0
  const x1 = Math.min(depth.width - 1, x0 + 1)
  const y1 = Math.min(depth.height - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const d = depth.data
  const a = d[y0 * depth.width + x0]
  const b = d[y0 * depth.width + x1]
  const c = d[y1 * depth.width + x0]
  const e = d[y1 * depth.width + x1]
  return (a + (b - a) * tx + (c + (e - c) * tx - (a + (b - a) * tx)) * ty) / 255
}

/**
 * The distance the lens is focused at, taken from the subject.
 *
 * The median of the subject's own depth, not the mean: a matte that catches a
 * little background around the hair would drag a mean toward it, while the
 * median ignores a minority of stray pixels entirely.
 */
export function focalDepth(
  depth: DepthMap,
  alpha: Uint8ClampedArray | Uint8Array,
  alphaWidth: number,
  alphaHeight: number,
  alphaStride = 4,
  alphaOffset = 3
): number {
  const hist = new Uint32Array(256)
  let count = 0
  // Every fourth row and column: a median over a sixteenth of the pixels is
  // indistinguishable here and avoids a full pass over a large image.
  for (let y = 0; y < alphaHeight; y += 4) {
    for (let x = 0; x < alphaWidth; x += 4) {
      const a = alpha[(y * alphaWidth + x) * alphaStride + alphaOffset]
      if (a < 128) continue
      hist[depth.data[
        Math.min(depth.height - 1, ((y / alphaHeight) * depth.height) | 0) * depth.width +
          Math.min(depth.width - 1, ((x / alphaWidth) * depth.width) | 0)
      ]]++
      count++
    }
  }

  if (!count) return 1 // no subject found: treat the focal plane as nearest

  const half = count / 2
  let seen = 0
  for (let i = 0; i < 256; i++) {
    seen += hist[i]
    if (seen >= half) return i / 255
  }
  return 1
}

/**
 * A canvas holding `source` with its edges extended by `pad`.
 *
 * Blurring a canvas samples transparent black beyond its bounds, which darkens
 * and fades the frame edges — very visible at a 40px radius. Stretching the
 * source over the padded rect first gives the filter something plausible to
 * pull in; the sharp copy then lands on top at its true position.
 */
function padded(source: CanvasImageSource, w: number, h: number, pad: number) {
  const c = document.createElement("canvas")
  c.width = w + pad * 2
  c.height = h + pad * 2
  const ctx = c.getContext("2d")!
  ctx.drawImage(source, 0, 0, c.width, c.height)
  ctx.drawImage(source, pad, pad, w, h)
  return c
}

/**
 * Draw `source` into `ctx` with blur that increases with distance from the
 * subject's plane.
 *
 * Returns false if it could not run, so callers can fall back to uniform blur
 * rather than drawing nothing.
 */
export function drawDepthBlur({
  ctx,
  source,
  width,
  height,
  depth,
  focal,
  maxBlur,
}: {
  ctx: CanvasRenderingContext2D
  source: CanvasImageSource
  width: number
  height: number
  depth: DepthMap
  focal: number
  maxBlur: number
}): boolean {
  if (maxBlur <= 0 || width <= 0 || height <= 0) return false

  // Everything below runs at the solve size; only the final draw is full size.
  const solveScale = Math.min(1, Math.sqrt(BLUR_SOLVE_PIXELS / (width * height)))
  const sw = Math.max(1, Math.round(width * solveScale))
  const sh = Math.max(1, Math.round(height * solveScale))
  // The radius has to shrink with the image or the blur would be that much
  // stronger once scaled back up.
  const solveBlur = maxBlur * solveScale

  const levels = levelCount(maxBlur)
  const pad = Math.ceil(solveBlur * 2)
  const base = padded(source, sw, sh, pad)

  // One ImageData per blur level, all cropped back to the true frame.
  const planes: Uint8ClampedArray[] = []
  for (let k = 0; k < levels; k++) {
    const c = document.createElement("canvas")
    c.width = sw
    c.height = sh
    const cctx = c.getContext("2d", { willReadFrequently: true })!
    cctx.filter = k === 0 ? "none" : `blur(${(solveBlur * k) / (levels - 1)}px)`
    cctx.drawImage(base, -pad, -pad)
    planes.push(cctx.getImageData(0, 0, sw, sh).data)
  }

  // Normalise deviation-from-focus against what the scene actually contains,
  // so the slider always means "this much blur on the farthest thing" whether
  // the backdrop is a far wall or a near one. The 98th percentile rather than
  // the maximum: a handful of outlier pixels should not compress everything
  // else toward sharp.
  const devHist = new Uint32Array(129)
  let devCount = 0
  for (let y = 0; y < sh; y += 4) {
    const fy = sh === 1 ? 0 : y / (sh - 1)
    for (let x = 0; x < sw; x += 4) {
      const fx = sw === 1 ? 0 : x / (sw - 1)
      devHist[Math.round(Math.abs(sampleDepth(depth, fx, fy) - focal) * 128)]++
      devCount++
    }
  }
  let seen = 0
  let maxDev = 1
  for (let i = 0; i < 129; i++) {
    seen += devHist[i]
    if (seen >= devCount * 0.98) {
      maxDev = Math.max(1 / 128, i / 128)
      break
    }
  }

  const out = ctx.createImageData(sw, sh)
  const dst = out.data
  const last = levels - 1

  for (let y = 0, i = 0; y < sh; y++) {
    const fy = sh === 1 ? 0 : y / (sh - 1)
    for (let x = 0; x < sw; x++, i += 4) {
      const fx = sw === 1 ? 0 : x / (sw - 1)
      const dev = Math.abs(sampleDepth(depth, fx, fy) - focal) / maxDev
      const t = (dev > 1 ? 1 : dev) * last
      const k0 = t | 0
      const k1 = k0 >= last ? last : k0 + 1
      const f = t - k0
      const a = planes[k0]
      const b = planes[k1]
      dst[i] = a[i] + (b[i] - a[i]) * f
      dst[i + 1] = a[i + 1] + (b[i + 1] - a[i + 1]) * f
      dst[i + 2] = a[i + 2] + (b[i + 2] - a[i + 2]) * f
      dst[i + 3] = 255
    }
  }

  if (sw === width && sh === height) {
    ctx.putImageData(out, 0, 0)
    return true
  }

  // putImageData ignores transforms and does not scale, so the solved result
  // has to go through a canvas to be stretched back to full size.
  const solved = document.createElement("canvas")
  solved.width = sw
  solved.height = sh
  solved.getContext("2d")!.putImageData(out, 0, 0)
  ctx.drawImage(solved, 0, 0, width, height)
  return true
}
