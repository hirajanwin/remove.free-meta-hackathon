// A labelled contact sheet: the same photo through every model and material.
//
// `/bench` answers "how fast", which is the easy half. The half that decides
// which model you actually want is "what does the edge look like", and a
// millisecond count cannot show you that. This renders the grid.
//
// Composed in the browser rather than with ffmpeg or sharp, because everything
// needed is already there: the app cuts the image, a canvas draws the tiles and
// the labels, and the result comes back as one PNG. No extra dependency, and
// the sheet is made by the same code path a user gets.
//
// Deliberately NOT a CI gate. It downloads several hundred MiB of weights from
// Hugging Face and takes minutes; making that a required check would let
// someone else's CDN block an unrelated pull request. It is a thing you run
// when you want to look.

import { writeFileSync, mkdirSync } from "node:fs"
import { chromium } from "playwright"
import { startServer, launch } from "./harness.mjs"

const SAMPLE = process.argv.find((a) => a.startsWith("--image="))?.slice(8) ?? "/samples/portrait.jpg"
const MODELS = (process.argv.find((a) => a.startsWith("--models="))?.slice(9) ?? "modnet,birefnet-lite")
  .split(",")
  .filter(Boolean)
const MATERIALS = (process.argv.find((a) => a.startsWith("--materials="))?.slice(12) ?? "auto,hair,hard")
  .split(",")
  .filter(Boolean)
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".shots/model-sheet.png"

const { base, stop } = await startServer(5593)
const browser = await launch({ chromium })

console.log(`models:    ${MODELS.join(", ")}`)
console.log(`materials: ${MATERIALS.join(", ")}`)
console.log(`image:     ${SAMPLE}\n`)

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  page.setDefaultTimeout(600_000)
  await page.goto(base, { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(2500)

  const dataUrl = await page.evaluate(
    async ({ sample, models, materials }) => {
      const { removeBackground } = await import("/src/lib/bg-removal.ts")
      const { materialById } = await import("/src/lib/recipe/materials.ts")

      const blob = await (await fetch(sample)).blob()

      const TILE = 340
      const PAD = 12
      const HEADER = 34
      const ROW_LABEL = 120

      const canvas = document.createElement("canvas")
      canvas.width = ROW_LABEL + materials.length * (TILE + PAD) + PAD
      canvas.height = HEADER + models.length * (TILE + PAD) + PAD
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#0a0a0b"
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // A checkerboard behind every tile, so transparency is legible as
      // transparency rather than as black.
      const check = document.createElement("canvas")
      check.width = check.height = 16
      const cc = check.getContext("2d")
      cc.fillStyle = "#2a2a2e"
      cc.fillRect(0, 0, 16, 16)
      cc.fillStyle = "#1e1e22"
      cc.fillRect(0, 0, 8, 8)
      cc.fillRect(8, 8, 8, 8)
      const pattern = ctx.createPattern(check, "repeat")

      ctx.font = "600 13px ui-monospace, monospace"
      ctx.fillStyle = "#e5e5e5"
      ctx.textBaseline = "middle"

      for (let c = 0; c < materials.length; c++) {
        const m = materialById(materials[c])
        ctx.fillText(m.label, ROW_LABEL + c * (TILE + PAD), HEADER / 2)
      }

      const timings = []

      for (let r = 0; r < models.length; r++) {
        for (let c = 0; c < materials.length; c++) {
          const t0 = performance.now()
          const result = await removeBackground(blob, models[r], {
            material: materials[c],
            strength: 1,
          })
          const ms = Math.round(performance.now() - t0)
          timings.push({ model: models[r], material: materials[c], ms })

          const x = ROW_LABEL + c * (TILE + PAD)
          const y = HEADER + r * (TILE + PAD)

          ctx.fillStyle = pattern
          ctx.fillRect(x, y, TILE, TILE)

          const src = result.cutoutCanvas
          const scale = Math.min(TILE / src.width, TILE / src.height)
          const w = src.width * scale
          const h = src.height * scale
          ctx.drawImage(src, x + (TILE - w) / 2, y + (TILE - h) / 2, w, h)

          ctx.fillStyle = "rgba(0,0,0,0.6)"
          ctx.fillRect(x, y + TILE - 20, TILE, 20)
          ctx.fillStyle = "#a1a1aa"
          ctx.font = "11px ui-monospace, monospace"
          ctx.fillText(`${ms} ms`, x + 6, y + TILE - 10)
        }

        ctx.fillStyle = "#e5e5e5"
        ctx.font = "600 13px ui-monospace, monospace"
        ctx.fillText(models[r], 8, HEADER + r * (TILE + PAD) + TILE / 2)
      }

      window.__TIMINGS__ = timings
      return canvas.toDataURL("image/png")
    },
    { sample: SAMPLE, models: MODELS, materials: MATERIALS }
  )

  const timings = await page.evaluate(() => window.__TIMINGS__)
  for (const t of timings) console.log(`  ${t.model.padEnd(16)} ${t.material.padEnd(8)} ${t.ms} ms`)

  mkdirSync(OUT.split("/").slice(0, -1).join("/") || ".", { recursive: true })
  writeFileSync(OUT, Buffer.from(dataUrl.split(",")[1], "base64"))
  console.log(`\nwrote ${OUT}`)
} finally {
  await browser.close()
  stop()
}
