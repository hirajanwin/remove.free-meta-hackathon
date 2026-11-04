import { describe, expect, it } from "vitest"
import { cropRect } from "../crop"

describe("cropRect", () => {
  it("centres a square on the subject, not the frame", () => {
    const r = cropRect(1000, 800, 1, { x: 100, y: 300, w: 200, h: 200 })
    expect(r.w).toBe(r.h)
    expect(r.x + r.w / 2).toBeCloseTo(200, -1) // subject centre x=200
    expect(r.y + r.h / 2).toBeCloseTo(400, -1)
  })

  it("clamps inside the frame at the edges", () => {
    const r = cropRect(1000, 800, 1, { x: 0, y: 0, w: 100, h: 100 })
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.x + r.w).toBeLessThanOrEqual(1000)
  })

  it("never exceeds the frame for wide aspects", () => {
    const r = cropRect(800, 1200, 16 / 9, null)
    expect(r.w).toBeLessThanOrEqual(800)
    expect(r.h).toBeLessThanOrEqual(1200)
    expect(r.w / r.h).toBeCloseTo(16 / 9, 1)
  })
})
