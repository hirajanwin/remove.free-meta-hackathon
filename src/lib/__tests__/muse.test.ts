import { describe, expect, it } from "vitest"
import { backdropSizeFor, parseCameraPlan, parsePlan, simplifyConcept, verifyMask } from "../muse"

describe("parsePlan", () => {
  it("parses a full plan", () => {
    const plan = parsePlan(
      '{"concept":"the dog","action":"keep","background":{"type":"color","color":"#ffffff"},"summary":"Isolate the dog on white."}'
    )
    expect(plan.concept).toBe("the dog")
    expect(plan.action).toBe("keep")
    expect(plan.background).toEqual({ type: "color", color: "#ffffff" })
  })

  it("strips code fences", () => {
    const plan = parsePlan('```json\n{"concept":null,"action":"keep","background":{"type":"transparent"},"summary":"x"}\n```')
    expect(plan.concept).toBeNull()
    expect(plan.background).toEqual({ type: "transparent" })
  })

  it("defaults action to keep and repairs a bad colour", () => {
    const plan = parsePlan(
      '{"concept":"hat","action":"banana","background":{"type":"color","color":"white"},"summary":"x"}'
    )
    expect(plan.action).toBe("keep")
    expect(plan.background).toEqual({ type: "color", color: "#ffffff" })
  })

  it("throws on non-JSON", () => {
    expect(() => parsePlan("sure, doing that now")).toThrow()
  })
})

describe("simplifyConcept", () => {
  it("strips articles, leaves bare phrases alone", () => {
    expect(simplifyConcept("the dog")).toBe("dog")
    expect(simplifyConcept("A red hat")).toBe("red hat")
    expect(simplifyConcept("dog")).toBe("dog")
  })
})

describe("backdropSizeFor", () => {
  it("picks landscape, portrait, or square by aspect", () => {
    expect(backdropSizeFor(1600, 900)).toBe("1536x1024")
    expect(backdropSizeFor(900, 1600)).toBe("1024x1536")
    expect(backdropSizeFor(1000, 1000)).toBe("1024x1024")
  })
})

describe("verifyMask", () => {
  it("reports coverage and soft edge as percentages", () => {
    const mask = new Uint8Array([255, 255, 0, 128])
    const v = verifyMask(mask)
    expect(v.coverage).toBe(75) // 255,255,128 are >127
    expect(v.softEdge).toBe(25)
  })
})

describe("parseCameraPlan", () => {
  it("parses a scene plan", () => {
    const plan = parseCameraPlan(
      '{"mode":"image","color":null,"gradient":null,"blur":null,"scene":"a quiet beach at sunset","summary":"Beach backdrop."}'
    )
    expect(plan.mode).toBe("image")
    expect(plan.scene).toBe("a quiet beach at sunset")
  })

  it("clamps blur and strips code fences", () => {
    const plan = parseCameraPlan('```json\n{"mode":"blur","blur":500,"summary":"Blur."}\n```')
    expect(plan.mode).toBe("blur")
    expect(plan.blur).toBe(40)
  })

  it("degrades an image plan with no scene to blur", () => {
    expect(parseCameraPlan('{"mode":"image","scene":null,"summary":"x"}').mode).toBe("blur")
  })

  it("rejects a bad hex and defaults a missing gradient", () => {
    expect(parseCameraPlan('{"mode":"color","color":"red","summary":"x"}').mode).toBe("blur")
    expect(parseCameraPlan('{"mode":"gradient","summary":"x"}').gradient).toBe("dark")
  })
})
