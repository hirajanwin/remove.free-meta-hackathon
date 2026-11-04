// SAM 3.1 video tracking (BYOK).
//
// One concept prompt tracks every match through a clip with stable object
// ids. The clip is uploaded once through the Files API (MP4/MOV only — SAM
// rejects WebM), streamed back frame by frame, and decoded with the
// official parser. Masks are returned per frame per object so the UI can
// toggle tracked objects independently.

import {
  buildObjectPrompt,
  parseVideoStream,
  recordsOfKind,
  decodeMaskToRaster,
  frameIndexOf,
} from "@meta-sam/parser"
import { composeSamMasks, sseEvents } from "./meta"

const API_BASE = "https://api.meta.ai/v1"

export interface TrackedObject {
  objectId: string
  mask: Uint8Array
  confidence?: number
}

export interface TrackedFrame {
  frame: number
  objects: TrackedObject[]
  /** Union of all objects on this frame, 0/255. */
  union: Uint8Array
}

export interface TrackResult {
  width: number
  height: number
  frames: TrackedFrame[]
  objectIds: string[]
}

async function uploadVideo(file: File, key: string): Promise<string> {
  const form = new FormData()
  form.append("purpose", "user_data")
  form.append("file", file)
  const res = await fetch(`${API_BASE}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.trim()}` },
    body: form,
  })
  if (!res.ok) {
    let message = `Upload failed (HTTP ${res.status}).`
    try {
      const body: any = await res.json()
      if (body?.error?.message) message = body.error.message
    } catch {
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }
  const body: any = await res.json()
  if (!body?.id) throw new Error("Upload returned no file id.")
  return String(body.id)
}

/** Group decoded records into per-frame, per-object masks. Pure; tested via fixtures. */
export function groupTrackedFrames(
  masks: Array<{
    objectId: string
    frame: number
    raster: Uint8Array
    width: number
    height: number
    left: number
    top: number
    confidence?: number
  }>,
  frameWidth: number,
  frameHeight: number
): TrackResult {
  const byFrame = new Map<number, typeof masks>()
  for (const m of masks) {
    const list = byFrame.get(m.frame) ?? []
    list.push(m)
    byFrame.set(m.frame, list)
  }

  const frames: TrackedFrame[] = [...byFrame.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frame, list]) => {
      const objects: TrackedObject[] = list.map((m) => ({
        objectId: m.objectId,
        mask: composeSamMasks(
          [{ raster: m.raster, width: m.width, height: m.height, left: m.left, top: m.top }],
          frameWidth,
          frameHeight
        ),
        confidence: m.confidence,
      }))
      const union = new Uint8Array(frameWidth * frameHeight)
      for (const o of objects) {
        for (let i = 0; i < union.length; i++) if (o.mask[i]) union[i] = 255
      }
      return { frame, objects, union }
    })

  const objectIds = [...new Set(masks.map((m) => m.objectId))]
  return { width: frameWidth, height: frameHeight, frames, objectIds }
}

/** Union of the objects that are not hidden, for one tracked frame. */
export function visibleUnion(frame: TrackedFrame, hidden: Set<string>): Uint8Array {
  const visible = frame.objects.filter((o) => !hidden.has(o.objectId))
  if (visible.length === frame.objects.length) return frame.union
  const out = new Uint8Array(frame.union.length)
  for (const o of visible) {
    for (let i = 0; i < out.length; i++) if (o.mask[i]) out[i] = 255
  }
  return out
}

/**
 * Nearest tracked frame for a playback time.
 *
 * SAM frame indices are source-frame numbers, and the source frame rate is
 * not reported, so position is proportional: halfway through the clip maps
 * to halfway through the tracked frame range.
 */
export function nearestTrackedFrame(
  tracked: TrackResult,
  time: number,
  duration: number
): TrackedFrame | null {
  if (!tracked.frames.length) return null
  const maxFrame = tracked.frames[tracked.frames.length - 1].frame
  const target = Math.round((time / Math.max(0.05, duration)) * maxFrame)
  let best = tracked.frames[0]
  for (const f of tracked.frames) {
    if (Math.abs(f.frame - target) < Math.abs(best.frame - target)) best = f
  }
  return best
}

/**
 * Click-to-track: one point on frame 0 becomes a SAM object prompt, and
 * SAM follows that object through the clip (its id comes back as "1").
 * The click is the video equivalent of the studio's click-to-select.
 */
export async function trackPointInVideo(
  file: File,
  point: { x: number; y: number },
  key: string,
  frameWidth: number,
  frameHeight: number,
  onUploaded?: () => void
): Promise<TrackResult> {
  if (!/\.(mp4|mov)$/i.test(file.name) && !/mp4|quicktime/.test(file.type)) {
    throw new Error("SAM 3.1 video needs an MP4 or MOV file — WebM is not accepted.")
  }

  const fileId = await uploadVideo(file, key)
  onUploaded?.()

  const text = buildObjectPrompt({
    size: { width: frameWidth, height: frameHeight },
    objects: [
      {
        id: 1,
        prompts: [
          {
            frame: 0,
            points: [
              {
                x: Math.min(frameWidth - 1, Math.max(0, Math.round(point.x))),
                y: Math.min(frameHeight - 1, Math.max(0, Math.round(point.y))),
              },
            ],
          },
        ],
      },
    ],
  })

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
            { type: "input_text", text },
            { type: "input_video", file_id: fileId },
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
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }

  const result = await parseVideoStream(sseEvents(res.body)).finalResult
  if (result.outcome.status !== "completed") {
    throw new Error("SAM 3.1 stream ended before completing.")
  }

  const masks = recordsOfKind(result.records, "mask").map((m) => ({
    objectId: m.objectId,
    frame: frameIndexOf(m) ?? 0,
    raster: decodeMaskToRaster(m.mask),
    width: m.mask.width,
    height: m.mask.height,
    left: m.bounds.left,
    top: m.bounds.top,
    confidence: m.confidence,
  }))

  return groupTrackedFrames(masks, frameWidth, frameHeight)
}

export async function trackConceptInVideo(
  file: File,
  prompt: string,
  key: string,
  frameWidth: number,
  frameHeight: number,
  onUploaded?: () => void
): Promise<TrackResult> {
  if (!/\.(mp4|mov)$/i.test(file.name) && !/mp4|quicktime/.test(file.type)) {
    throw new Error("SAM 3.1 video needs an MP4 or MOV file — WebM is not accepted.")
  }

  const fileId = await uploadVideo(file, key)
  onUploaded?.()

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
            { type: "input_video", file_id: fileId },
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
      // keep status message
    }
    if (res.status === 401) message = "Meta rejected that key (401)."
    throw new Error(message)
  }

  const result = await parseVideoStream(sseEvents(res.body)).finalResult
  if (result.outcome.status !== "completed") {
    throw new Error("SAM 3.1 stream ended before completing.")
  }

  const masks = recordsOfKind(result.records, "mask").map((m) => ({
    objectId: m.objectId,
    frame: frameIndexOf(m) ?? 0,
    raster: decodeMaskToRaster(m.mask),
    width: m.mask.width,
    height: m.mask.height,
    left: m.bounds.left,
    top: m.bounds.top,
    confidence: m.confidence,
  }))

  return groupTrackedFrames(masks, frameWidth, frameHeight)
}
