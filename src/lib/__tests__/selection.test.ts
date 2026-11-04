import { describe, expect, it } from "vitest"
import { polygonMask, rectMask } from "../selection"

describe("rectMask", () => {
  it("fills between corners regardless of drag direction", () => {
    const m = rectMask(5, 5, { x: 3, y: 3 }, { x: 1, y: 1 })
    expect(m[1 * 5 + 1]).toBe(255)
    expect(m[3 * 5 + 3]).toBe(255)
    expect(m[0]).toBe(0)
    expect(m.filter((v) => v === 255).length).toBe(9)
  })
})

describe("polygonMask", () => {
  it("fills a triangle's interior, not its corners", () => {
    const m = polygonMask(10, 10, [
      { x: 1, y: 1 },
      { x: 8, y: 1 },
      { x: 1, y: 8 },
    ])
    expect(m[2 * 10 + 2]).toBe(255) // inside
    expect(m[7 * 10 + 7]).toBe(0) // outside (beyond hypotenuse)
    expect(m[0]).toBe(0)
  })

  it("returns empty for fewer than 3 points", () => {
    expect(polygonMask(4, 4, [{ x: 0, y: 0 }, { x: 3, y: 3 }]).every((v) => v === 0)).toBe(true)
  })
})
