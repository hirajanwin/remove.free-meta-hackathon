// Main-thread API for DINOv2 "select similar".
//
// Mirrors src/lib/sam.ts: encode once per image, then each click is cheap.
// The result is seeds plus a coarse grid mask — never a finished selection.

import type { SeedPoint } from "./similarity"

export type DinoStatus =
  | { kind: "idle" }
  | { kind: "loading"; percent: number }
  | { kind: "ready" }
  | { kind: "encoding" }
  | { kind: "error"; message: string }

type StatusListener = (s: DinoStatus) => void

let worker: Worker | null = null
const statusListeners = new Set<StatusListener>()
let encoded = false

interface Job {
  resolve: (value: any) => void
  reject: (err: Error) => void
}
const jobs = new Map<string, Job>()

function emit(status: DinoStatus) {
  statusListeners.forEach((cb) => cb(status))
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL("../workers/dino.worker.ts", import.meta.url), {
    type: "module",
  })

  worker.onmessage = (e: MessageEvent) => {
    const d = e.data
    switch (d.type) {
      case "dino-loading":
        emit({ kind: "loading", percent: 0 })
        break
      case "dino-progress":
        emit({ kind: "loading", percent: Math.round(d.progress || 0) })
        break
      case "dino-ready":
        emit({ kind: "ready" })
        break
      case "dino-encoded": {
        encoded = true
        emit({ kind: "ready" })
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve(true)
        }
        break
      }
      case "dino-similar-result": {
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve({
            mask: new Uint8Array(d.maskData),
            width: d.width,
            height: d.height,
            seeds: d.seeds as SeedPoint[],
            ms: d.ms,
          })
        }
        break
      }
      case "dino-error": {
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
    const message = err.message || "Similarity worker crashed"
    emit({ kind: "error", message })
    for (const [, job] of jobs) job.reject(new Error(message))
    jobs.clear()
  }

  return worker
}

export function addDinoStatusListener(cb: StatusListener) {
  statusListeners.add(cb)
  return () => {
    statusListeners.delete(cb)
  }
}

/** Start downloading the model without waiting for a click. */
export function warmDino() {
  getWorker().postMessage({ action: "dino-init" })
}

export function forgetDinoImage() {
  encoded = false
}

function newJob<T>(): { id: string; promise: Promise<T> } {
  const id = "dino_" + Math.random().toString(36).substring(2, 9)
  const promise = new Promise<T>((resolve, reject) => {
    jobs.set(id, { resolve, reject })
  })
  return { id, promise }
}

export function encodeDinoImage(canvas: HTMLCanvasElement): Promise<boolean> {
  if (encoded) return Promise.resolve(true)
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return Promise.reject(new Error("Canvas has no 2D context"))

  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  const buffer = data.buffer as ArrayBuffer

  emit({ kind: "encoding" })
  const { id, promise } = newJob<boolean>()
  getWorker().postMessage(
    { action: "dino-encode", id, frame: { data: buffer, width, height } },
    [buffer]
  )
  return promise
}

export interface SimilarResult {
  /** Coarse patch-grid mask, 0/255. A proposal aid, never a matte. */
  mask: Uint8Array
  width: number
  height: number
  seeds: SeedPoint[]
  ms: number
}

export function similarAt(x: number, y: number, threshold: number): Promise<SimilarResult> {
  if (!encoded) {
    return Promise.reject(new Error("Encode an image before finding similar regions"))
  }
  const { id, promise } = newJob<SimilarResult>()
  getWorker().postMessage({ action: "dino-similar", id, x, y, threshold })
  return promise
}
