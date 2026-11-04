import { describe, expect, it } from "vitest"
import {
  recipeSchema,
  defaultRecipe,
  parseRecipe,
  toJSON,
  RECIPE_VERSION,
  FILE_EXTENSION,
  effectSchema,
} from "../recipe/schema"
import {
  toShareLink,
  fromShareLink,
  toFile,
  fileNameFor,
  isRecipeFile,
} from "../recipe/share"
import { MATERIALS, materialById, applyMaterial } from "../recipe/materials"
import { renderEffect, effectDistanceField, alphaOf } from "../recipe/effects"

describe("the .remove schema", () => {
  it("parses an empty object into a complete recipe", () => {
    // Every field defaulted means a recipe file can name only what it changed.
    const r = defaultRecipe()
    expect(r.version).toBe(RECIPE_VERSION)
    expect(r.background.type).toBe("transparent")
    expect(r.edge.material).toBe("auto")
    expect(r.export.format).toBe("png")
    expect(r.effects).toEqual([])
  })

  it("leaves the model unpinned by default", () => {
    // A shared recipe that pins BiRefNet hands a CPU visitor a 214 MiB download
    // to reproduce a look MODNet would have got close to.
    expect(defaultRecipe().model).toBeNull()
  })

  it("rejects a colour that is not #rrggbb", () => {
    expect(recipeSchema.safeParse({ background: { type: "color", color: "red" } }).success).toBe(
      false
    )
    expect(recipeSchema.safeParse({ background: { type: "color", color: "#ff0000" } }).success).toBe(
      true
    )
  })

  it("clamps nothing silently — out-of-range values are rejected, not coerced", () => {
    // Coercion would make a corrupt link look like a valid treatment.
    expect(recipeSchema.safeParse({ edge: { strength: 99 } }).success).toBe(false)
    expect(recipeSchema.safeParse({ export: { quality: 0 } }).success).toBe(false)
  })

  it("reports which field was wrong rather than disappearing", () => {
    const r = parseRecipe({ export: { format: "bmp" } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/export/)
  })

  it("warns about a newer version instead of refusing it", () => {
    const r = parseRecipe({ version: RECIPE_VERSION + 5 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings[0]).toMatch(/version/)
  })

  it("serializes only what differs from the defaults", () => {
    const bare = toJSON(defaultRecipe()) as Record<string, unknown>
    expect(Object.keys(bare)).toEqual(["version"])

    const tweaked = toJSON({ ...defaultRecipe(), edge: { material: "hair", strength: 1 } })
    expect(tweaked).toHaveProperty("edge")
    expect(tweaked).not.toHaveProperty("export")
  })

  it("round-trips a full recipe through JSON unchanged", () => {
    const original = recipeSchema.parse({
      name: "Hair on a sweep",
      model: "birefnet-lite",
      edge: { material: "hair", strength: 1.4 },
      background: { type: "blur", amount: 32, depth: true },
      effects: [
        { type: "shadow", blur: 40, angle: 120, distance: 20, color: "#101010", opacity: 0.5 },
        { type: "outline", width: 12, color: "#ffffff", tightness: 0.5 },
      ],
      export: { format: "webp", quality: 88 },
    })
    const back = parseRecipe(JSON.parse(JSON.stringify(toJSON(original))))
    expect(back.ok).toBe(true)
    if (back.ok) expect(back.recipe).toEqual(original)
  })

  it("keeps effect order, because order is the picture", () => {
    const r = recipeSchema.parse({
      effects: [{ type: "outline" }, { type: "shadow" }],
    })
    expect(r.effects.map((e) => e.type)).toEqual(["outline", "shadow"])
  })
})

describe("share links", () => {
  const origin = "https://remove.free"

  it("round-trips through a URL", () => {
    const original = recipeSchema.parse({
      name: "Glass bottle",
      edge: { material: "glass", strength: 1 },
      background: { type: "color", color: "#0a0a0b" },
    })
    const link = toShareLink(original, origin)
    const back = fromShareLink(link)
    expect(back).toEqual(original)
  })

  it("puts the recipe in the fragment, never the query", () => {
    // A fragment is not sent to the origin, not logged, and not forwarded in a
    // Referer. That is the whole privacy claim and it is structural.
    const link = toShareLink(defaultRecipe(), origin)
    const url = new URL(link)
    expect(url.search).toBe("")
    expect(url.hash).toMatch(/^#r=/)
  })

  it("survives a hash router having been through it", () => {
    const original = recipeSchema.parse({ name: "x", edge: { material: "fur", strength: 1 } })
    const packed = new URL(toShareLink(original, origin)).hash.slice(3)
    expect(fromShareLink(`${origin}/#/studio?r=${packed}`)).toEqual(original)
  })

  it("returns null rather than throwing on anything malformed", () => {
    for (const bad of [
      `${origin}/`,
      `${origin}/#`,
      `${origin}/#r=`,
      `${origin}/#r=not-base64!!`,
      `${origin}/#r=${btoa("{not json")}`,
      "not a url at all",
    ]) {
      expect(fromShareLink(bad)).toBeNull()
    }
  })

  it("beats percent-encoding on length, which is why base64url", () => {
    const recipe = recipeSchema.parse({
      name: "Comparison",
      edge: { material: "hair", strength: 1.2 },
      background: { type: "blur", amount: 24, depth: true },
      effects: [{ type: "glow", radius: 40, color: "#6df4ce", opacity: 0.7 }],
    })
    const json = JSON.stringify(toJSON(recipe))
    const packed = new URL(toShareLink(recipe, origin)).hash.length
    expect(packed).toBeLessThan(encodeURIComponent(json).length)
  })
})

describe("recipe files", () => {
  it("names the file after the recipe, safely", () => {
    expect(fileNameFor({ ...defaultRecipe(), name: "Hair / on a Sweep!" })).toBe(
      `hair-on-a-sweep${FILE_EXTENSION}`
    )
    expect(fileNameFor({ ...defaultRecipe(), name: "***" })).toBe(`recipe${FILE_EXTENSION}`)
  })

  it("recognises a .remove by extension, not by MIME", () => {
    // Files arriving from a chat app routinely lose their type entirely.
    expect(isRecipeFile(new File([""], "a.remove", { type: "" }))).toBe(true)
    expect(isRecipeFile(new File([""], "A.REMOVE"))).toBe(true)
    expect(isRecipeFile(new File([""], "a.json", { type: "application/json" }))).toBe(false)
  })

  it("writes pretty JSON, because a .remove is meant to be read and diffed", async () => {
    const text = await toFile(defaultRecipe()).text()
    expect(text).toContain("\n")
    expect(text.endsWith("\n")).toBe(true)
    expect(() => JSON.parse(text)).not.toThrow()
  })
})

describe("materials", () => {
  it("has a distinct id for each, and auto first", () => {
    const ids = MATERIALS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe("auto")
  })

  it("falls back rather than throwing on an unknown id", () => {
    expect(materialById("nope").id).toBe("auto")
  })

  it("leaves auto exactly as the library behaved before materials existed", () => {
    const auto = materialById("auto")
    expect(auto.snap).toBe(0)
    expect(auto.unmix).toBe(0)
  })

  it("never snaps a subject whose transparency IS the subject", () => {
    // Snapping glass or hair destroys the thing you are cutting out.
    expect(materialById("glass").snap).toBe(0)
    expect(materialById("hair").snap).toBe(0)
    expect(materialById("hard").snap).toBeGreaterThan(0)
  })

  it("does nothing at all when the material asks for nothing", () => {
    const alpha = new Uint8Array([0, 60, 128, 200, 255])
    const before = [...alpha]
    const pixels = new Uint8ClampedArray(5 * 4).fill(120)
    applyMaterial(alpha, pixels, 4, materialById("auto"))
    expect([...alpha]).toEqual(before)
  })

  it("snaps only the band, never a pixel the model was sure about", () => {
    const alpha = new Uint8Array([0, 10, 128, 245, 255])
    const pixels = new Uint8ClampedArray(5 * 4).fill(120)
    const hard = materialById("hard")
    applyMaterial(alpha, pixels, 4, hard)
    expect(alpha[0]).toBe(0)
    expect(alpha[4]).toBe(255)
    expect(alpha[1]).toBe(0) // 10 <= snap(24)
    expect(alpha[3]).toBe(255) // 245 >= 255-24
    expect(alpha[2]).toBe(128) // mid-band survives
  })

  it("pulls a fringe away from the background it was shot against", () => {
    // Two transparent green pixels set the background estimate; the half-alpha
    // pixel is green-contaminated and should move away from green.
    const alpha = new Uint8Array([0, 0, 128])
    const pixels = new Uint8ClampedArray([
      0, 255, 0, 0,
      0, 255, 0, 0,
      60, 200, 60, 128,
    ])
    const greenBefore = pixels[9]
    applyMaterial(alpha, pixels, 4, materialById("hair"))
    expect(pixels[9]).toBeLessThan(greenBefore)
  })

  it("does not unmix a pixel too faint to solve for", () => {
    // F = (C - (1-a)B)/a explodes as a approaches 0, so the strength is scaled
    // by alpha as well — a 2%-opaque pixel barely moves.
    const alpha = new Uint8Array([0, 0, 5])
    const pixels = new Uint8ClampedArray([0, 255, 0, 0, 0, 255, 0, 0, 10, 250, 10, 5])
    const before = [...pixels]
    applyMaterial(alpha, pixels, 4, materialById("hair"))
    for (let i = 8; i < 11; i++) expect(Math.abs(pixels[i] - before[i])).toBeLessThan(24)
  })
})

describe("effects", () => {
  /** A 16x16 field with an 8x8 opaque square in the middle. */
  function square() {
    const w = 16
    const h = 16
    const alpha = new Uint8Array(w * h)
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) alpha[y * w + x] = 255
    return { alpha, w, h }
  }

  it("measures distance exactly, not by chamfer approximation", () => {
    const { alpha, w, h } = square()
    const d2 = effectDistanceField(alpha, w, h)
    // Straight out from the left edge of the square.
    expect(Math.sqrt(d2[8 * w + 3])).toBeCloseTo(1, 5)
    expect(Math.sqrt(d2[8 * w + 1])).toBeCloseTo(3, 5)
    // Diagonally off the corner: 3-4-5 from (4,4) to (1,0)... use (0,0).
    expect(Math.sqrt(d2[0])).toBeCloseTo(Math.hypot(4, 4), 5)
    // Inside the subject is zero.
    expect(d2[8 * w + 8]).toBe(0)
  })

  it("draws an outline outside the subject and nowhere else", () => {
    const { alpha, w, h } = square()
    const d2 = effectDistanceField(alpha, w, h)
    const layer = renderEffect(
      { type: "outline", width: 2, color: "#ff0000", tightness: 1 },
      alpha,
      d2,
      w,
      h
    )
    // Inside the subject: nothing (the cutout is drawn over it).
    expect(layer.data[(8 * w + 8) * 4 + 3]).toBe(0)
    // Just outside: red, opaque.
    const just = (8 * w + 3) * 4
    expect(layer.data[just]).toBe(255)
    expect(layer.data[just + 3]).toBeGreaterThan(200)
    // Far outside: nothing.
    expect(layer.data[3]).toBe(0)
  })

  it("makes a wider outline reach further", () => {
    const { alpha, w, h } = square()
    const d2 = effectDistanceField(alpha, w, h)
    const at = (width: number) =>
      renderEffect({ type: "outline", width, color: "#ffffff", tightness: 1 }, alpha, d2, w, h)
        .data[(8 * w + 1) * 4 + 3]
    expect(at(1)).toBe(0)
    expect(at(4)).toBeGreaterThan(200)
  })

  it("offsets a shadow in the direction it is pointed", () => {
    const { alpha, w, h } = square()
    const d2 = effectDistanceField(alpha, w, h)
    const shadow = (angle: number) =>
      renderEffect(
        { type: "shadow", blur: 0, angle, distance: 3, color: "#000000", opacity: 1 },
        alpha,
        d2,
        w,
        h
      ).data
    // 90 degrees is down, so coverage appears below the square and not above.
    const down = shadow(90)
    expect(down[(13 * w + 8) * 4 + 3]).toBeGreaterThan(100)
    expect(down[(2 * w + 8) * 4 + 3]).toBe(0)
    // 270 is up, and mirrors it.
    const up = shadow(270)
    expect(up[(2 * w + 8) * 4 + 3]).toBeGreaterThan(100)
  })

  it("spreads a glow past the silhouette without a hard rim", () => {
    const { alpha, w, h } = square()
    const d2 = effectDistanceField(alpha, w, h)
    const layer = renderEffect(
      { type: "glow", radius: 8, color: "#6df4ce", opacity: 1 },
      alpha,
      d2,
      w,
      h
    )
    const near = layer.data[(8 * w + 2) * 4 + 3]
    const far = layer.data[(8 * w + 0) * 4 + 3]
    expect(near).toBeGreaterThan(0)
    expect(near).toBeGreaterThan(far)
  })

  it("returns a plain ArrayBuffer, so ImageData will take it", () => {
    const { alpha, w, h } = square()
    const d2 = effectDistanceField(alpha, w, h)
    // Parsed, not raw: renderEffect takes a fully-defaulted config, and tsc
    // enforces that — vitest alone does not typecheck, so this failed here
    // first and in `pnpm typecheck` second.
    const effect = effectSchema.parse({ type: "outline" })
    const layer = renderEffect(effect, alpha, d2, w, h)
    expect(layer.data.buffer).toBeInstanceOf(ArrayBuffer)
  })

  it("reads alpha out of RGBA", () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 40, 5, 6, 7, 80])
    expect([...alphaOf(rgba, 2)]).toEqual([40, 80])
  })
})
