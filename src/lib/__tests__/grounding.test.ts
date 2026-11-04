import { describe, expect, it } from "vitest"
import { filterBoxes, type GroundingBox } from "../grounding"

const box = (score: number, x: number, y: number, s = 10): GroundingBox => ({
  label: "dog.",
  score,
  box: { xmin: x, ymin: y, xmax: x + s, ymax: y + s },
})

describe("filterBoxes", () => {
  it("drops low scores and near-duplicates, best first", () => {
    const out = filterBoxes([
      box(0.2, 100, 100), // below floor
      box(0.9, 0, 0),
      box(0.8, 1, 1), // same object as the 0.9 box
      box(0.7, 50, 50), // distinct
    ])
    expect(out.map((b) => b.score)).toEqual([0.9, 0.7])
  })

  it("caps the count", () => {
    const many = Array.from({ length: 20 }, (_, i) => box(0.9 - i * 0.01, i * 100, 0))
    expect(filterBoxes(many).length).toBe(8)
  })
})
