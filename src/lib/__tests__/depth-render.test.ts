import { describe, expect, it } from "vitest"
import {
  toneMap,
  sampleRamp,
  renderDepth,
  depthToNormals,
  depthStats,
  DEFAULT_TONE,
  type DepthView,
} from "../depth-render"
import {
  DEPTH_MODELS,
  DEFAULT_DEPTH_MODEL_ID,
  depthCacheKeyFor,
  depthModelById,
} from "../depth-models"

const flat = (v: number, n = 9) => new Uint8Array(n).fill(v)

describe("toneMap", () => {
  it("is the identity at the defaults", () => {
    for (const v of [0, 1, 64, 127, 128, 200, 255]) {
      expect(toneMap(v, DEFAULT_TONE)).toBe(v)
    }
  })

  it("pins the endpoints whatever the gamma", () => {
    // Math.pow(0, x) is 0 and Math.pow(1, x) is 1, so no clamp is needed after
    // gamma. If that ever stops holding, the map gains a black or white crush.
    for (const gamma of [0.2, 0.5, 1, 2, 3]) {
      expect(toneMap(0, { ...DEFAULT_TONE, gamma })).toBe(0)
      expect(toneMap(255, { ...DEFAULT_TONE, gamma })).toBe(255)
    }
  })

  it("inverts near and far", () => {
    expect(toneMap(0, { ...DEFAULT_TONE, invert: true })).toBe(255)
    expect(toneMap(255, { ...DEFAULT_TONE, invert: true })).toBe(0)
  })

  it("pivots about the midpoint, symmetrically", () => {
    // Contrast must pivot about the centre of the range. A pivot anywhere else
    // shifts the whole image brighter or darker as you turn the knob, which is
    // the classic mistake.
    //
    // The fixed point is 127.5, not 128 — byte 128 normalises to 0.50196, just
    // above the pivot, so it moves by a fraction of a level and rounds to 129
    // at high contrast. Asserting `toneMap(128) === 128` fails for that reason
    // and not because anything is wrong; symmetry is both the true property
    // and a far stronger test of where the pivot sits.
    for (const contrast of [0.5, 2, 3]) {
      const o = { ...DEFAULT_TONE, contrast }
      for (const v of [0, 40, 100, 127]) {
        const below = 127.5 - toneMap(v, o)
        const above = toneMap(255 - v, o) - 127.5
        // Within one level: each side rounds to an integer independently, so
        // exact equality is not available and toBeCloseTo(_, 0) — which means
        // within 0.5 — is tighter than the arithmetic allows.
        expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
      }
    }
    expect(toneMap(200, { ...DEFAULT_TONE, contrast: 2 })).toBeGreaterThan(200)
    expect(toneMap(50, { ...DEFAULT_TONE, contrast: 2 })).toBeLessThan(50)
  })

  it("stays in range at extreme settings", () => {
    for (const contrast of [0.5, 3]) {
      for (const gamma of [0.2, 3]) {
        for (const invert of [false, true]) {
          for (let v = 0; v <= 255; v += 17) {
            const out = toneMap(v, { ...DEFAULT_TONE, contrast, gamma, invert })
            expect(out).toBeGreaterThanOrEqual(0)
            expect(out).toBeLessThanOrEqual(255)
            expect(Number.isFinite(out)).toBe(true)
          }
        }
      }
    }
  })

  it("never inverts the ordering it is given", () => {
    // Monotonicity is the one property a tone curve must not break: two
    // surfaces cannot swap which is nearer because of a display control.
    for (const contrast of [0.5, 1, 2, 3]) {
      for (const gamma of [0.2, 1, 3]) {
        let previous = -1
        for (let v = 0; v <= 255; v++) {
          const out = toneMap(v, { ...DEFAULT_TONE, contrast, gamma })
          expect(out).toBeGreaterThanOrEqual(previous)
          previous = out
        }
      }
    }
  })
})

describe("colour ramps", () => {
  const ramps = ["viridis", "turbo", "magma"] as const

  it("hits its own endpoints exactly", () => {
    expect(sampleRamp("viridis", 0)).toEqual([68, 1, 84])
    expect(sampleRamp("viridis", 1)).toEqual([253, 231, 37])
    expect(sampleRamp("magma", 0)).toEqual([0, 0, 4])
  })

  it("clamps outside 0..1 rather than reading past the array", () => {
    for (const r of ramps) {
      expect(sampleRamp(r, -1)).toEqual(sampleRamp(r, 0))
      expect(sampleRamp(r, 2)).toEqual(sampleRamp(r, 1))
    }
  })

  it("stays in gamut across the whole ramp", () => {
    for (const r of ramps) {
      for (let i = 0; i <= 100; i++) {
        for (const c of sampleRamp(r, i / 100)) {
          expect(c).toBeGreaterThanOrEqual(0)
          expect(c).toBeLessThanOrEqual(255)
          expect(Number.isInteger(c)).toBe(true)
        }
      }
    }
  })

  it("rises in luminance from end to end, which is what makes depth readable", () => {
    // Not strict per-step monotonicity — turbo is deliberately not uniform —
    // but a ramp whose bright end is darker than its dark end would read the
    // depth backwards.
    const luma = ([r, g, b]: number[]) => 0.299 * r + 0.587 * g + 0.114 * b
    for (const r of ramps) {
      expect(luma(sampleRamp(r, 1))).toBeGreaterThan(luma(sampleRamp(r, 0)))
    }
  })

  it("is continuous — no jump between adjacent samples", () => {
    // A discontinuity would show as a hard band across a smooth surface.
    for (const r of ramps) {
      for (let i = 1; i <= 200; i++) {
        const a = sampleRamp(r, (i - 1) / 200)
        const b = sampleRamp(r, i / 200)
        const jump = Math.max(...a.map((v, k) => Math.abs(v - b[k])))
        expect(jump).toBeLessThan(32)
      }
    }
  })
})

describe("renderDepth", () => {
  it("returns opaque RGBA of the right length", () => {
    for (const view of ["grey", "viridis", "turbo", "magma", "normals"] as DepthView[]) {
      const out = renderDepth(flat(128), 3, 3, view, DEFAULT_TONE)
      expect(out.length).toBe(3 * 3 * 4)
      for (let i = 3; i < out.length; i += 4) expect(out[i]).toBe(255)
    }
  })

  it("is grey when asked for grey", () => {
    const out = renderDepth(new Uint8Array([0, 90, 200, 255]), 2, 2, "grey", DEFAULT_TONE)
    for (let p = 0; p < 4; p++) {
      const i = p * 4
      expect(out[i]).toBe(out[i + 1])
      expect(out[i + 1]).toBe(out[i + 2])
    }
    expect(out[0]).toBe(0)
    expect(out[12]).toBe(255)
  })

  it("is backed by a plain ArrayBuffer, so ImageData will take it", () => {
    // Uint8ClampedArray's default generic admits SharedArrayBuffer, which the
    // ImageData constructor rejects. This caught a real type error.
    const out = renderDepth(flat(128), 2, 2, "grey", DEFAULT_TONE)
    expect(out.buffer).toBeInstanceOf(ArrayBuffer)
  })
})

describe("depthToNormals", () => {
  it("points straight out of a flat surface", () => {
    // No gradient means no tilt: (0, 0, 1), which encodes as (128, 128, 255).
    const out = depthToNormals(flat(100, 25), 5, 5, 1, DEFAULT_TONE)
    const centre = (2 * 5 + 2) * 4
    expect(out[centre]).toBe(128)
    expect(out[centre + 1]).toBe(128)
    expect(out[centre + 2]).toBe(255)
  })

  it("tilts along the gradient, in the direction of the gradient", () => {
    // Depth rising to the right: the surface faces left, so X goes below the
    // 128 midpoint. Getting this backwards is how a normal map ends up lit
    // from the wrong side.
    const width = 5
    const height = 5
    const ramp = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) ramp[y * width + x] = x * 60
    }
    const out = depthToNormals(ramp, width, height, 1, DEFAULT_TONE)
    const centre = (2 * width + 2) * 4
    expect(out[centre]).toBeLessThan(128)
    // No vertical gradient, so Y stays centred.
    expect(out[centre + 1]).toBe(128)
  })

  it("gives a stronger tilt at a higher strength", () => {
    const width = 5
    const ramp = new Uint8Array(width * width)
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) ramp[y * width + x] = x * 60
    }
    const centre = (2 * width + 2) * 4
    const weak = depthToNormals(ramp, width, width, 0.5, DEFAULT_TONE)[centre]
    const strong = depthToNormals(ramp, width, width, 4, DEFAULT_TONE)[centre]
    // Further from the 128 midpoint means more tilt.
    expect(Math.abs(strong - 128)).toBeGreaterThan(Math.abs(weak - 128))
  })

  it("keeps the vector normalised at every strength", () => {
    const width = 5
    const ramp = new Uint8Array(width * width)
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) ramp[y * width + x] = x * 60
    }
    for (const strength of [0.1, 1, 5]) {
      const out = depthToNormals(ramp, width, width, strength, DEFAULT_TONE)
      const centre = (2 * width + 2) * 4
      const v = [0, 1, 2].map((k) => (out[centre + k] / 255) * 2 - 1)
      expect(Math.hypot(...v)).toBeCloseTo(1, 1)
    }
  })

  it("handles a 1x1 image without reading out of bounds", () => {
    const out = depthToNormals(flat(50, 1), 1, 1, 1, DEFAULT_TONE)
    expect(out.length).toBe(4)
    expect(out[2]).toBe(255)
  })
})

describe("depthStats", () => {
  it("reports the spread that tells a flat map from a broken renderer", () => {
    expect(depthStats(new Uint8Array([10, 10, 10]))).toEqual({
      min: 10,
      max: 10,
      mean: 10,
      spread: 0,
    })
    const s = depthStats(new Uint8Array([0, 255]))
    expect(s.spread).toBe(255)
    expect(s.mean).toBeCloseTo(127.5)
  })

  it("does not divide by zero on an empty map", () => {
    expect(depthStats(new Uint8Array(0)).mean).toBe(0)
  })
})

describe("depth model registry", () => {
  it("has a default that exists", () => {
    expect(DEPTH_MODELS.some((m) => m.id === DEFAULT_DEPTH_MODEL_ID)).toBe(true)
  })

  it("falls back rather than throwing on an unknown id", () => {
    expect(depthModelById("nope")).toBe(DEPTH_MODELS[0])
  })

  it("gives every model a distinct id and cache bucket per backend", () => {
    const keys = DEPTH_MODELS.flatMap((m) => [
      depthCacheKeyFor(m.id, "webgpu"),
      depthCacheKeyFor(m.id, "wasm"),
    ])
    expect(new Set(keys).size).toBe(keys.length)
    // Must not collide with the matting models' buckets, which the storage
    // page would then double-count or delete twice.
    for (const k of keys) expect(k.startsWith("remove-free-depth-")).toBe(true)
  })

  it("states a real size for both backends", () => {
    for (const m of DEPTH_MODELS) {
      for (const backend of ["webgpu", "wasm"] as const) {
        // These are read off the repo listings; a placeholder zero would show
        // the user a free download that is not free.
        expect(m.variants[backend].bytes).toBeGreaterThan(1_000_000)
      }
    }
  })

  it("keeps the default the smallest, since bokeh pays for it too", () => {
    const def = depthModelById(DEFAULT_DEPTH_MODEL_ID)
    for (const m of DEPTH_MODELS) {
      expect(def.variants.webgpu.bytes).toBeLessThanOrEqual(m.variants.webgpu.bytes)
    }
  })
})
