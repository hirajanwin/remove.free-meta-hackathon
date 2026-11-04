// Service worker: makes the app installable and usable with no network.
//
// This app is unusually well suited to working offline. It is a 1.8 MiB static
// bundle with no server component, and the model weights are already persisted
// by transformers.js in Cache Storage after the first run. So the only thing
// missing for a genuinely offline background remover was the app shell.
//
// SELF_VERSION and PRECACHE are rewritten by scripts/postbuild-cf.mjs at build
// time, because the asset filenames are content-hashed and change per build.

const SELF_VERSION = "dev"
const PRECACHE = ["/", "/index.html"]

const SHELL_CACHE = `remove-free-shell-${SELF_VERSION}`
const RUNTIME_CACHE = `remove-free-runtime-${SELF_VERSION}`

/**
 * Hand-off buffer for the OS share sheet.
 *
 * Deliberately unversioned: a share can arrive while a new worker is
 * installing, and losing the user's photo to a cache-name change would be
 * unforgivable for a one-shot handoff.
 */
const SHARE_CACHE = "remove-free-share"
const SHARE_URL = "/__shared-image"

/**
 * Hosts whose responses we cache ourselves.
 *
 * huggingface.co is deliberately absent. transformers.js already stores model
 * weights in its own Cache Storage bucket, so intercepting them here would
 * duplicate hundreds of megabytes, and those requests use ranges that a naive
 * cache-first handler would answer incorrectly. Leaving them to pass straight
 * through keeps one owner for that data.
 */
const RUNTIME_HOSTS = ["cdn.jsdelivr.net"]

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // Individually, so one 404 cannot fail the whole install.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => {})
        )
      )
      await self.skipWaiting()
    })()
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, RUNTIME_CACHE, SHARE_CACHE])
      for (const name of await caches.keys()) {
        // Only touch our own caches — transformers.js owns the weight cache.
        if (name.startsWith("remove-free-") && !keep.has(name)) {
          await caches.delete(name)
        }
      }
      await self.clients.claim()
    })()
  )
})

/**
 * `ignoreVary` is essential, not a tweak.
 *
 * Precached entries are stored from our own `cache.add()` requests, whose
 * headers (Accept-Encoding in particular) differ from the ones the browser
 * sends for a module script or stylesheet. With Vary honoured, every one of
 * those lookups misses offline — the shell loads, no chunk does, and the app
 * renders a blank page with no console error to explain it. Verified in real
 * Chrome: match(request) false, match(request, {ignoreVary:true}) true.
 */
const MATCH_OPTS = { ignoreVary: true }

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request, MATCH_OPTS)
  if (hit) return hit

  const response = await fetch(request)
  // Opaque (no-cors) responses have status 0 and cannot be validated, so they
  // are not worth storing — a failed fetch would be cached as a success.
  if (response.ok) cache.put(request, response.clone())
  return response
}

async function networkFirstShell(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put("/index.html", response.clone())
    return response
  } catch {
    // Offline: every client route resolves to the shell, exactly as the
    // _redirects SPA fallback does when the network is up.
    const cached =
      (await cache.match("/index.html", MATCH_OPTS)) ||
      (await cache.match("/", MATCH_OPTS))
    if (cached) return cached
    throw new Error("offline and no cached shell")
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)

  /**
   * Web Share Target. Android posts the shared file here as multipart form
   * data, which only a service worker can read — there is no server to receive
   * it, and that is the point: a shared photo reaches the editor without ever
   * leaving the device.
   *
   * The file is parked in a cache and the browser is redirected to the studio,
   * because a POST response cannot itself become the app's location.
   */
  if (request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        try {
          const form = await request.formData()
          const file = form.get("image")
          if (file && file.size) {
            const cache = await caches.open(SHARE_CACHE)
            await cache.put(
              SHARE_URL,
              new Response(file, {
                headers: {
                  "content-type": file.type || "application/octet-stream",
                  "x-filename": encodeURIComponent(file.name || "shared-image"),
                },
              })
            )
          }
        } catch {
          // A share we cannot parse still has to land somewhere usable, so fall
          // through to the studio rather than showing the user an error page.
        }
        return Response.redirect(new URL("/?shared=1", self.location.origin).href, 303)
      })()
    )
    return
  }

  if (request.method !== "GET") return

  // Navigations: serve the shell so deep links work offline.
  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request))
    return
  }

  if (url.origin === self.location.origin) {
    // Never cache the worker itself, or a bad version becomes permanent.
    if (url.pathname === "/sw.js") return

    // Content-hashed build output is immutable; everything else same-origin is
    // small and safe to serve from cache with a network fill.
    event.respondWith(cacheFirst(request, url.pathname.startsWith("/assets/") ? SHELL_CACHE : RUNTIME_CACHE))
    return
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    // The ONNX runtime wasm. Version-pinned by transformers.js, so immutable.
    event.respondWith(cacheFirst(request, RUNTIME_CACHE))
    return
  }

  // Everything else (notably huggingface.co) passes through untouched.
})
