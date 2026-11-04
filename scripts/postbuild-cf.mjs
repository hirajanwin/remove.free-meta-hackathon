#!/usr/bin/env node
// Post-process the Cloudflare Pages build so that only ONE route invokes a
// Function, and everything else is served as a static asset.
//
// Static asset requests are free and unlimited on the Cloudflare free plan.
// Function requests are capped at 100,000/day with a 10 ms CPU ceiling. The
// build's generated _routes.json defaults to include: ["/*"], which sends every
// page navigation through the Function. This script narrows that to the single
// route that genuinely needs server-side execution.

import { readdir, readFile, writeFile, rm, stat, copyFile } from "node:fs/promises"
import { join } from "node:path"
import { createHash } from "node:crypto"

const DIST = "dist"

// The app is a plain Vite SPA, so every page load is a static asset and only
// /api/proxy invokes a Function.
const STATIC_PAGES = true

/**
 * Paths permitted to invoke a Function. Deliberately empty: this project has no
 * server-side code, so nothing is metered and no amount of traffic can exhaust
 * a quota. Adding an entry here reintroduces the 100,000/day request cap and the
 * 10 ms CPU ceiling for that path.
 */
const FUNCTION_ROUTES = []

/**
 * Served straight from static assets, never through the Function. Free and
 * unlimited even while pages are still server-rendered.
 */
const STATIC_EXCLUDES = [
  "/assets/*",
  "/api/agent.json",
  "/agent.mjs",
  "/favicon.ico",
  "/favicon.png",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/site.webmanifest",
]

/** Static asset hard limits on the free plan. */
const MAX_ASSET_BYTES = 25 * 1024 * 1024 // 25 MiB per file
const MAX_ASSET_FILES = 20_000

let warnings = 0

function warn(msg) {
  warnings++
  console.warn(`  ! ${msg}`)
}

// 1. Narrow _routes.json to the Function allowlist.
async function narrowRoutes() {
  const path = join(DIST, "_routes.json")

  // `include` is an allowlist; `exclude` wins over it. Anything not routed to
  // the Function is served as a static asset, which is free and unlimited.
  const routes = STATIC_PAGES
    ? { version: 1, include: FUNCTION_ROUTES, exclude: [] }
    : { version: 1, include: ["/*"], exclude: STATIC_EXCLUDES }

  await writeFile(path, JSON.stringify(routes, null, 2) + "\n")

  if (STATIC_PAGES) {
    console.log(
      FUNCTION_ROUTES.length
        ? `  _routes.json -> Function only for: ${FUNCTION_ROUTES.join(", ")}`
        : "  _routes.json -> no Functions; every request is a free static asset"
    )
  } else {
    console.log(
      `  _routes.json -> SSR pages via Function; ${STATIC_EXCLUDES.length} static paths bypass it`
    )
    console.log(
      "  note: page loads still consume the 100k/day budget until SPA mode is unblocked"
    )
  }
}

// 2. Vite emits index.html itself. Verify it exists, because it is what the SPA
//    fallback in _redirects resolves every client route to.
async function publishShell() {
  const index = join(DIST, "index.html")

  if (!(await stat(index).catch(() => null))) {
    warn("index.html missing from the build — every navigation would 404")
    return
  }
  console.log("  index.html present (SPA fallback target)")
}

// 3. Strip AppleDouble sidecar files. The project lives on an exFAT volume, so
//    macOS scatters ._* files everywhere. They are not assets, they consume the
//    20,000-file budget, and they show up in the deployed asset manifest.
async function stripAppleDouble(dir) {
  let removed = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.name.startsWith("._") || entry.name === ".DS_Store") {
      await rm(full, { recursive: true, force: true })
      removed++
    } else if (entry.isDirectory()) {
      removed += await stripAppleDouble(full)
    }
  }
  return removed
}

// 4. Fail loudly on anything that would break the deploy rather than degrade.
async function checkLimits(dir, acc = { count: 0, oversize: [], largest: null }) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await checkLimits(full, acc)
    } else {
      acc.count++
      const { size } = await stat(full)
      if (size > MAX_ASSET_BYTES) acc.oversize.push({ full, size })
      if (!acc.largest || size > acc.largest.size) acc.largest = { full, size }
    }
  }
  return acc
}

// 5. Stamp the service worker with this build's version and its content-hashed
//    asset list. Filenames change per build, so the precache manifest cannot be
//    written by hand.
async function stampServiceWorker() {
  const swPath = join(DIST, "sw.js")
  let sw
  try {
    sw = await readFile(swPath, "utf8")
  } catch {
    warn("sw.js missing from the build — the app will not work offline")
    return
  }

  const assets = []
  for (const name of await readdir(join(DIST, "assets")).catch(() => [])) {
    // Precache the entry bundles and styles; lazily-loaded route chunks are
    // picked up by the runtime cache on first visit.
    if (name.endsWith(".js") || name.endsWith(".css")) assets.push(`/assets/${name}`)
  }

  // Sample images and the agent manifest are precached deliberately. Verified
  // in real Chrome: without them a first-time visitor who goes offline before
  // clicking anything gets an app whose "try a sample" path is dead, and
  // /api/agent.json 404s. They total ~330 KB, which is worth guaranteeing.
  const samples = []
  for (const name of await readdir(join(DIST, "samples")).catch(() => [])) {
    if (/\.(jpe?g|png|webp)$/i.test(name)) samples.push(`/samples/${name}`)
  }

  // Self-hosted webfonts. Text falls back to the system stack without them,
  // which is a visible reflow on an app that claims to work offline.
  const fonts = []
  for (const name of await readdir(join(DIST, "fonts")).catch(() => [])) {
    if (/\.woff2?$/i.test(name)) fonts.push(`/fonts/${name}`)
  }

  const precache = [
    "/",
    "/index.html",
    "/site.webmanifest",
    "/api/agent.json",
    ...fonts,
    ...samples,
    ...assets,
  ]
  // Hash the worker's own source as well as the file list, so a change to the
  // caching logic rotates the cache name instead of leaving clients on entries
  // written by the previous implementation.
  const version = createHash("sha256")
    .update(precache.join("|"))
    .update(sw)
    .digest("hex")
    .slice(0, 12)

  sw = sw
    .replace(/const SELF_VERSION = "[^"]*"/, `const SELF_VERSION = "${version}"`)
    .replace(
      /const PRECACHE = \[[^\]]*\]/,
      `const PRECACHE = ${JSON.stringify(precache)}`
    )

  await writeFile(swPath, sw)
  console.log(`  sw.js stamped @ ${version} (${precache.length} precached entries)`)
}

console.log("postbuild-cf:")

await narrowRoutes()
await publishShell()

const removed = await stripAppleDouble(DIST)
if (removed) console.log(`  stripped ${removed} AppleDouble/.DS_Store entries`)

// After the AppleDouble sweep: those sidecar files live in assets/ too, and
// precaching them would put 404s in the manifest.
await stampServiceWorker()

const { count, oversize, largest } = await checkLimits(DIST)
console.log(`  ${count} static files (limit ${MAX_ASSET_FILES})`)

if (count > MAX_ASSET_FILES) {
  warn(`${count} files exceeds the free-plan limit of ${MAX_ASSET_FILES}`)
}

let fatal = 0

if (oversize.length) {
  for (const f of oversize) {
    console.error(
      `  FATAL ${f.full} is ${(f.size / 1048576).toFixed(1)} MiB, over the 25 MiB static asset limit`
    )
  }
  console.error(
    "  Cloudflare rejects the deploy outright at this size. Either shrink the file\n" +
      "  or serve it off static assets — for the ONNX runtime, set VITE_ORT_WASM_BASE_URL\n" +
      "  (see ortWasmPaths() in src/lib/weights.ts)."
  )
  fatal += oversize.length
}

// Report the largest asset and its margin. Nothing should come near the cap now
// that onnxruntime-web's runtime is loaded off-origin (see resolve.conditions in
// vite.config.ts) — if something does, that is worth noticing before it grows
// into a rejected deploy.
if (largest) {
  const pct = ((largest.size / MAX_ASSET_BYTES) * 100).toFixed(0)
  const line = `  largest asset: ${largest.full} — ${(largest.size / 1048576).toFixed(2)} MiB (${pct}% of the 25 MiB cap)`
  if (largest.size > MAX_ASSET_BYTES * 0.75) warn(line.trim() + " — little headroom left")
  else console.log(line)
}

if (fatal) {
  console.error(`postbuild-cf: ${fatal} fatal issue(s) — failing the build`)
  process.exit(1)
}

console.log(warnings ? `postbuild-cf: ${warnings} warning(s)` : "postbuild-cf: ok")
