// Alpha refinement is the component most able to make things quietly worse. An
// early version scored 11.40% error against 9.78% for doing nothing at all,
// because it was applied to the whole frame instead of the uncertain band.
// These lock in the properties that fix depended on.

import { describe, it, expect } from "vitest"
import { refineAlpha } from "../refine"

/**
 * What the filter reacts to is the upscale RATIO, not absolute size, so the
 * tests run small and lower the solve size to keep the same 4x ratio. At the
 * production 1024 this suite took 7.8s for no extra signal.
 */
const OPTS = { solveLongEdge: 128 }

/** A hard-edged subject with a soft, upscale-blurred boundary. */
function scene(width: number, height: number, edgeX: number) {
  const pixels = new Uint8Array(width * height * 3)
  const alpha = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const bright = x < edgeX ? 230 : 25
      pixels[i * 3] = bright
      pixels[i * 3 + 1] = bright
      pixels[i * 3 + 2] = bright

      // A linear ramp across a few pixels, exactly what a bilinear upscale of a
      // small mask produces.
      const d = x - edgeX
      alpha[i] = d <= -4 ? 255 : d >= 4 ? 0 : Math.round(255 * (1 - (d + 4) / 8))
    }
  }
  return { pixels, alpha }
}

describe("refineAlpha", () => {
  it("does not touch the input array", () => {
    const { pixels, alpha } = scene(512, 512, 250)
    const copy = Uint8Array.from(alpha)
    refineAlpha(alpha, pixels, 3, 512, 512, OPTS)
    expect(alpha).toEqual(copy)
  })

  it("returns the same array below a 2x upscale", () => {
    // Identity, not a copy: there is no upscale blur to undo at this size and
    // the filter would only cost time.
    const { pixels, alpha } = scene(256, 256, 128)
    expect(refineAlpha(alpha, pixels, 3, 256, 256)).toBe(alpha)
  })

  it("leaves confident pixels exactly alone", () => {
    // The band restriction IS the fix. Anything already fully opaque or fully
    // transparent must come back untouched.
    const w = 512
    const h = 128
    const { pixels, alpha } = scene(w, h, 256)
    const out = refineAlpha(alpha, pixels, 3, w, h, OPTS)

    let checked = 0
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] === 255 || alpha[i] === 0) {
        expect(out[i]).toBe(alpha[i])
        checked++
      }
    }
    expect(checked).toBeGreaterThan(alpha.length / 2)
  })

  it("sharpens the ramp instead of widening it", () => {
    const w = 512
    const h = 128
    const { pixels, alpha } = scene(w, h, 256)
    const out = refineAlpha(alpha, pixels, 3, w, h, OPTS)

    const soft = (a: Uint8Array) => {
      let n = 0
      for (let i = 0; i < a.length; i++) if (a[i] > 4 && a[i] < 251) n++
      return n
    }
    expect(soft(out)).toBeLessThanOrEqual(soft(alpha))
  })

  it("reads only RGB, whatever the stride", () => {
    // The worker hands over RawImage data that may carry an alpha channel; a
    // filter that read it as colour would key off its own output.
    const w = 512
    const h = 128
    const { pixels, alpha } = scene(w, h, 256)

    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = pixels[i * 3]
      rgba[i * 4 + 1] = pixels[i * 3 + 1]
      rgba[i * 4 + 2] = pixels[i * 3 + 2]
      rgba[i * 4 + 3] = 7 // deliberately not opaque, and must be ignored
    }

    expect(refineAlpha(alpha, rgba, 4, w, h, OPTS)).toEqual(refineAlpha(alpha, pixels, 3, w, h, OPTS))
  })
})
