// The focal plane decides which half of the scene stays sharp. Getting it
// wrong inverts the effect — background crisp, subject blurred — which looks
// like a bug in the matte rather than in the blur.

import { describe, it, expect } from "vitest"
import { focalDepth } from "../bokeh"
import type { DepthMap } from "../depth"

function depthMap(width: number, height: number, at: (x: number, y: number) => number): DepthMap {
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = at(x, y)
  }
  return { data, width, height, ms: 0 }
}

/** RGBA where the subject occupies the left half. */
function alphaLeftHalf(width: number, height: number) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rgba[(y * width + x) * 4 + 3] = x < width / 2 ? 255 : 0
  }
  return rgba
}

describe("focalDepth", () => {
  it("focuses on the subject, not the background", () => {
    const w = 64
    const h = 64
    // Subject near (200), backdrop far (30).
    const depth = depthMap(w, h, (x) => (x < w / 2 ? 200 : 30))
    const focal = focalDepth(depth, alphaLeftHalf(w, h), w, h)
    expect(focal).toBeCloseTo(200 / 255, 1)
  })

  it("ignores a minority of stray subject pixels", () => {
    // A matte that catches a little background around the hair would drag a
    // MEAN toward it. The median must not move.
    const w = 64
    const h = 64
    const depth = depthMap(w, h, (x, y) => (x < w / 2 ? (y < 4 ? 0 : 200) : 30))
    const focal = focalDepth(depth, alphaLeftHalf(w, h), w, h)
    expect(focal).toBeCloseTo(200 / 255, 1)
  })

  it("treats an empty matte as the near plane", () => {
    // No subject found: blurring by distance from an arbitrary plane would
    // sharpen a random slice of the backdrop.
    const w = 32
    const h = 32
    const depth = depthMap(w, h, () => 128)
    const empty = new Uint8ClampedArray(w * h * 4)
    expect(focalDepth(depth, empty, w, h)).toBe(1)
  })

  it("works when the depth map is smaller than the image", () => {
    // Depth is computed at 640px and stretched over the full image, so the two
    // resolutions never match in practice.
    const w = 128
    const h = 128
    const depth = depthMap(32, 32, (x) => (x < 16 ? 220 : 40))
    const focal = focalDepth(depth, alphaLeftHalf(w, h), w, h)
    expect(focal).toBeCloseTo(220 / 255, 1)
  })
})
