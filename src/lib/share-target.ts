// Receiving images from outside the browser tab.
//
// Two OS-level entry points, both of which turn an installed remove.free from a
// bookmark into something the system treats as an image tool:
//
//   Share target  — "Share → remove.free" from any Android app. The photo is
//                   POSTed to /share-target, which only the service worker can
//                   read; it parks the file in a cache and redirects here.
//   File handler  — "Open with → remove.free" for PNG/JPEG/WebP on desktop,
//                   delivered through launchQueue.
//
// Both matter more here than they would for a hosted tool. The pitch is that
// the photo never leaves the device, and a share sheet is the one place where a
// user hands over an image without thinking about where it goes.

/** Must match SHARE_CACHE / SHARE_URL in public/sw.js. */
const SHARE_CACHE = "remove-free-share"
const SHARE_URL = "/__shared-image"

/**
 * Collect a photo left by the service worker, if there is one.
 *
 * Read straight from Cache Storage rather than with fetch(): the entry is not a
 * real route, so a fetch would be intercepted by the worker's same-origin
 * handler and fall through to a 404 on the network.
 *
 * The entry is deleted whether or not the caller succeeds — it is a one-shot
 * handoff, and a stale photo reappearing on the next launch would be worse than
 * losing this one.
 */
export async function takeSharedImage(): Promise<File | null> {
  if (typeof caches === "undefined") return null

  try {
    const cache = await caches.open(SHARE_CACHE)
    const res = await cache.match(SHARE_URL)
    if (!res) return null

    await cache.delete(SHARE_URL)

    const blob = await res.blob()
    if (!blob.size) return null

    const raw = res.headers.get("x-filename")
    let name = "shared-image"
    try {
      if (raw) name = decodeURIComponent(raw)
    } catch {
      // A filename we cannot decode is not worth losing the image over.
    }
    return new File([blob], name, { type: blob.type || "image/png" })
  } catch {
    return null
  }
}

/**
 * Subscribe to files opened with the app from the OS file manager.
 *
 * Returns a cleanup that detaches the consumer. launchQueue exists only in
 * installed PWAs on Chromium desktop, so absence is the normal case.
 */
export function onLaunchWithFiles(handle: (file: File) => void): () => void {
  const queue = (window as any).launchQueue
  if (!queue?.setConsumer) return () => {}

  let live = true
  queue.setConsumer(async (params: any) => {
    if (!live || !params?.files?.length) return
    for (const handleRef of params.files) {
      try {
        const file = await handleRef.getFile()
        if (file) handle(file)
        // One image at a time: the studio edits a single cutout, and silently
        // dropping all but the first is clearer than half-opening several.
        break
      } catch {
        // A handle we cannot read is not actionable; leave the studio empty.
      }
    }
  })

  return () => {
    live = false
  }
}
