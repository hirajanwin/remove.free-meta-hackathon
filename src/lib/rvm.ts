// Main-thread API for RobustVideoMatting.
//
// Deliberately separate from the matting worker: RVM is stateful across frames,
// so it owns its own worker and its own lifecycle. Resetting between clips (and
// after a seek) is part of the contract rather than an optimisation — see
// resetTemporalState.

export type RvmStatus =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

type StatusListener = (s: RvmStatus) => void

let worker: Worker | null = null
const listeners = new Set<StatusListener>()
const jobs = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()
let lastInferMs = 0

function emit(s: RvmStatus) {
  listeners.forEach((cb) => cb(s))
}

function getWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL("../workers/rvm.worker.ts", import.meta.url), {
    type: "module",
  })

  worker.onmessage = (e: MessageEvent) => {
    const d = e.data
    switch (d.type) {
      case "rvm-loading":
        emit({ kind: "loading" })
        break
      case "rvm-ready":
        emit({ kind: "ready" })
        break
      case "rvm-reset-done": {
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve(true)
        }
        break
      }
      case "rvm-alpha": {
        lastInferMs = d.inferMs
        const job = jobs.get(d.id)
        if (job) {
          jobs.delete(d.id)
          job.resolve({
            alpha: new Uint8Array(d.maskData),
            width: d.width,
            height: d.height,
            inferMs: d.inferMs,
          })
        }
        break
      }
      case "rvm-error": {
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
    const message = err.message || "Video matting worker crashed"
    emit({ kind: "error", message })
    for (const [, job] of jobs) job.reject(new Error(message))
    jobs.clear()
  }

  return worker
}

export function addRvmStatusListener(cb: StatusListener) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function warmRvm() {
  getWorker().postMessage({ action: "rvm-init" })
}

export function getLastRvmInferMs() {
  return lastInferMs
}

function newJob<T>(): { id: string; promise: Promise<T> } {
  const id = "rvm_" + Math.random().toString(36).substring(2, 9)
  const promise = new Promise<T>((resolve, reject) => {
    jobs.set(id, { resolve, reject })
  })
  return { id, promise }
}

/** Test hook: pin the execution provider and rebuild the session. */
export function forceProvider(provider: "webgpu" | "wasm" | null): Promise<boolean> {
  const { id, promise } = newJob<boolean>()
  getWorker().postMessage({ action: "rvm-force-provider", id, provider })
  return promise
}

/**
 * Clear the recurrent memory.
 *
 * Must be called before each clip. Carrying hidden state across a cut makes the
 * model blend two unrelated scenes for several frames.
 */
export function resetTemporalState(): Promise<boolean> {
  const { id, promise } = newJob<boolean>()
  getWorker().postMessage({ action: "rvm-reset", id })
  return promise
}

export interface RvmFrameResult {
  alpha: Uint8Array
  width: number
  height: number
  inferMs: number
}

/**
 * Matte one frame, advancing the recurrent state.
 *
 * Frames must be submitted in order: the result depends on everything that came
 * before. `pixels` is transferred, so do not reuse the buffer.
 */
export function matteFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  downsampleRatio = 0.4
): Promise<RvmFrameResult> {
  const { id, promise } = newJob<RvmFrameResult>()
  const buffer = pixels.buffer as ArrayBuffer
  getWorker().postMessage(
    { action: "rvm-frame", id, frame: buffer, width, height, downsampleRatio },
    [buffer]
  )
  return promise
}
