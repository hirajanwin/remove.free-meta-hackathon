import { describe, expect, it } from "vitest"
import { composeSamMasks } from "../meta"

describe("composeSamMasks", () => {
  it("stamps each raster at its box origin", () => {
    const out = composeSamMasks(
      [{ raster: new Uint8Array([1, 1, 0, 1]), width: 2, height: 2, left: 1, top: 1 }],
      4,
      4
    )
    // 2x2 block at (1,1): set except its bottom-left zero.
    expect(out[1 * 4 + 1]).toBe(255)
    expect(out[1 * 4 + 2]).toBe(255)
    expect(out[2 * 4 + 1]).toBe(0)
    expect(out[2 * 4 + 2]).toBe(255)
    expect(out[0]).toBe(0)
  })

  it("unions overlapping objects", () => {
    const out = composeSamMasks(
      [
        { raster: new Uint8Array([1]), width: 1, height: 1, left: 0, top: 0 },
        { raster: new Uint8Array([1]), width: 1, height: 1, left: 0, top: 0 },
      ],
      2,
      2
    )
    expect(out[0]).toBe(255)
    expect(out.filter((v) => v === 255).length).toBe(1)
  })

  it("clips rasters that overflow the frame", () => {
    const out = composeSamMasks(
      [{ raster: new Uint8Array([1, 1, 1, 1]), width: 2, height: 2, left: 3, top: 3 }],
      4,
      4
    )
    expect(out[3 * 4 + 3]).toBe(255)
    expect(out.length).toBe(16)
  })

  it("returns an empty mask for no objects", () => {
    const out = composeSamMasks([], 3, 2)
    expect(out.length).toBe(6)
    expect(out.every((v) => v === 0)).toBe(true)
  })
})
