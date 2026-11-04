import { describe, expect, it } from "vitest"
import { alphaBounds } from "../pack"

describe("alphaBounds", () => {
  it("finds the subject box", () => {
    const alpha = new Uint8Array(16)
    alpha[1 * 4 + 2] = 255
    alpha[2 * 4 + 1] = 200
    expect(alphaBounds(alpha, 4, 4)).toEqual({ x: 1, y: 1, w: 2, h: 2 })
  })

  it("ignores near-transparent noise and handles empty", () => {
    const alpha = new Uint8Array([4, 0, 0, 0])
    expect(alphaBounds(alpha, 2, 2)).toBeNull()
    expect(alphaBounds(new Uint8Array(4), 2, 2)).toBeNull()
  })
})
