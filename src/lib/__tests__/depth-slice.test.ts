import { describe, expect, it } from "vitest"
import { DEFAULT_DEPTH_SLICE, isNoopSlice, sliceAroundSubject, sliceFactor } from "../depth-slice"

const on = { ...DEFAULT_DEPTH_SLICE, enabled: true }

describe("sliceFactor", () => {
  it("keeps everything inside the window", () => {
    const s = { ...on, near: 20, far: 80, feather: 5 }
    expect(sliceFactor(128, s)).toBe(1) // d ~ 50
  })

  it("removes pixels well beyond the far edge", () => {
    const s = { ...on, near: 0, far: 40, feather: 5 }
    expect(sliceFactor(0, s)).toBe(0) // d = 100, far end
  })

  it("feathers across the edge", () => {
    const s = { ...on, near: 0, far: 50, feather: 10 }
    const mid = sliceFactor(Math.round(255 * (1 - 0.55)), s) // d = 55, halfway through the feather
    expect(mid).toBeGreaterThan(0.3)
    expect(mid).toBeLessThan(0.7)
  })

  it("removes pixels nearer than the near edge", () => {
    const s = { ...on, near: 60, far: 100, feather: 5 }
    expect(sliceFactor(255, s)).toBe(0) // d = 0, closest
  })
})

describe("isNoopSlice", () => {
  it("is a no-op when off or covering the full range", () => {
    expect(isNoopSlice(DEFAULT_DEPTH_SLICE)).toBe(true)
    expect(isNoopSlice({ ...on })).toBe(true)
    expect(isNoopSlice({ ...on, far: 90 })).toBe(false)
  })
})

describe("sliceAroundSubject", () => {
  it("brackets the subject's distance", () => {
    const w = sliceAroundSubject(0.7) // subject at distance 30
    expect(w.near).toBe(0)
    expect(w.far).toBe(42)
  })
})
