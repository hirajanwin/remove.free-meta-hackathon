// Main-thread API for Grounding DINO offline text detection.
// Mirrors src/lib/dino.ts: a worker, a status stream, and one call.

export type GroundingStatus =
  | { kind: "idle" }
  | { kind: "loading"; percent: number }
  | { kind: "ready" }
  | { kind: "detecting" }
  | { kind: "error"; message: string }

export interface GroundingBox {
  label: string
  score: number
  box: { xmin: number; ymin: number; xmax: number; ymax: number }
}

type StatusListener = (s: GroundingStatus) => void

let worker: Worker | null = null
const statusListeners = new Set<StatusListener>()
const jobs = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function emit(status: GroundingStatus) {
  statusListeners.forEach((cb) => cb(status))
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL("../workers/grounding.worker.ts", import.meta.url), {
    type: "module",
  })

  worker.onmessage = (e: MessageEvent) => {
    const d = e.data
    switch (d.type) {
      case "grounding-loading":
        emit({ kind: "loading", percent: 0 })
        break
      case "grounding-progress":
        emit({ kind: "loading", percent: Math.round(d.progress || 0) })
        break
      case "grounding-ready":
        emit({ kind: "ready" })
        break
      case "grounding-boxes": {
        emit({ kind: "ready" })
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve({ boxes: d.boxes as GroundingBox[], ms: d.ms })
        }
        break
      }
      case "grounding-error": {
        emit({ kind: "error", message: d.error })
        const job = d.id ? jobs.get(d.id) : null
        if (job) {
          jobs.delete(d.id)
          job.reject(new Error(d.error))
        }
        break
      }
    }
  }

  worker.onerror = (err) => {
    const message = err.message || "Grounding worker crashed"
    emit({ kind: "error", message })
    for (const [, job] of jobs) job.reject(new Error(message))
    jobs.clear()
  }

  return worker
}

export function addGroundingStatusListener(cb: StatusListener) {
  statusListeners.add(cb)
  return () => {
    statusListeners.delete(cb)
  }
}

/** Download the 151 MiB model without detecting anything yet. */
export function warmGrounding() {
  getWorker().postMessage({ action: "grounding-init" })
}

export function detectObjects(
  canvas: HTMLCanvasElement,
  prompt: string
): Promise<{ boxes: GroundingBox[]; ms: number }> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return Promise.reject(new Error("Canvas has no 2D context"))

  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  const buffer = data.buffer as ArrayBuffer

  emit({ kind: "detecting" })
  const id = "gd_" + Math.random().toString(36).substring(2, 9)
  const promise = new Promise<{ boxes: GroundingBox[]; ms: number }>((resolve, reject) => {
    jobs.set(id, { resolve, reject })
  })
  getWorker().postMessage(
    { action: "grounding-detect", id, prompt, frame: { data: buffer, width, height } },
    [buffer]
  )
  return promise
}

function iou(a: GroundingBox["box"], b: GroundingBox["box"]): number {
  const x1 = Math.max(a.xmin, b.xmin)
  const y1 = Math.max(a.ymin, b.ymin)
  const x2 = Math.min(a.xmax, b.xmax)
  const y2 = Math.min(a.ymax, b.ymax)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const areaA = Math.max(0, a.xmax - a.xmin) * Math.max(0, a.ymax - a.ymin)
  const areaB = Math.max(0, b.xmax - b.xmin) * Math.max(0, b.ymax - b.ymin)
  return inter / Math.max(1, areaA + areaB - inter)
}

/**
 * Grounding DINO's pipeline returns hundreds of raw candidates (900
 * measured). Keep the confident few: score threshold, then NMS so the
 * same object found at three scales becomes one seed.
 */
export function filterBoxes(
  boxes: GroundingBox[],
  minScore = 0.3,
  maxBoxes = 8
): GroundingBox[] {
  const sorted = boxes
    .filter((b) => b.score >= minScore)
    .sort((a, b) => b.score - a.score)
  const kept: GroundingBox[] = []
  for (const box of sorted) {
    if (kept.some((k) => iou(k.box, box.box) > 0.5)) continue
    kept.push(box)
    if (kept.length >= maxBoxes) break
  }
  return kept
}

/** Box centre, the seed point SlimSAM consumes. */
export function boxCentre(box: GroundingBox): { x: number; y: number } {
  return {
    x: (box.box.xmin + box.box.xmax) / 2,
    y: (box.box.ymin + box.box.ymax) / 2,
  }
}
