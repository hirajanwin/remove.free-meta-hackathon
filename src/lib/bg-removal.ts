// Main thread client-side background removal engine & canvas compositor.

import {
  DEFAULT_MODEL_ID,
  MODELS,
  defaultModelFor,
  detectBackend,
  probeBackend,
  getBackendOverride,
  setBackendOverride,
  type Backend,
} from "./models"
import type { WeightsSource } from "./weights"
import { drawDepthBlur } from "./bokeh"
import type { DepthMap } from "./depth"
import type { EdgeConfig, EffectConfig } from "./recipe/schema"
import { alphaOf, effectDistanceField, renderEffect } from "./recipe/effects"

export interface ProcessProgress {
  type:
    | "init-start"
    | "download-progress"
    | "warming-up"
    | "ready"
    | "processing-start"
    | "downscaled"
    | "segment-done"
    | "segment-error"
    | "frame-done"
    | "frame-error"
    | "init-error"
  progress?: number
  file?: string
  gpu?: boolean
  backend?: Backend
  modelId?: string
  modelLabel?: string
  dtype?: string
  /** Download size of the active model/backend variant, in bytes. */
  bytes?: number
  weightsSource?: WeightsSource
  size?: string
  error?: string
  duration?: string
  loaded?: number
  total?: number
  width?: number
  height?: number
  /** Set on "downscaled": the size the image arrived at and what it was capped to. */
  from?: { width: number; height: number }
  to?: { width: number; height: number }
}

export type BgMode =
  | { type: "transparent" }
  | { type: "color"; color: string }
  | { type: "gradient"; style: "dark" | "sunset" | "ocean" | "cyberpunk" | "light" }
  /**
   * `depth` opts into a depth-aware lens simulation instead of one flat radius.
   * Optional because the map costs an extra model and a few hundred
   * milliseconds; without it this falls back to the uniform blur.
   */
  | { type: "blur"; amount: number; depth?: DepthMap; focal?: number }
  | { type: "image"; dataUrl: string }

type ProgressCallback = (p: ProcessProgress) => void

let worker: Worker | null = null
let workerReadyPromise: Promise<void> | null = null
const progressListeners = new Set<ProgressCallback>()
const pendingJobs = new Map<
  string,
  {
    resolve: (res: { maskData: Uint8Array; width: number; height: number; duration: string }) => void
    reject: (err: Error) => void
  }
>()

export function getBgRemovalWorker(): Worker {
  if (typeof window === "undefined") {
    throw new Error("Worker can only be instantiated in browser environment")
  }

  if (!worker) {
    worker = new Worker(
      new URL("../workers/birefnet.worker.ts", import.meta.url),
      { type: "module" }
    )

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data

      // Broadcast to all progress listeners
      progressListeners.forEach((cb) => cb(data))

      if (data.type === "segment-done") {
        const job = pendingJobs.get(data.id)
        if (job) {
          pendingJobs.delete(data.id)
          job.resolve({
            maskData: new Uint8Array(data.maskData),
            width: data.width,
            height: data.height,
            duration: data.duration,
          })
        }
      } else if (data.type === "frame-done") {
        clearFrameFlight()
        lastInferMs = data.inferMs
        const job = frameJobs.get(data.id)
        if (job) {
          frameJobs.delete(data.id)
          job.resolve(new Uint8Array(data.maskData))
        }
      } else if (data.type === "frame-error") {
        clearFrameFlight()
        const job = frameJobs.get(data.id)
        if (job) {
          frameJobs.delete(data.id)
          job.reject(new Error(data.error || "Frame segmentation failed"))
        }
      } else if (data.type === "segment-error") {
        const job = pendingJobs.get(data.id)
        if (job) {
          pendingJobs.delete(data.id)
          job.reject(new Error(data.error || "Segmentation failed"))
        }
      }
    }

    worker.onerror = (err) => {
      console.error("Worker error:", err)
      // A dead worker will never answer an in-flight frame, so release the latch
      // instead of leaving every subsequent frame blocked.
      resetFrameQueue("Worker crashed")
      progressListeners.forEach((cb) =>
        cb({ type: "init-error", error: err.message || "Worker crashed" })
      )
    }

    // The override has to reach the worker before init, or the first pipeline
    // is built for the wrong provider and immediately thrown away.
    const override = getBackendOverride()
    if (override) worker.postMessage({ action: "set-backend", backend: override })

    // Warming waits for the probe: the model to warm depends on the provider.
    const created = worker
    void backendReady.then(() => {
      if (worker === created) created.postMessage({ action: "init", modelId: activeModelId })
    })
  }

  return worker
}

/** Where the user's model choice is remembered. */
export const MODEL_STORAGE_KEY = "remove-free:model"
export const BACKEND_STORAGE_KEY = "remove-free:backend"

/**
 * Apply a stored backend override at module load, before the worker exists.
 *
 * Same reason the model preference is read here: the worker is created with
 * whatever these hold at that moment, so correcting them afterwards means
 * building a pipeline for the wrong provider and discarding it.
 */
;(() => {
  if (typeof window === "undefined") return
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("backend")
    const stored = fromUrl || localStorage.getItem(BACKEND_STORAGE_KEY)
    if (stored === "webgpu" || stored === "wasm") setBackendOverride(stored)
  } catch {
    // Blocked storage or a malformed URL: fall through to detection.
  }
})()

/**
 * Force an execution provider for this browser, or null to detect again.
 *
 * Persisted, because the reason to set it — "the GPU path is broken on my
 * machine" — does not stop being true on reload.
 */
export function setBackend(backend: Backend | null) {
  setBackendOverride(backend)
  try {
    if (backend) localStorage.setItem(BACKEND_STORAGE_KEY, backend)
    else localStorage.removeItem(BACKEND_STORAGE_KEY)
  } catch {
    // Preference just will not persist; it still applies this session.
  }

  // Every cached alpha and session belongs to the previous provider.
  if (worker) worker.postMessage({ action: "set-backend", backend })
  activeModelId = defaultModelForCurrentBackendUnlessChosen()
}

/**
 * Re-pick the default model for the new backend, unless the user chose one.
 *
 * Switching to CPU with BiRefNet still selected would hand a wasm device the
 * 214 MiB build — the exact thing defaultModelFor exists to prevent.
 */
function defaultModelForCurrentBackendUnlessChosen(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY)
    if (stored && MODELS.some((m) => m.id === stored)) return stored
  } catch {
    // fall through
  }
  return defaultModelFor(detectBackend())
}

/**
 * Read the stored preference at module load, BEFORE the worker is created.
 *
 * This has to happen here rather than in the picker component: the worker is
 * initialised with whatever activeModelId holds at that moment, so if we
 * started on the default and let the UI correct it afterwards, a user whose
 * preference is not the default would download both models on every visit.
 */
function readStoredModelId(): string {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY)
    // An explicit choice always wins, including a choice that is a poor fit for
    // this device: the user picked it, and silently overriding them would be
    // worse than a slow run they opted into.
    if (stored && MODELS.some((m) => m.id === stored)) return stored
  } catch {
    // Private mode or blocked storage — fall through to the default.
  }
  // Only ever a default, never persisted, so it stays correct per device rather
  // than pinning whatever the first machine happened to support.
  return defaultModelFor(detectBackend())
}

/**
 * The model the next job will use. Backend is detected per-device inside the
 * worker; this only selects which model runs on it.
 */
let activeModelId: string =
  typeof window === "undefined" ? DEFAULT_MODEL_ID : readStoredModelId()

/**
 * Resolves once the real provider is known.
 *
 * Nothing that picks a model may run before this. `navigator.gpu` exists on
 * iOS Safari and then fails to give an adapter, so the synchronous guess says
 * "webgpu" there — and the default model for WebGPU is BiRefNet, whose CPU
 * variant is 214 MiB. Choosing before probing would hand every iPhone the
 * largest download in the registry for a provider it cannot use.
 */
export const backendReady: Promise<void> =
  typeof window === "undefined"
    ? Promise.resolve()
    : probeBackend().then(() => {
        // Re-resolve now the answer is real. An explicit preference still wins.
        activeModelId = readStoredModelId()
      })

export function getActiveModelId(): string {
  return activeModelId
}

/**
 * Switch models and start warming the new one.
 *
 * The worker keeps only one live pipeline: each is an ONNX session with its own
 * GPU buffers, and holding three at once exhausted GPU memory. Switching back
 * therefore rebuilds the session — but from weights already in Cache Storage,
 * so it costs a second or two and no network.
 */
export function setActiveModel(modelId: string) {
  if (modelId === activeModelId) return
  activeModelId = modelId

  try {
    localStorage.setItem(MODEL_STORAGE_KEY, modelId)
  } catch {
    // Preference just won't persist; the selection still applies this session.
  }

  if (worker) {
    worker.postMessage({ action: "init", modelId })
  }
}

// ─── Live video ───

interface FrameJob {
  resolve: (mask: Uint8Array) => void
  reject: (err: Error) => void
}

const frameJobs = new Map<string, FrameJob>()
let frameInFlight = false
let lastInferMs = 0

/**
 * Watchdog for the in-flight frame.
 *
 * `frameInFlight` is a latch, so if the worker's reply is ever lost the whole
 * frame pipeline deadlocks and every later frame is refused. That is reachable:
 * disposing a pipeline (model switch) while an inference is running can leave
 * the message unanswered. Rather than trust the worker to always reply, fail the
 * job after a bounded wait and release the latch.
 */
const FRAME_TIMEOUT_MS = 30_000
let frameTimer: ReturnType<typeof setTimeout> | null = null

function clearFrameFlight() {
  frameInFlight = false
  if (frameTimer !== null) {
    clearTimeout(frameTimer)
    frameTimer = null
  }
}

/** Abandon any in-flight frame and unblock the pipeline. */
export function resetFrameQueue(reason = "Frame pipeline reset") {
  for (const [, job] of frameJobs) job.reject(new Error(reason))
  frameJobs.clear()
  clearFrameFlight()
}

/** Milliseconds the most recent frame spent in inference. */
export function getLastFrameInferMs(): number {
  return lastInferMs
}

/** True while a frame is being segmented. */
export function isFrameBusy(): boolean {
  return frameInFlight
}

/**
 * Segment one video frame.
 *
 * Single-flight on purpose: a webcam produces frames faster than the model can
 * consume them, so queueing would grow an unbounded backlog and the preview
 * would drift further behind reality every second. Callers get null while busy
 * and should simply drop that frame.
 *
 * `pixels` is transferred, not copied — do not reuse the buffer afterwards.
 */
export function segmentFrame(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  modelId: string = activeModelId
): Promise<Uint8Array> | null {
  if (frameInFlight) return null

  const w = getBgRemovalWorker()
  const jobId = "frame_" + Math.random().toString(36).substring(2, 9)
  frameInFlight = true

  const promise = new Promise<Uint8Array>((resolve, reject) => {
    frameJobs.set(jobId, { resolve, reject })
  })

  frameTimer = setTimeout(() => {
    resetFrameQueue(
      `Frame segmentation did not respond within ${FRAME_TIMEOUT_MS / 1000}s`
    )
  }, FRAME_TIMEOUT_MS)

  const buffer = pixels.buffer as ArrayBuffer
  w.postMessage(
    {
      action: "segment-frame",
      id: jobId,
      modelId,
      frame: { data: buffer, width, height, channels: 4 },
    },
    [buffer]
  )

  return promise
}

export function addProgressListener(cb: ProgressCallback) {
  progressListeners.add(cb)
  return () => {
    progressListeners.delete(cb)
  }
}

/**
 * Remove background from an image Blob/File using the Web Worker.
 */
export interface CutoutResult {
  cutoutCanvas: HTMLCanvasElement
  originalCanvas: HTMLCanvasElement
  width: number
  height: number
  duration: string
  /**
   * The model's alpha, one byte per pixel. Returned so manual refinement can
   * treat it as an immutable base and keep user edits in a separate layer —
   * see src/lib/brush.ts.
   */
  alpha: Uint8Array
}

/**
 * How long to wait for a segmentation before assuming the worker is dead.
 *
 * Generous, because a first run legitimately includes downloading 109 MiB and
 * compiling it for the GPU. It exists for a failure that was observed once: a
 * WebGPU session died mid-inference with `memory access out of bounds`, after
 * which the worker stopped answering entirely and the studio sat on
 * "processing..." with no error and no way out. A wrong answer is recoverable;
 * no answer at all is not.
 */
const SEGMENT_TIMEOUT_MS = 120_000

/**
 * Throw away the worker and everything waiting on it.
 *
 * Once a worker's wasm heap is corrupt, no later message is answered, so
 * rejecting the queue is not enough — the worker itself has to go. The next
 * call builds a fresh one, which reloads from Cache Storage without touching
 * the network.
 */
export function resetSegmentationWorker(reason: string) {
  for (const [, job] of pendingJobs) job.reject(new Error(reason))
  pendingJobs.clear()
  resetFrameQueue(reason)

  if (worker) {
    worker.terminate()
    worker = null
    workerReadyPromise = null
  }
}

/** Ask the worker for one model's alpha. */
function segment(
  fileBlob: Blob,
  modelId: string,
  edge?: EdgeConfig
): Promise<{ maskData: Uint8Array; width: number; height: number; duration: string }> {
  const w = getBgRemovalWorker()
  const jobId = "job_" + Math.random().toString(36).substring(2, 9)

  const jobPromise = new Promise<{
    maskData: Uint8Array
    width: number
    height: number
    duration: string
  }>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!pendingJobs.has(jobId)) return
      resetSegmentationWorker(
        `The model stopped responding after ${SEGMENT_TIMEOUT_MS / 1000}s. ` +
          `It has been restarted — try that image again.`
      )
    }, SEGMENT_TIMEOUT_MS)

    pendingJobs.set(jobId, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: (err) => {
        clearTimeout(timer)
        reject(err)
      },
    })
  })

  w.postMessage({
    action: "segment",
    id: jobId,
    fileBlob,
    modelId,
    material: edge?.material,
    edgeStrength: edge?.strength,
  })
  return jobPromise
}

/** Decode the source image to a canvas at the size the model reported. */
async function decodeOriginal(fileBlob: Blob, width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")!

  const bitmap = await createImageBitmap(fileBlob)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas
}

/** Combine the source pixels with a model alpha into a transparent cutout. */
function applyAlpha(
  originalCanvas: HTMLCanvasElement,
  maskData: Uint8Array,
  width: number,
  height: number
): HTMLCanvasElement {
  const origCtx = originalCanvas.getContext("2d", { willReadFrequently: true })!
  const imgData = origCtx.getImageData(0, 0, width, height)
  const d = imgData.data

  // maskData is single-channel uint8, width*height long.
  for (let i = 0, j = 3; i < maskData.length; i++, j += 4) {
    d[j] = maskData[i]
  }

  const cutoutCanvas = document.createElement("canvas")
  cutoutCanvas.width = width
  cutoutCanvas.height = height
  cutoutCanvas.getContext("2d")!.putImageData(imgData, 0, 0)
  return cutoutCanvas
}

/**
 * Remove background from an image Blob/File using the Web Worker.
 */
export async function removeBackground(
  fileBlob: Blob,
  modelId?: string,
  edge?: EdgeConfig
): Promise<CutoutResult> {
  await backendReady
  const { maskData, width, height, duration } = await segment(
    fileBlob,
    modelId ?? activeModelId,
    edge
  )
  const originalCanvas = await decodeOriginal(fileBlob, width, height)
  return {
    cutoutCanvas: applyAlpha(originalCanvas, maskData, width, height),
    originalCanvas,
    width,
    height,
    duration,
    alpha: maskData,
  }
}

/**
 * The model used for the first-pass preview.
 *
 * MODNet, because it is the fastest and by far the smallest: 6 MiB quantised,
 * and /bench measured it at 166 ms warm against BiRefNet's 1.98 s. It is a poor
 * *final* answer on non-portraits — it keeps 23.6% of the frame where the other
 * two agree on ~28% — but as something to look at for two seconds while the
 * real matte is computed, being roughly right immediately beats being exactly
 * right eventually.
 */
export const PREVIEW_MODEL_ID = "modnet"

/**
 * Show a fast matte first, then replace it with the good one.
 *
 * The two runs are sequential, not concurrent: the worker holds both sessions
 * live (see MAX_LIVE_PIPELINES) but running them at once would have them
 * contend for the same GPU, and the preview only costs ~150-300 ms to get out
 * of the way.
 *
 * Measured alternating MODNet and BiRefNet in one worker over three rounds:
 * 141-307 ms and 1.7-1.9 s, with no session rebuild between them. The whole
 * idea depends on that — under the old one-pipeline cap each switch would have
 * disposed and rebuilt the other session, and the "fast" preview would have
 * made every image slower.
 *
 * The original canvas is decoded once and shared by both stages, so the caller
 * gets the same object identity twice and anything keyed on it — depth
 * estimation, for one — does not run again for the final pass.
 */
export async function removeBackgroundProgressive(
  fileBlob: Blob,
  options: {
    onPreview?: (result: CutoutResult) => void
    modelId?: string
    previewModelId?: string
    /**
     * What is being cut out. Applied to the FINAL pass only — the preview's
     * job is to be on screen in 150 ms, and a material's snap and unmix are
     * finishing work on a matte that is about to be thrown away.
     */
    edge?: EdgeConfig
  } = {}
): Promise<CutoutResult> {
  await backendReady
  const finalModelId = options.modelId ?? activeModelId
  const previewModelId = options.previewModelId ?? PREVIEW_MODEL_ID

  // Nothing to preview with if the fast model is already the chosen one.
  if (!options.onPreview || finalModelId === previewModelId) {
    return removeBackground(fileBlob, finalModelId, options.edge)
  }

  let originalCanvas: HTMLCanvasElement | null = null

  try {
    const first = await segment(fileBlob, previewModelId)
    originalCanvas = await decodeOriginal(fileBlob, first.width, first.height)
    options.onPreview({
      cutoutCanvas: applyAlpha(originalCanvas, first.maskData, first.width, first.height),
      originalCanvas,
      width: first.width,
      height: first.height,
      duration: first.duration,
      alpha: first.maskData,
    })
  } catch {
    // A preview is a nicety. If the fast model will not load on this device,
    // fall through and let the real one speak for itself.
    originalCanvas = null
  }

  const { maskData, width, height, duration } = await segment(
    fileBlob,
    finalModelId,
    options.edge
  )

  // Both models report the source image's own dimensions, so this normally
  // reuses the canvas. Re-decode rather than assume.
  if (!originalCanvas || originalCanvas.width !== width || originalCanvas.height !== height) {
    originalCanvas = await decodeOriginal(fileBlob, width, height)
  }

  return {
    cutoutCanvas: applyAlpha(originalCanvas, maskData, width, height),
    originalCanvas,
    width,
    height,
    duration,
    alpha: maskData,
  }
}

/**
 * Composite cutout onto the target canvas with chosen background styling.
 */
export interface FinishOptions {
  /** CSS-filter adjustments applied to the subject only. 1 = neutral. */
  adjust?: { brightness: number; contrast: number; saturation: number }
  /** Full CSS filter string for the subject (preset + adjustments). */
  filter?: string
  /**
   * Relighting: a directional light re-graded over the subject, clipped
   * to its alpha. Angle in degrees (0 = from the right), intensity 0..1.
   */
  relight?: { angle: number; intensity: number }
  /** Mirror the subject horizontally. */
  flip?: boolean
  /** Caption text drawn over the finished composite. */
  caption?: { text: string; position: "bottom" | "top" }
  /** Promo badge text ("SALE", "-20%") sealed in the top-right corner. */
  badge?: string
  /** Layer stack: hide the subject, or fade it (0..1). */
  hideSubject?: boolean
  subjectOpacity?: number
}

export function compositeToCanvas({
  targetCanvas,
  cutoutCanvas,
  originalCanvas,
  bgMode,
  effects,
  finish,
}: {
  targetCanvas: HTMLCanvasElement
  cutoutCanvas: HTMLCanvasElement
  originalCanvas?: HTMLCanvasElement
  bgMode: BgMode
  /** Composable post-cut effects, drawn under the subject in declared order. */
  effects?: EffectConfig[]
  finish?: FinishOptions
}) {
  const ctx = targetCanvas.getContext("2d")
  if (!ctx) return

  targetCanvas.width = cutoutCanvas.width
  targetCanvas.height = cutoutCanvas.height

  ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height)

  if (bgMode.type === "color") {
    let fill = bgMode.color
    if (fill === "white") fill = "#ffffff"
    if (fill === "black") fill = "#000000"
    if (fill.startsWith("#") || fill.startsWith("rgb") || fill.startsWith("hsl")) {
      ctx.fillStyle = fill
      ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)
    }
  } else if (bgMode.type === "gradient") {
    let grad: CanvasGradient
    if (bgMode.style === "dark") {
      grad = ctx.createRadialGradient(
        targetCanvas.width / 2,
        targetCanvas.height / 2,
        10,
        targetCanvas.width / 2,
        targetCanvas.height / 2,
        Math.max(targetCanvas.width, targetCanvas.height) / 1.2
      )
      grad.addColorStop(0, "#3f3f46")
      grad.addColorStop(1, "#09090b")
    } else if (bgMode.style === "sunset") {
      grad = ctx.createLinearGradient(0, 0, targetCanvas.width, targetCanvas.height)
      grad.addColorStop(0, "#f97316")
      grad.addColorStop(0.5, "#ec4899")
      grad.addColorStop(1, "#8b5cf6")
    } else if (bgMode.style === "ocean") {
      grad = ctx.createLinearGradient(0, 0, targetCanvas.width, targetCanvas.height)
      grad.addColorStop(0, "#06b6d4")
      grad.addColorStop(0.5, "#3b82f6")
      grad.addColorStop(1, "#6366f1")
    } else if (bgMode.style === "cyberpunk") {
      grad = ctx.createLinearGradient(0, 0, targetCanvas.width, targetCanvas.height)
      grad.addColorStop(0, "#f43f5e")
      grad.addColorStop(0.5, "#a855f7")
      grad.addColorStop(1, "#06b6d4")
    } else {
      // light minimal
      grad = ctx.createLinearGradient(0, 0, 0, targetCanvas.height)
      grad.addColorStop(0, "#f8fafc")
      grad.addColorStop(1, "#cbd5e1")
    }
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height)
  } else if (bgMode.type === "blur" && originalCanvas) {
    const amount = bgMode.amount || 16
    const depthDrawn =
      bgMode.depth &&
      drawDepthBlur({
        ctx,
        source: originalCanvas,
        width: targetCanvas.width,
        height: targetCanvas.height,
        depth: bgMode.depth,
        focal: bgMode.focal ?? 1,
        maxBlur: amount,
      })

    if (!depthDrawn) {
      ctx.save()
      ctx.filter = `blur(${amount}px)`
      // Overdrawn past the edges: a blur samples transparent black outside the
      // canvas, which would darken the frame border.
      ctx.drawImage(originalCanvas, -20, -20, targetCanvas.width + 40, targetCanvas.height + 40)
      ctx.restore()
    }
  } else if (bgMode.type === "image" && bgMode.dataUrl) {
    const bgImg = new Image()
    bgImg.crossOrigin = "anonymous"
    bgImg.src = bgMode.dataUrl
    if (bgImg.complete) {
      ctx.drawImage(bgImg, 0, 0, targetCanvas.width, targetCanvas.height)
    }
  }

  // Effects go between the backdrop and the subject, in declared order.
  //
  // Under the cutout rather than over it, because all three — outline, shadow,
  // glow — are things that surround a subject rather than cover it. Drawing
  // them on top would put a shadow across the face it is cast by.
  //
  // The distance field is the expensive part and depends only on alpha, so it
  // is computed once and shared across the stack.
  if (effects && effects.length > 0) {
    const w = cutoutCanvas.width
    const h = cutoutCanvas.height
    const cut = cutoutCanvas.getContext("2d")
    if (cut) {
      const rgba = cut.getImageData(0, 0, w, h).data
      const alpha = alphaOf(rgba, w * h)
      const dist2 = effectDistanceField(alpha, w, h)

      const layerCanvas = document.createElement("canvas")
      layerCanvas.width = w
      layerCanvas.height = h
      const layerCtx = layerCanvas.getContext("2d")

      if (layerCtx) {
        for (const effect of effects) {
          const layer = renderEffect(effect, alpha, dist2, w, h)
          layerCtx.putImageData(new ImageData(layer.data, w, h), 0, 0)
          ctx.drawImage(layerCanvas, 0, 0)
        }
      }
    }
  }

  // Draw the cutout foreground subject on top, with finishing applied:
  // adjustments and a mirror affect the subject, never the backdrop.
  if (!finish?.hideSubject) {
    const adj = finish?.adjust
    const filterStr =
      finish?.filter ??
      (adj && (adj.brightness !== 1 || adj.contrast !== 1 || adj.saturation !== 1)
        ? `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturation})`
        : "")
    const needsFilter = filterStr.length > 0
    const opacity = finish?.subjectOpacity ?? 1
    if (needsFilter || finish?.flip || opacity !== 1) {
      ctx.save()
      if (needsFilter) {
        ctx.filter = filterStr
      }
      if (finish?.flip) {
        ctx.translate(targetCanvas.width, 0)
        ctx.scale(-1, 1)
      }
      ctx.globalAlpha = Math.min(1, Math.max(0, opacity))
      ctx.drawImage(cutoutCanvas, 0, 0)
      ctx.restore()
    } else {
      ctx.drawImage(cutoutCanvas, 0, 0)
    }

    // Relighting: a warm key light from one side, shade on the other,
    // clipped to the subject's own alpha and blended soft-light so the
    // photo's own shading still reads through.
    const relight = finish?.relight
    if (relight && relight.intensity > 0) {
      const w = targetCanvas.width
      const h = targetCanvas.height
      const light = document.createElement("canvas")
      light.width = w
      light.height = h
      const lctx = light.getContext("2d")!
      const rad = ((relight.angle - 90) * Math.PI) / 180
      const dx = Math.cos(rad)
      const dy = Math.sin(rad)
      const grad = lctx.createLinearGradient(
        w / 2 - dx * w,
        h / 2 - dy * h,
        w / 2 + dx * w,
        h / 2 + dy * h
      )
      const a = Math.min(1, Math.max(0, relight.intensity))
      grad.addColorStop(0, `rgba(255,214,170,${0.55 * a})`)
      grad.addColorStop(0.55, "rgba(128,128,128,0)")
      grad.addColorStop(1, `rgba(10,10,40,${0.4 * a})`)
      lctx.fillStyle = grad
      lctx.fillRect(0, 0, w, h)
      lctx.globalCompositeOperation = "destination-in"
      lctx.drawImage(cutoutCanvas, 0, 0)

      ctx.save()
      ctx.globalCompositeOperation = "soft-light"
      ctx.drawImage(light, 0, 0)
      ctx.restore()
    }
  }

  // Caption last, over everything: this is the creator/thumbnail case.
  const caption = finish?.caption?.text.trim()
  if (caption) {
    drawCaption(ctx, targetCanvas.width, targetCanvas.height, caption, finish!.caption!.position)
  }

  if (finish?.badge?.trim()) {
    drawBadge(ctx, targetCanvas.width, targetCanvas.height, finish.badge)
  }
}

/**
 * Promo badge (Bannerbear-style ecommerce overlay): a scalloped seal in
 * the top-right corner with short text like "SALE" or "-20%".
 */
export function drawBadge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string
) {
  const label = text.trim().slice(0, 10)
  if (!label) return
  const r = Math.max(28, Math.min(width, height) * 0.11)
  const cx = width - r * 1.15
  const cy = r * 1.15

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-0.21)

  // Scalloped seal.
  ctx.beginPath()
  const spikes = 18
  for (let i = 0; i < spikes * 2; i++) {
    const angle = (i / (spikes * 2)) * Math.PI * 2
    const rad = i % 2 === 0 ? r : r * 0.88
    const x = Math.cos(angle) * rad
    const y = Math.sin(angle) * rad
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = "#e11d48"
  ctx.shadowColor = "rgba(0,0,0,0.35)"
  ctx.shadowBlur = r * 0.18
  ctx.shadowOffsetY = 2
  ctx.fill()
  ctx.shadowColor = "transparent"

  ctx.beginPath()
  ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2)
  ctx.strokeStyle = "rgba(255,255,255,0.75)"
  ctx.lineWidth = Math.max(1.5, r * 0.045)
  ctx.stroke()

  ctx.fillStyle = "#ffffff"
  ctx.font = `800 ${Math.max(11, r * (label.length > 4 ? 0.34 : 0.42))}px system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(label, 0, 1, r * 1.5)
  ctx.restore()
}

/** Draw caption text over a finished canvas. Shared with the crop path. */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  text: string,
  position: "bottom" | "top"
) {
  const size = Math.max(16, Math.round(width * 0.042))
  ctx.save()
  ctx.font = `700 ${size}px system-ui, sans-serif`
  ctx.textAlign = "center"
  ctx.shadowColor = "rgba(0,0,0,0.65)"
  ctx.shadowBlur = size * 0.35
  ctx.shadowOffsetY = 2
  ctx.fillStyle = "#ffffff"
  const y = position === "top" ? size * 1.5 : height - size * 0.9
  ctx.fillText(text, width / 2, y, width * 0.92)
  ctx.restore()
}

/**
 * Updates the #status DOM element to maintain strict bg-gone agent protocol.
 */
export function updateAgentStatus(statusText: string, isError = false) {
  if (typeof document === "undefined") return
  const el = document.querySelector<HTMLElement>("#status")
  if (el) {
    el.textContent = statusText
    if (isError) {
      el.classList.add("text-destructive", "bg-destructive/10")
    } else {
      el.classList.remove("text-destructive", "bg-destructive/10")
    }
  }
}

/**
 * Hooks the #dl button to download the current canvas as PNG.
 */
export function setupDownloadButton(canvas: HTMLCanvasElement, filename = "cutout") {
  if (typeof document === "undefined") return
  const dl = document.querySelector<HTMLButtonElement>("#dl")
  if (!dl) return

  dl.onclick = () => {
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${filename}-no-bg.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }, "image/png")
  }
}
