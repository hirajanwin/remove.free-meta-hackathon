// Getting a recipe to somebody else.
//
// Two routes, and they are deliberately different shapes. A **file** is the
// archival form: a `.remove` on disk, droppable, diffable in a PR, checkable
// into a repo. A **link** is the casual form: paste it in a message and the
// person who opens it lands in their own studio with your treatment loaded and
// editable — a fork, not a read-only view.
//
// Neither involves a server, because there is nothing here that needs one. The
// whole recipe travels inside the URL fragment, which by specification is never
// sent to the origin — so even the static host this app is served from cannot
// see what you shared. That is not a promise about our conduct; it is a
// property of the transport.

import {
  FILE_EXTENSION,
  FILE_MIME,
  parseRecipe,
  toJSON,
  type Recipe,
} from "./schema"

/** The fragment key. Short, because every character is in the link. */
const PARAM = "r"

/**
 * URL-safe base64 of the UTF-8 JSON.
 *
 * Not `encodeURIComponent(JSON)`: a recipe is mostly braces, quotes and colons,
 * every one of which percent-encodes to three characters. Base64url is 4/3 of
 * the bytes with no expansion for punctuation, which on a real recipe is about
 * a third the length.
 */
function encode(json: string): string {
  const bytes = new TextEncoder().encode(json)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function decode(packed: string): string {
  const base64 = packed.replace(/-/g, "+").replace(/_/g, "/")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/**
 * A link carrying the whole recipe.
 *
 * In the **fragment**, not the query. A fragment is not sent to the server on
 * navigation, is not written to access logs, and is not forwarded in a
 * `Referer` header — which is the difference between a private share and one
 * that is private by policy.
 */
export function toShareLink(recipe: Recipe, origin?: string): string {
  const packed = encode(JSON.stringify(toJSON(recipe)))
  const base = origin ?? (typeof location !== "undefined" ? location.origin : "")
  return `${base}/#${PARAM}=${packed}`
}

/**
 * Read a recipe out of a URL, or null if there is not one there.
 *
 * Tolerant of both `#r=…` and `#/path?r=…`, because a hash router will have
 * been through it. Returns null rather than throwing on anything malformed:
 * a corrupted link should land you in an empty studio, not an error page.
 */
export function fromShareLink(href: string): Recipe | null {
  let hash: string
  try {
    hash = new URL(href).hash
  } catch {
    return null
  }
  if (!hash) return null

  const body = hash.replace(/^#/, "")
  const query = body.includes("?") ? body.slice(body.indexOf("?") + 1) : body
  const packed = new URLSearchParams(query).get(PARAM)
  if (!packed) return null

  try {
    const parsed = parseRecipe(JSON.parse(decode(packed)))
    return parsed.ok ? parsed.recipe : null
  } catch {
    return null
  }
}

/** Strip the recipe out of the address bar without reloading or adding history. */
export function clearShareLink() {
  if (typeof history === "undefined" || typeof location === "undefined") return
  if (!location.hash.includes(`${PARAM}=`)) return
  history.replaceState(null, "", location.pathname + location.search)
}

// ── Files ────────────────────────────────────────────────

export function toFile(recipe: Recipe): Blob {
  // Pretty-printed on purpose. A `.remove` is meant to be read, diffed in a
  // pull request and hand-edited; saving a few hundred bytes is worth less than
  // any of those.
  return new Blob([`${JSON.stringify(toJSON(recipe), null, 2)}\n`], { type: FILE_MIME })
}

export function fileNameFor(recipe: Recipe): string {
  const slug =
    recipe.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "recipe"
  return `${slug}${FILE_EXTENSION}`
}

export function download(recipe: Recipe) {
  const url = URL.createObjectURL(toFile(recipe))
  const a = document.createElement("a")
  a.href = url
  a.download = fileNameFor(recipe)
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Is this a recipe file?
 *
 * By extension, not by MIME type: a browser reports `application/json` or
 * nothing at all for an unfamiliar extension, and files arriving from a chat
 * app routinely lose their type entirely.
 */
export function isRecipeFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(FILE_EXTENSION)
}

export async function readRecipeFile(
  file: File
): Promise<{ ok: true; recipe: Recipe; warnings: string[] } | { ok: false; error: string }> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, error: "Could not read that file" }
  }
  try {
    return parseRecipe(JSON.parse(text))
  } catch {
    return { ok: false, error: `${file.name} is not valid JSON` }
  }
}
