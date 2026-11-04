// Depth slice: trim a cutout by distance.
//
// A matte is a guess about which pixels are "the subject", and the usual
// failure is the floor, a chair or a wall that sits at the subject's own
// distance or just behind it. A depth map knows how far each pixel is, so a
// distance window removes that without a brush stroke.
//
// Distances run 0 (nearest) to 100 (farthest). The depth map stores inverse
// depth as a byte, brighter nearer, so distance is 1 - byte/255.

import type { DepthMap } from "./depth"

export interface DepthSlice {
  enabled: boolean
  /** Nearest distance kept, 0..100. */
  near: number
  /** Farthest distance kept, 0..100. */
  far: number
  /** Soft edge on both ends, 0..30 (in distance points). */
  feather: number
}

export const DEFAULT_DEPTH_SLICE: DepthSlice = { enabled: false, near: 0, far: 100, feather: 6 }

/** True when the slice would change nothing, so callers can skip the work. */
export function isNoopSlice(s: DepthSlice): boolean {
  return !s.enabled || (s.near <= 0 && s.far >= 100)
}

/** 0..1 multiplier for one depth byte. Pure; tested. */
export function sliceFactor(depthByte: number, s: DepthSlice): number {
  const d = (1 - depthByte / 255) * 100
  const f = Math.max(0.001, s.feather)
  if (d < s.near) return Math.max(0, 1 - (s.near - d) / f)
  if (d > s.far) return Math.max(0, 1 - (d - s.far) / f)
  return 1
}

/**
 * A window around the subject's own distance, from the focal depth the blur
 * already measures (0..1, brighter nearer). Keeps what is in front of the
 * subject and a little behind it, which is where stray background lives.
 */
export function sliceAroundSubject(focal: number, reach = 12): Pick<DepthSlice, "near" | "far"> {
  const subject = (1 - focal) * 100
  return {
    near: Math.max(0, Math.round(subject - 40)),
    far: Math.min(100, Math.round(subject + reach)),
  }
}

/**
 * Per-pixel keep factor (0..255) at the target size. Computed at the depth
 * map's resolution and scaled up with smoothing, because the map is 640px
 * and stretching it with nearest-neighbour would stair-step the cut edge.
 */
export function depthSliceMatte(
  depth: DepthMap,
  slice: DepthSlice,
  width: number,
  height: number
): Uint8Array {
  const small = document.createElement("canvas")
  small.width = depth.width
  small.height = depth.height
  const sctx = small.getContext("2d")!
  const img = sctx.createImageData(depth.width, depth.height)
  for (let i = 0, j = 3; i < depth.data.length; i++, j += 4) {
    img.data[j] = Math.round(sliceFactor(depth.data[i], slice) * 255)
  }
  sctx.putImageData(img, 0, 0)

  const full = document.createElement("canvas")
  full.width = width
  full.height = height
  const fctx = full.getContext("2d", { willReadFrequently: true })!
  fctx.imageSmoothingEnabled = true
  fctx.imageSmoothingQuality = "high"
  fctx.drawImage(small, 0, 0, width, height)
  const data = fctx.getImageData(0, 0, width, height).data
  const out = new Uint8Array(width * height)
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = data[j]
  return out
}
