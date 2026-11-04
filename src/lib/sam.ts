// Main-thread API for click-to-select.
//
// SlimSAM's value here is the encode-once/click-many split: encoding an image
// costs a second or so, after which each click only runs the small prompt
// decoder. So `encodeImage` is called when a new cutout appears and `selectAt`
// is called per click.

export type SamStatus =
  | { kind: "idle" }
  | { kind: "loading"; percent: number }
  | { kind: "ready" }
  | { kind: "encoding" }
  | { kind: "error"; message: string }

type StatusListener = (s: SamStatus) => void

let worker: Worker | null = null
const statusListeners = new Set<StatusListener>()
let encodedSize: { width: number; height: number } | null = null

interface Job {
  resolve: (value: any) => void
  reject: (err: Error) => void
}
const jobs = new Map<string, Job>()

function emit(status: SamStatus) {
  statusListeners.forEach((cb) => cb(status))
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL("../workers/sam.worker.ts", import.meta.url), {
    type: "module",
  })

  worker.onmessage = (e: MessageEvent) => {
    const d = e.data
    switch (d.type) {
      case "sam-loading":
        emit({ kind: "loading", percent: 0 })
        break
      case "sam-progress":
        emit({ kind: "loading", percent: Math.round(d.progress || 0) })
        break
      case "sam-ready":
        emit({ kind: "ready" })
        break
      case "sam-encoded": {
        encodedSize = { width: d.width, height: d.height }
        emit({ kind: "ready" })
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve(encodedSize)
        }
        break
      }
      case "sam-mask": {
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve({
            mask: new Uint8Array(d.maskData),
            width: d.width,
            height: d.height,
            score: d.score,
            ms: d.ms,
          })
        }
        break
      }
      case "sam-error": {
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
    const message = err.message || "Selection worker crashed"
    emit({ kind: "error", message })
    for (const [, job] of jobs) job.reject(new Error(message))
    jobs.clear()
  }

  return worker
}

export function addSamStatusListener(cb: StatusListener) {
  statusListeners.add(cb)
  return () => {
    statusListeners.delete(cb)
  }
}

/** Start downloading the model without waiting for a click. */
export function warmSam() {
  getWorker().postMessage({ action: "sam-init" })
}

export function isImageEncoded() {
  return encodedSize !== null
}

export function forgetEncodedImage() {
  encodedSize = null
}

function newJob<T>(): { id: string; promise: Promise<T> } {
  const id = "sam_" + Math.random().toString(36).substring(2, 9)
  const promise = new Promise<T>((resolve, reject) => {
    jobs.set(id, { resolve, reject })
  })
  return { id, promise }
}

/**
 * Encode one image. Costs about a second; every subsequent click is cheap, so
 * this runs once when the cutout changes rather than per click.
 */
export function encodeImage(
  canvas: HTMLCanvasElement
): Promise<{ width: number; height: number }> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return Promise.reject(new Error("Canvas has no 2D context"))

  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  const buffer = data.buffer as ArrayBuffer

  emit({ kind: "encoding" })
  const { id, promise } = newJob<{ width: number; height: number }>()
  getWorker().postMessage(
    { action: "sam-encode", id, frame: { data: buffer, width, height } },
    [buffer]
  )
  return promise
}

export interface SamPoint {
  x: number
  y: number
  /** 1 includes the region, 0 excludes it. */
  label: 0 | 1
}

export interface SamSelection {
  mask: Uint8Array
  width: number
  height: number
  score: number
  ms: number
}

/** Segment whatever the given points land on. */
export function selectAt(points: SamPoint[]): Promise<SamSelection> {
  if (!encodedSize) {
    return Promise.reject(new Error("Encode an image before selecting"))
  }
  const { id, promise } = newJob<SamSelection>()
  getWorker().postMessage({ action: "sam-select", id, points })
  return promise
}
