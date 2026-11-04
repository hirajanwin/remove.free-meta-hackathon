import { describe, expect, it } from "vitest"
import { encodeWavMono } from "../wav"

describe("encodeWavMono", () => {
  it("writes a valid RIFF header and clamps samples", async () => {
    const blob = encodeWavMono(new Float32Array([0, 0.5, -0.5, 2]), 16000)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...bytes.slice(o, o + n))
    expect(ascii(0, 4)).toBe("RIFF")
    expect(ascii(8, 4)).toBe("WAVE")
    expect(bytes.length).toBe(44 + 8)
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getInt16(44 + 2, true)).toBe(16383) // 0.5 * 0x7fff
    expect(view.getInt16(44 + 6, true)).toBe(32767) // clamped
  })
})
