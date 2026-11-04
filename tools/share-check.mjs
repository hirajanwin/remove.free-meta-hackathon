// A recipe survives the trip to someone else.
//
// The round-trip is unit-tested already, but a unit test shares a module
// registry with the thing it is testing. This one goes the whole way: build a
// recipe in one browser context, take the link, open it in a **second context
// with its own storage** — a browser that has never seen this app — and assert
// the treatment arrived intact and editable.
//
// That second context is the point. A share feature that works because the
// sender's localStorage happens to hold the recipe is not a share feature, and
// nothing running in one page can tell the difference.

import { chromium } from "playwright"
import { startServer, launch, check, report } from "./harness.mjs"

const { base, stop } = await startServer(5597)
const browser = await launch({ chromium })

try {
  // ── Sender ────────────────────────────────────────────
  const sender = await browser.newContext()
  const a = await sender.newPage()
  await a.goto(base, { waitUntil: "domcontentloaded" })
  await a.waitForTimeout(1500)

  const link = await a.evaluate(async (origin) => {
    const { recipeSchema } = await import("/src/lib/recipe/schema.ts")
    const { toShareLink } = await import("/src/lib/recipe/share.ts")
    const recipe = recipeSchema.parse({
      name: "Windblown hair on foliage",
      model: "birefnet-lite",
      edge: { material: "hair", strength: 1.35 },
      background: { type: "blur", amount: 28, depth: true },
      effects: [
        { type: "shadow", blur: 40, angle: 115, distance: 18, color: "#0a0a0b", opacity: 0.45 },
        { type: "outline", width: 6, color: "#ffffff", tightness: 0.8 },
      ],
      export: { format: "webp", quality: 88 },
    })
    return toShareLink(recipe, origin)
  }, base)

  check("sender produced a link", typeof link === "string" && link.includes("#r="))
  check(
    "the recipe is in the fragment, not the query",
    new URL(link).search === "",
    new URL(link).search || "(empty)"
  )
  // A URL that a chat app will not truncate. 2000 is the conservative ceiling
  // every browser and most link-unfurlers respect.
  check(`link is ${link.length} chars`, link.length < 2000)

  await sender.close()

  // ── Receiver: a browser that has never seen this app ──
  const receiver = await browser.newContext()
  const b = await receiver.newPage()

  const storageBefore = await b.evaluate(() => 0).catch(() => 0)
  void storageBefore

  await b.goto(link, { waitUntil: "domcontentloaded" })
  await b.waitForTimeout(2500)

  // Assert on the UI, not on the URL.
  //
  // The first version of this read the recipe back out of `location.href` and
  // passed — then started failing the moment the studio began CONSUMING the
  // link and clearing it, which is the correct behaviour (a link left in the
  // bar is re-applied on every reload, silently undoing whatever the person
  // changed since). The harness was checking that a parser round-trips, which
  // a unit test already covers. What actually matters is that the treatment
  // arrived in the controls the receiver can see and edit.
  const landed = await b.evaluate(() => {
    const group = document.querySelector('[role="radiogroup"][aria-label="What is being cut out"]')
    const material = group
      ? [...group.querySelectorAll('[role="radio"]')].find((r) => r.getAttribute("aria-checked") === "true")
          ?.textContent?.trim()
      : null
    const selectedTabs = [...document.querySelectorAll('[role="tab"][aria-selected="true"]')].map((t) =>
      t.textContent.trim().replace(/(.+)\1/, "$1")
    )
    return { material, selectedTabs, hasRecipePanel: !!document.querySelector('input[accept=".remove"]') }
  })

  check("the receiver's studio shows the shared material", landed.material === "Hair", String(landed.material))
  check(
    "the shared background mode is selected",
    landed.selectedTabs.includes("Blur"),
    landed.selectedTabs.join(", ")
  )
  check(
    "the shared export format is selected",
    landed.selectedTabs.some((t) => /webp/i.test(t)),
    landed.selectedTabs.join(", ")
  )
  check("the recipe panel is there, so the treatment is editable and re-shareable", landed.hasRecipePanel)

  // Consumed, not left lying in the address bar.
  const url = await b.evaluate(() => location.href)
  check("the link is cleared once applied", !url.includes("#r="), url.slice(-40))

  // Nothing arrived by any route except the URL: this context was created
  // fresh, so anything in storage was written by the app on this load.
  const seeded = await b.evaluate(() => {
    try {
      return Object.keys(localStorage).filter((k) => k.toLowerCase().includes("recipe")).length
    } catch {
      return -1
    }
  })
  check("no recipe was read from storage", seeded === 0, `recipe-ish keys: ${seeded}`)

  // A corrupted link must land you in a working studio, not an error page.
  await b.goto(`${base}/#r=not-a-real-recipe`, { waitUntil: "domcontentloaded" })
  await b.waitForTimeout(1200)
  const recovered = await b.evaluate(() => ({
    rendered: !!document.querySelector("main"),
    recipe: null,
  }))
  check("a corrupted link still renders the app", recovered.rendered)

  await receiver.close()
} finally {
  await browser.close()
  stop()
}

report("share")
