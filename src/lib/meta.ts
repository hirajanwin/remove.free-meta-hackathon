// Meta Model API, bring-your-own-key.
//
// The app has no server, so a hosted key would either be public or require a
// proxy that sees every image — both contradict the product. Instead the
// user's own Meta key lives in their browser and calls go straight from the
// browser to api.meta.ai (which serves CORS `*`, verified 2026-11-01). We
// never see, log, or transmit the key anywhere else.
//
// Key storage policy:
//   - sessionStorage by default (dies with the tab)
//   - localStorage only when the user explicitly opts in ("remember")
//   - never IndexedDB, never the URL, never console output

import {
  parseImageStream,
  recordsOfKind,
  decodeMaskToRaster,
  type ResponsesEvent,
} from "@meta-sam/parser"

/** Distinct hues per SAM object, so layers read as layers everywhere they appear. */
export const LAYER_COLORS = [
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#f87171",
  "#22d3ee",
  "#a3e635",
]

const SESSION_KEY = "remove-free:meta-key"
const PERSIST_KEY = "remove-free:meta-key-persist"
const API_BASE = "https://api.meta.ai/v1"

export function getMetaKey(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(PERSIST_KEY)
  } catch {
    return null
  }
}

export function setMetaKey(key: string, remember: boolean) {
  const trimmed = key.trim()
  try {
    if (remember) {
      localStorage.setItem(PERSIST_KEY, trimmed)
      sessionStorage.removeItem(SESSION_KEY)
    } else {
      sessionStorage.setItem(SESSION_KEY, trimmed)
      localStorage.removeItem(PERSIST_KEY)
    }
  } catch {
    // Storage blocked: the key still works if the caller holds it in memory.
  }
}

export function clearMetaKey() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(PERSIST_KEY)
  } catch {
    // nothing to clear
  }
}

export function metaKeyRemembered(): boolean {
  try {
    return Boolean(localStorage.getItem(PERSIST_KEY))
  } catch {
    return false
  }
}

/** Short, non-sensitive key identifier for UI ("…a1b2"), never the key itself. */
export function keyFingerprint(key: string): string {
  return key.length > 4 ? `…${key.slice(-4)}` : "…"
}

export interface MetaValidation {
  ok: boolean
  /** Model ids the key can reach, when the listing succeeded. */
  models: string[]
  error?: string
}

export async function validateMetaKey(key: string): Promise<MetaValidation> {
  try {
    const res = await fetch(`${API_BASE}/models`, {
      headers: { Authorization: `Bearer ${key.trim()}` },
    })
    if (res.status === 401) {
      return { ok: false, models: [], error: "Meta rejected that key (401)." }
    }
    if (!res.ok) {
      return { ok: false, models: [], error: `Meta API returned HTTP ${res.status}.` }
    }
    const body: any = await res.json().catch(() => null)
    const models: string[] = Array.isArray(body?.data)
      ? body.data.map((m: any) => String(m?.id ?? "")).filter(Boolean)
      : []
    return { ok: true, models }
  } catch (err: any) {
    return { ok: false, models: [], error: err?.message || "Could not reach api.meta.ai." }
  }
}

// ─── SAM 3.1 ───

export interface Sam31Object {
  objectId: string
  box: { x1: number; y1: number; x2: number; y2: number }
  confidence?: number
}

export interface Sam31Result {
  /** Union of all matched masks, 0/255 per pixel, at `width`×`height` (the sent size). */
  mask: Uint8Array
  width: number
  height: number
  objects: Sam31Object[]
  /** Each object's own full-frame mask, so the UI can offer them as layers. */
  parts: Array<{ object: Sam31Object; mask: Uint8Array }>
}

/**
 * Place decoded mask rasters into one full-frame mask.
 *
 * Each SAM record's raster covers only its box, so it is stamped at the box
 * origin. Pure and exported for tests.
 */
export function composeSamMasks(
  parts: Array<{
    raster: Uint8Array
    width: number
    height: number
    left: number
    top: number
  }>,
  frameWidth: number,
  frameHeight: number
): Uint8Array {
  const out = new Uint8Array(frameWidth * frameHeight)
  for (const part of parts) {
    for (let y = 0; y < part.height; y++) {
      const fy = part.top + y
      if (fy < 0 || fy >= frameHeight) continue
      const srcRow = y * part.width
      const dstRow = fy * frameWidth
      for (let x = 0; x < part.width; x++) {
        const fx = part.left + x
        if (fx < 0 || fx >= frameWidth) continue
        if (part.raster[srcRow + x]) out[dstRow + fx] = 255
      }
    }
  }
  return out
}

/** Downscale a canvas for sending: SAM coordinates are in the sent size. */
export function downscaleCanvas(
  source: HTMLCanvasElement,
  maxEdge = 1024
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
  const width = Math.max(1, Math.round(source.width * scale))
  const height = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height)
  return { canvas, width, height }
}

export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<ResponsesEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let split: number
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue
        const data = line.slice(5).trim()
        if (!data || data === "[DONE]") continue
        try {
          yield JSON.parse(data) as ResponsesEvent
        } catch {
          // Non-JSON keepalive lines are not events.
        }
      }
    }
  }
}

/**
 * Segment a concept ("red hat", "the dog") in a canvas with SAM 3.1.
 *
 * Sends a downscaled JPEG copy — the original never leaves at full size —
 * and returns masks at the sent resolution; callers scale as needed.
 */
export async function segmentConcept(
  source: HTMLCanvasElement,
  prompt: string,
  key: string
): Promise<Sam31Result> {
  const { canvas, width, height } = downscaleCanvas(source, 1024)
  const imageUrl = canvas.toDataURL("image/jpeg", 0.9)

  const res = await fetch(`${API_BASE}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key.trim()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sam-3.1",
      stream: true,
      metadata: { mask_encoding: "one_bit", include_confidence: "true" },
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    }),
  })

  if (!res.ok || !res.body) {
    let message = `SAM 3.1 returned HTTP ${res.status}.`
    try {
      const body: any = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep the status-based message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }

  const result = await parseImageStream(sseEvents(res.body)).finalResult
  if (result.outcome.status !== "completed") {
    throw new Error("SAM 3.1 stream ended before completing.")
  }

  const boxes = recordsOfKind(result.records, "box")
  const masks = recordsOfKind(result.records, "mask")
  const boxById = new Map(boxes.map((b) => [b.objectId, b]))

  const parts = masks.map((m) => ({
    raster: decodeMaskToRaster(m.mask),
    width: m.mask.width,
    height: m.mask.height,
    left: m.bounds.left,
    top: m.bounds.top,
  }))

  const objects: Sam31Object[] = masks.map((m) => {
    const b = boxById.get(m.objectId)
    return {
      objectId: m.objectId,
      box: b
        ? { x1: b.left, y1: b.top, x2: b.right, y2: b.bottom }
        : { x1: m.bounds.left, y1: m.bounds.top, x2: m.bounds.right, y2: m.bounds.bottom },
      confidence: m.confidence,
    }
  })

  const partMasks = masks.map((m, i) => ({
    object: objects[i],
    mask: composeSamMasks([parts[i]], width, height),
  }))

  return { mask: composeSamMasks(parts, width, height), width, height, objects, parts: partMasks }
}
