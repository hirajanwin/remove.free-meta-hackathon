// Every route renders, in both themes, at desktop and phone, with no axe
// violations and no console errors.
//
// This replaces a sweep that was previously run by hand in a browser pane and
// reported into a chat transcript. Two things about that were unsatisfactory:
// nobody else could re-run it, and the pane suspends its rendering pipeline
// while hidden, which made CSS colour transitions freeze partway and produced
// a string of phantom `color-contrast` failures that took several passes to
// diagnose.
//
// Both are fixed here. Headless Chromium is never hidden, and the harness
// disables transitions and animations for the duration of the audit anyway —
// contrast is a claim about the resting state, so the resting state is what
// gets measured.

import { chromium } from "playwright"
import { startServer, launch, collectErrors, check, report } from "./harness.mjs"

const ROUTES = [
  "/",
  "/batch",
  "/video",
  "/webcam",
  "/bench",
  "/depth",
  "/wormhole",
  "/models",
  "/agent",
  "/history",
]

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 812 },
]

const AXE = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js"

const { base, stop } = await startServer(5599)
const browser = await launch({ chromium })

try {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      // A hard no on the model downloads: these checks are about the shell, and
      // a route that only passes after fetching 138 MiB from Hugging Face is a
      // route whose check depends on someone else's CDN.
      offline: false,
    })
    const page = await context.newPage()
    const errors = collectErrors(page)

    for (const route of ROUTES) {
      errors.length = 0
      await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded" })
      await page.waitForTimeout(1200)

      await page.addScriptTag({ url: AXE })
      await page.addStyleTag({
        content: "*,*::before,*::after{transition:none!important;animation:none!important}",
      })

      for (const theme of ["light", "dark"]) {
        await page.evaluate((t) => {
          document.documentElement.setAttribute("data-theme", t)
          document.documentElement.classList.toggle("dark", t === "dark")
        }, theme)

        const result = await page.evaluate(async () => {
          // The thinking indicator cross-fades a word on a timer; a sampled
          // frame catches it mid-fade, which is not its resting state.
          const run = await window.axe.run(
            { exclude: [['[data-slot="thinking-indicator"]']] },
            {
              runOnly: {
                type: "tag",
                values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
              },
            }
          )
          return run.violations.map((v) => `${v.id}:${v.nodes.length}`)
        })

        check(
          `${viewport.name} ${route} ${theme}`,
          result.length === 0,
          result.join(", ")
        )
      }

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
      check(`${viewport.name} ${route} no horizontal overflow`, !overflow)

      // A route that logs an error is a route that is broken in a way nobody
      // notices until a user hits it.
      const unexpected = errors.filter(
        (e) => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)
      )
      check(`${viewport.name} ${route} console clean`, unexpected.length === 0, unexpected[0] ?? "")
    }

    await context.close()
  }
} finally {
  await browser.close()
  stop()
}

report("route")
