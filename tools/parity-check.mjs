// The wormhole's GLSL, on a real GPU, against its JS twin.
//
// Boots the dev server, loads /parity.html, and fails if any case drifts past
// the epsilon. See src/lib/wormhole/parity.ts for what the cases are and why
// the tolerance is what it is.

import { chromium } from "playwright"
import { startServer, launch, report, check } from "./harness.mjs"

const { base, stop } = await startServer(5598)
const browser = await launch({ chromium })

try {
  const page = await browser.newPage()
  page.on("console", (m) => {
    if (m.type() === "error") console.error(`  page error: ${m.text()}`)
  })

  await page.goto(`${base}/parity.html`, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(() => window.__PARITY__ !== undefined, { timeout: 60_000 })
  const parity = await page.evaluate(() => window.__PARITY__)

  if (parity.error) {
    console.error(`parity harness error: ${parity.error}`)
    process.exitCode = 1
  } else if (!parity.results?.length) {
    console.error("parity harness produced no results")
    process.exitCode = 1
  } else {
    for (const r of parity.results) {
      check(r.name, r.pass, `max error ${r.maxError.toExponential(2)}${r.pass ? "" : ` at ${r.worst}`}`)
    }
  }
} finally {
  await browser.close()
  stop()
}

report("parity")
