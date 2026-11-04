// Main-thread API for depth estimation.
//
// Depth is computed once per image and cached against it, because it is the
// expensive half of depth-aware blur (hundreds of milliseconds) while the
// compositing that consumes it is cheap enough to redo on every slider tick.

export type DepthStatus =
  | { kind: "idle" }
  | { kind: "loading"; percent: number }
  | { kind: "ready" }
  | { kind: "estimating" }
  | { kind: "error"; message: string }

type StatusListener = (s: DepthStatus) => void

export interface DepthMap {
  /** One byte per pixel. Brighter is nearer — this is inverse depth. */
  data: Uint8Array
  width: number
  height: number
  /** Inference time in milliseconds, for the diagnostics panel. */
  ms: number
  /** Which backend actually ran it. */
  device?: "webgpu" | "wasm"
}

let worker: Worker | null = null
const statusListeners = new Set<StatusListener>()
const jobs = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()

function emit(status: DepthStatus) {
  statusListeners.forEach((cb) => cb(status))
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL("../workers/depth.worker.ts", import.meta.url), {
    type: "module",
  })

  worker.onmessage = (e: MessageEvent) => {
    const d = e.data
    switch (d.type) {
      case "depth-loading":
        emit({ kind: "loading", percent: 0 })
        break
      case "depth-progress":
        emit({ kind: "loading", percent: Math.round(d.progress || 0) })
        break
      case "depth-ready":
        emit({ kind: "ready" })
        break
      case "depth-map": {
        emit({ kind: "ready" })
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve({
            data: new Uint8Array(d.depthData),
            width: d.width,
            height: d.height,
            ms: d.ms,
            device: d.device,
          } satisfies DepthMap)
        }
        break
      }
      case "depth-error": {
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
    const message = err.message || "Depth worker crashed"
    emit({ kind: "error", message })
    for (const [, job] of jobs) job.reject(new Error(message))
    jobs.clear()
  }

  return worker
}

export function addDepthStatusListener(cb: StatusListener) {
  statusListeners.add(cb)
  return () => {
    statusListeners.delete(cb)
  }
}

/** Start downloading the model before anyone turns the feature on. */
export function warmDepth(modelId?: string) {
  getWorker().postMessage({ action: "depth-init", modelId })
}

/**
 * Estimate depth for one image.
 *
 * The source is downscaled first. Depth Anything resizes its input to 518x518
 * internally, so feeding it a 4000px photo costs a large `getImageData` and a
 * large transfer to buy back nothing; and the map only steers a blur radius, so
 * it is upsampled on read anyway.
 */
export function estimateDepth(
  source: HTMLCanvasElement,
  maxEdge = 640,
  modelId?: string
): Promise<DepthMap> {
  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height))
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))

  const small = document.createElement("canvas")
  small.width = w
  small.height = h
  const ctx = small.getContext("2d", { willReadFrequently: true })
  if (!ctx) return Promise.reject(new Error("Canvas has no 2D context"))
  ctx.drawImage(source, 0, 0, w, h)

  const buffer = ctx.getImageData(0, 0, w, h).data.buffer as ArrayBuffer

  emit({ kind: "estimating" })
  const id = "depth_" + Math.random().toString(36).substring(2, 9)
  const promise = new Promise<DepthMap>((resolve, reject) => {
    jobs.set(id, { resolve, reject })
  })
  getWorker().postMessage(
    {
      action: "depth-estimate",
      id,
      modelId,
      frame: { data: buffer, width: w, height: h },
    },
    [buffer]
  )
  return promise
}
