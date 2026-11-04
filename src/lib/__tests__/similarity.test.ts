import { describe, expect, it } from "vitest"
import { maskFromSimilarity, patchSimilarity, seedPoints } from "../similarity"

// 1 CLS + 4 patches of dim 2. Patch vectors: p0=+x, p1=+x, p2=-x, p3=+y.
function features(): Float32Array {
  return new Float32Array([
    9, 9, // CLS (ignored)
    1, 0, // p0
    2, 0, // p1
    -1, 0, // p2
    0, 3, // p3
  ])
}

describe("patchSimilarity", () => {
  it("scores identical direction 1, opposite -1, orthogonal 0", () => {
    const sim = patchSimilarity(features(), 5, 2, 0)
    expect(sim[0]).toBeCloseTo(1)
    expect(sim[1]).toBeCloseTo(1)
    expect(sim[2]).toBeCloseTo(-1)
    expect(sim[3]).toBeCloseTo(0)
  })

  it("ignores the CLS token", () => {
    const sim = patchSimilarity(features(), 5, 2, 3)
    expect(sim.length).toBe(4)
    expect(sim[3]).toBeCloseTo(1)
    expect(sim[0]).toBeCloseTo(0)
  })
})

describe("maskFromSimilarity", () => {
  it("thresholds inclusively", () => {
    const mask = maskFromSimilarity(new Float32Array([0.4, 0.5, 0.6]), 0.5)
    expect([...mask]).toEqual([0, 255, 255])
  })
})

describe("seedPoints", () => {
  it("gives one seed per cluster, largest first, in image coords", () => {
    // 4x2 grid: left column cluster of 2, right column cluster of 1.
    const sim = new Float32Array([0.9, 0, 0, 0.8, 0.9, 0, 0, 0])
    const seeds = seedPoints(sim, 4, 2, 400, 200, 0.5)
    expect(seeds.length).toBe(2)
    expect(seeds[0].area).toBe(2)
    // Left cluster centroid sits in patch column 0 -> x near 50 of 400.
    expect(seeds[0].x).toBeLessThan(100)
    expect(seeds[1].x).toBeGreaterThan(300)
  })

  it("drops weak sprawling clusters the user did not click", () => {
    // Query cluster: patches 0-1 (peak 1.0). Backdrop cluster: patches 4-7
    // at 0.6 — above the 0.5 floor but weak and covering half the grid.
    const sim = new Float32Array([1, 0.95, 0, 0, 0, 0, 0.55, 0.55])
    const seeds = seedPoints(sim, 4, 2, 400, 200, 0.5, 4, 0)
    expect(seeds.length).toBe(1)
    expect(seeds[0].x).toBeLessThan(100)
  })

  it("returns nothing below threshold", () => {
    const seeds = seedPoints(new Float32Array([0.1, 0.2]), 2, 1, 100, 100, 0.5)
    expect(seeds).toEqual([])
  })
})
