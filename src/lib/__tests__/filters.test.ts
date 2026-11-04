import { describe, expect, it } from "vitest"
import { buildSubjectFilter, presetById } from "../filters"

describe("buildSubjectFilter", () => {
  it("is empty at neutral with no preset", () => {
    expect(buildSubjectFilter("none", { brightness: 1, contrast: 1, saturation: 1 })).toBe("")
  })

  it("composes preset then adjustments", () => {
    const f = buildSubjectFilter("vivid", { brightness: 1.1, contrast: 1, saturation: 1 })
    expect(f).toContain("saturate(1.35)")
    expect(f).toContain("brightness(1.1)")
  })

  it("unknown presets fall back to none", () => {
    expect(presetById("nope").id).toBe("none")
  })
})
