// Video background removal, entirely in the browser.
//
// ─── Why this is a two-pass pipeline ───
//
// The obvious approach — composite each frame onto a canvas and let a
// MediaRecorder capture the stream — produces a video of the wrong length.
// MediaRecorder timestamps frames by wall clock, and segmentation runs at
// roughly 10 fps, so a 10-second clip would come out as a minute of slow
// motion.
//
// So frames are segmented first and stashed as compressed stills, then replayed
// into the recorder at the target frame rate. That decouples processing speed
// from output timing.
//
// The intermediate format is WebP, chosen on measurement rather than taste:
// WebP's lossy mode stores the alpha channel losslessly (a round trip at q0.80
// and q0.95 both returned mean and max alpha error of 0), so the matte survives
// the intermediate step bit-for-bit while the colour data stays small. Holding
// 300 raw RGBA frames of 720p would need about a gigabyte; as WebP it is tens
// of megabytes.
//
// ─── Encoder findings (Chrome, measured) ───
//
//   VideoEncoder alpha:'keep'   unsupported for vp8, vp9, h264 AND av1
//   MediaRecorder vp8           alpha preserved exactly       -> [0,0,0,0]
//   MediaRecorder vp9           alpha slightly lossy, smaller -> [0,0,0,1]
//
// WebCodecs therefore cannot produce transparent video at all here, despite
// being the modern API. MediaRecorder with VP8 can, so that is what transparent
// export uses; VP9 is used when the background is opaque, where its better
// compression costs nothing.

import { drawBadge, drawCaption, segmentFrame } from "./bg-removal"

// Backdrop helpers (kept in sync with the still compositor's gradients).
const backdropImages = new Map<string, HTMLImageElement>()
export function backdropImageFor(dataUrl: string): HTMLImageElement {
  let img = backdropImages.get(dataUrl)
  if (!img) {
    img = new Image()
    img.src = dataUrl
    backdropImages.set(dataUrl, img)
  }
  return img
}

export function gradientFor(
  ctx: CanvasRenderingContext2D,
  style: "dark" | "sunset" | "ocean" | "cyberpunk" | "light",
  w: number,
  h: number
): CanvasGradient {
  let grad: CanvasGradient
  if (style === "dark") {
    grad = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, Math.max(w, h) / 1.2)
    grad.addColorStop(0, "#3f3f46")
    grad.addColorStop(1, "#09090b")
  } else if (style === "sunset") {
    grad = ctx.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, "#f97316")
    grad.addColorStop(0.5, "#ec4899")
    grad.addColorStop(1, "#8b5cf6")
  } else if (style === "ocean") {
    grad = ctx.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, "#06b6d4")
    grad.addColorStop(0.5, "#3b82f6")
    grad.addColorStop(1, "#6366f1")
  } else if (style === "cyberpunk") {
    grad = ctx.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, "#f43f5e")
    grad.addColorStop(0.5, "#a855f7")
    grad.addColorStop(1, "#06b6d4")
  } else {
    grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, "#f8fafc")
    grad.addColorStop(1, "#cbd5e1")
  }
  return grad
}
import { matteFrame, resetTemporalState } from "./rvm"
import { estimateDepth, type DepthMap } from "./depth"
import { drawDepthBlur, focalDepth } from "./bokeh"
import { depthSliceMatte, isNoopSlice, type DepthSlice } from "./depth-slice"

/** Sentinel model id selecting RobustVideoMatting instead of a still model. */
export const RVM_MODEL_ID = "rvm"

/** Transparent output needs VP8: VP9 rounds full transparency to alpha 1. */
export const TRANSPARENT_MIME = "video/webm;codecs=vp8"
/** Opaque output has no alpha to protect, so take VP9's smaller files. */
export const OPAQUE_MIME = "video/webm;codecs=vp9"

export type VideoBackdrop =
  | { type: "transparent" }
  | { type: "color"; color: string }
  | { type: "gradient"; style: "dark" | "sunset" | "ocean" | "cyberpunk" | "light" }
  /** `depth`: blur grows with distance behind the subject instead of one flat radius. */
  | { type: "blur"; amount: number; depth?: boolean }
  | { type: "image"; dataUrl: string }

export interface VideoMeta {
  width: number
  height: number
  duration: number
}

export interface ProcessOptions {
  file: File
  backdrop: VideoBackdrop
  /** Output frame rate. Fewer frames means proportionally less work. */
  fps: number
  /** Shortest edge handed to the model; see the webcam route for why 512. */
  inferShortEdge?: number
  /**
   * Temporal smoothing, 0 to 0.9. Blends each frame's alpha with the previous
   * frame's: `out = prev * s + current * (1 - s)`.
   *
   * These are per-frame image models with no temporal memory, which is the
   * known weakness of this approach on real footage. Measured on a clip whose
   * frames are byte-identical, though, MODNet's mask barely moves — mean alpha
   * delta 0.04-0.11 of 255 and 0.00% of pixels shifting by more than 16 — so
   * there is no flicker to damp when the subject is still.
   *
   * It therefore defaults to OFF: on genuinely moving footage smoothing trades
   * flicker for motion lag and edge ghosting, and the benefit has not been
   * measured here (this environment has no camera and no real video). Turn it
   * up only if real footage actually shimmers.
   */
  smoothing?: number
  modelId?: string
  /**
   * External alpha provider (SAM 3.1 tracked masks). When it returns a
   * full-resolution alpha for a time, inference is skipped for that frame.
   * Returning null falls back to the local model.
   */
  alphaAt?: (time: number) => Uint8Array | null
  /** Title/subtitle text drawn over every frame (Bannerbear-style overlay). */
  caption?: string
  /** CSS filter applied to the subject (filter gallery parity with stills). */
  filter?: string
  /** Promo badge text sealed top-right of every frame. */
  badge?: string
  /** Output crop as width/height ratio (subject-centred crop is stills-only). */
  cropRatio?: number | null
  /** Trim the matte by distance, from a per-frame depth map. */
  depthSlice?: DepthSlice
  signal?: AbortSignal
  onProgress?: (done: number, total: number) => void
  /** Newest composited frame, so the UI can show work in progress. */
  onFrame?: (blob: Blob, index: number) => void
}

/**
 * Everything needed to composite frames from one video, held open across calls.
 *
 * Preview and full export share this deliberately: if the preview used its own
 * compositing path it could disagree with the exported frames, which is the one
 * thing a preview must never do.
 */
export interface Compositor {
  meta: VideoMeta
  /** Seek to `time` and return the composited frame as a WebP blob. */
  frameAt: (time: number, backdrop: VideoBackdrop, smoothing?: number) => Promise<Blob>
  /** Same, but returns the canvas for direct display without a decode. */
  canvasAt: (
    time: number,
    backdrop: VideoBackdrop,
    smoothing?: number
  ) => Promise<HTMLCanvasElement>
  /** Forget the previous frame, so smoothing does not bleed across seeks. */
  resetTemporal: () => void
  dispose: () => void
}

export interface ProcessResult {
  /** Composited frames as WebP blobs, in order. */
  frames: Blob[]
  meta: VideoMeta
  fps: number
}

export async function readVideoMeta(file: File): Promise<VideoMeta> {
  const video = document.createElement("video")
  video.preload = "metadata"
  video.muted = true
  const url = URL.createObjectURL(file)
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error("Could not read that video"))
    })
    return {
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Open a video and prepare the canvases needed to composite its frames.
 *
 * Seeking rather than decoding via WebCodecs avoids needing an MP4 demuxer, so
 * any container the browser can play works. It is slower per frame, but
 * inference dominates the cost anyway.
 */
export async function openCompositor(
  file: File,
  inferShortEdge = 512,
  modelId?: string,
  alphaAt?: (time: number) => Uint8Array | null,
  caption?: string,
  extra?: { filter?: string; badge?: string; cropRatio?: number | null; depthSlice?: DepthSlice }
): Promise<Compositor> {
  const useRvm = modelId === RVM_MODEL_ID
  const url = URL.createObjectURL(file)
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.preload = "auto"
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error("Could not decode that video"))
    })
  } catch (err) {
    URL.revokeObjectURL(url)
    throw err
  }

  const vw = video.videoWidth
  const vh = video.videoHeight
  const duration = video.duration
  if (!vw || !vh || !isFinite(duration)) {
    URL.revokeObjectURL(url)
    throw new Error("That video has no readable dimensions or duration")
  }

  const scale = Math.min(1, inferShortEdge / Math.min(vw, vh))
  const iw = Math.max(1, Math.round(vw * scale))
  const ih = Math.max(1, Math.round(vh * scale))

  const infer = canvas2d(iw, ih, true)
  const mask = canvas2d(iw, ih)
  const subject = canvas2d(vw, vh)

  // Optional centre crop to an output ratio (9:16 for Shorts, 1:1, ...).
  const cropRatio = extra?.cropRatio ?? null
  let outW = vw
  let outH = vh
  if (cropRatio) {
    if (vw / vh > cropRatio) {
      outW = Math.round(vh * cropRatio)
    } else {
      outH = Math.round(vw / cropRatio)
    }
  }
  const cropX = Math.round((vw - outW) / 2)
  const cropY = Math.round((vh - outH) / 2)
  const out = canvas2d(outW, outH)

  // Previous frame's alpha, for optional temporal smoothing.
  let prevAlpha: Uint8Array | null = null
  // Depth is re-estimated every frame; blending with the last map keeps the
  // blur from shimmering when the model's estimate wobbles between frames.
  let prevDepth: DepthMap | null = null
  const bgFrame = canvas2d(outW, outH)
  const fullFrame = canvas2d(vw, vh)
  const blendDepth = (depth: DepthMap): DepthMap => {
    let out = depth
    if (prevDepth && prevDepth.width === depth.width && prevDepth.height === depth.height) {
      const blended = new Uint8Array(depth.data.length)
      for (let i = 0; i < blended.length; i++) {
        blended[i] = (prevDepth.data[i] * 0.5 + depth.data[i] * 0.5 + 0.5) | 0
      }
      out = { ...depth, data: blended }
    }
    prevDepth = out
    return out
  }
  // One depth read per frame, shared by the slice and an un-cropped blur.
  let depthCache: { time: number; map: DepthMap } | null = null
  const frameDepth = async (time: number): Promise<DepthMap> => {
    if (depthCache && depthCache.time === time) return depthCache.map
    fullFrame.ctx.drawImage(video, 0, 0, vw, vh)
    const map = blendDepth(await estimateDepth(fullFrame.el))
    depthCache = { time, map }
    return map
  }
  const resetTemporal = () => {
    depthCache = null
    prevAlpha = null
    prevDepth = null
    // RVM carries hidden state between frames; without this a new clip inherits
    // the last one's memory and blends two scenes for several frames.
    if (useRvm) void resetTemporalState()
  }

  const canvasAt = async (
    time: number,
    backdrop: VideoBackdrop,
    smoothing = 0
  ) => {
    await seekTo(video, Math.min(Math.max(0, time), Math.max(0, duration - 1e-3)))

    // Segment at model scale.
    infer.ctx.drawImage(video, 0, 0, iw, ih)
    const pixels = infer.ctx.getImageData(0, 0, iw, ih).data

    // External alpha (SAM 3.1 tracked masks) wins when provided for this
    // time; the local model is the fallback, frame by frame.
    const provided = alphaAt?.(time) ?? null
    const providedIsFullRes = provided !== null && provided.length === vw * vh

    // RVM wants the DOWNSAMPLED side near 512, so the ratio is derived rather
    // than fixed: 0.4 on a small frame shrinks the encoder input to ~150px and
    // the matte comes back as mush.
    let alpha =
      provided ??
      (useRvm
        ? (await matteFrame(pixels, iw, ih, Math.min(1, 512 / Math.max(iw, ih)))).alpha
        : await awaitFrame(pixels, iw, ih, modelId))

    if (smoothing > 0 && prevAlpha && prevAlpha.length === alpha.length) {
      const s = Math.min(0.9, smoothing)
      const blended = new Uint8Array(alpha.length)
      for (let i = 0; i < alpha.length; i++) {
        blended[i] = (prevAlpha[i] * s + alpha[i] * (1 - s) + 0.5) | 0
      }
      alpha = blended
    }
    prevAlpha = smoothing > 0 ? alpha : null

    // Depth slice: drop what falls outside the chosen distance window.
    const slice = extra?.depthSlice
    if (slice && !isNoopSlice(slice)) {
      const aw = providedIsFullRes ? vw : iw
      const ah = providedIsFullRes ? vh : ih
      if (alpha.length === aw * ah) {
        try {
          const matte = depthSliceMatte(await frameDepth(time), slice, aw, ah)
          const trimmed = new Uint8Array(alpha.length)
          for (let i = 0; i < trimmed.length; i++) trimmed[i] = (alpha[i] * matte[i] + 127) / 255
          alpha = trimmed
        } catch {
          // Depth unavailable: keep the untrimmed matte rather than failing the frame.
        }
      }
    }

    // Alpha -> greyscale mask canvas, upscaled during compositing.
    // External alpha arrives at full resolution; local alpha at infer size.
    const maskW = providedIsFullRes ? vw : iw
    const maskH = providedIsFullRes ? vh : ih
    if (mask.el.width !== maskW || mask.el.height !== maskH) {
      mask.el.width = maskW
      mask.el.height = maskH
    }
    const maskImage = mask.ctx.createImageData(maskW, maskH)
    for (let p = 0, j = 0; p < alpha.length; p++, j += 4) {
      maskImage.data[j] = 255
      maskImage.data[j + 1] = 255
      maskImage.data[j + 2] = 255
      maskImage.data[j + 3] = alpha[p]
    }
    mask.ctx.putImageData(maskImage, 0, 0)

    // Subject, punched out by the mask.
    subject.ctx.globalCompositeOperation = "source-over"
    subject.ctx.clearRect(0, 0, vw, vh)
    subject.ctx.drawImage(video, 0, 0, vw, vh)
    subject.ctx.globalCompositeOperation = "destination-in"
    subject.ctx.drawImage(mask.el, 0, 0, vw, vh)

    // Backdrop, then subject on top — all in cropped output coordinates.
    // The subject filter is applied at draw time so the backdrop is
    // never graded.
    out.ctx.globalCompositeOperation = "source-over"
    out.ctx.clearRect(0, 0, outW, outH)
    if (backdrop.type === "color") {
      out.ctx.fillStyle = backdrop.color
      out.ctx.fillRect(0, 0, outW, outH)
    } else if (backdrop.type === "gradient") {
      out.ctx.fillStyle = gradientFor(out.ctx, backdrop.style, outW, outH)
      out.ctx.fillRect(0, 0, outW, outH)
    } else if (backdrop.type === "image") {
      const img = backdropImageFor(backdrop.dataUrl)
      if (img && img.complete && img.naturalWidth > 0) {
        out.ctx.drawImage(img, 0, 0, outW, outH)
      }
    } else if (backdrop.type === "blur") {
      let drawn = false
      if (backdrop.depth) {
        try {
          bgFrame.ctx.drawImage(video, -cropX, -cropY, vw, vh)
          const depth = cropRatio
            ? blendDepth(await estimateDepth(bgFrame.el))
            : await frameDepth(time)

          // The subject's own depth is the focal plane. The alpha covers the
          // whole video frame, so cut out the cropped region it maps to.
          const aw = maskW
          const ah = maskH
          const ax0 = Math.round((cropX * aw) / vw)
          const ay0 = Math.round((cropY * ah) / vh)
          const cw = Math.max(1, Math.round((outW * aw) / vw))
          const ch = Math.max(1, Math.round((outH * ah) / vh))
          const cropped = new Uint8Array(cw * ch)
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              cropped[y * cw + x] = alpha[Math.min(ah - 1, ay0 + y) * aw + Math.min(aw - 1, ax0 + x)]
            }
          }
          const focal = focalDepth(depth, cropped, cw, ch, 1, 0)
          drawn = drawDepthBlur({
            ctx: out.ctx,
            source: bgFrame.el,
            width: outW,
            height: outH,
            depth,
            focal,
            maxBlur: backdrop.amount,
          })
        } catch {
          drawn = false
        }
      }
      if (!drawn) {
        out.ctx.save()
        out.ctx.filter = `blur(${backdrop.amount}px)`
        out.ctx.drawImage(video, -cropX, -cropY, vw, vh)
        out.ctx.restore()
      }
    }

    if (extra?.filter) {
      out.ctx.save()
      out.ctx.filter = extra.filter
      out.ctx.drawImage(subject.el, -cropX, -cropY)
      out.ctx.restore()
    } else {
      out.ctx.drawImage(subject.el, -cropX, -cropY)
    }

    // Title/subtitle overlay, over every frame (imported drawCaption so
    // the preview and the export render the identical frame).
    if (caption?.trim()) {
      drawCaption(out.ctx, outW, outH, caption.trim(), "bottom")
    }
    if (extra?.badge?.trim()) {
      drawBadge(out.ctx, outW, outH, extra.badge)
    }

    return out.el
  }

  return {
    meta: { width: outW, height: outH, duration },
    canvasAt,
    // q0.92: colour is compressed, alpha is not.
    resetTemporal,
    frameAt: async (time, backdrop, smoothing) => {
      const el = await canvasAt(time, backdrop, smoothing)
      const blob = await toBlob(el, "image/webp", 0.92)
      if (!blob) throw new Error("Frame encode failed")
      return blob
    },
    dispose: () => {
      video.pause()
      video.removeAttribute("src")
      video.load()
      URL.revokeObjectURL(url)
    },
  }
}

/**
 * Composite a single frame, for checking settings before committing to a run
 * that can take minutes. Uses exactly the same path as the export.
 */
export async function previewFrame(
  file: File,
  time: number,
  backdrop: VideoBackdrop,
  modelId?: string,
  caption?: string,
  extra?: { filter?: string; badge?: string; cropRatio?: number | null; depthSlice?: DepthSlice }
): Promise<{ blob: Blob; meta: VideoMeta; ms: number }> {
  const comp = await openCompositor(file, 512, modelId, undefined, caption, extra)
  try {
    const t0 = performance.now()
    const blob = await comp.frameAt(time, backdrop)
    return { blob, meta: comp.meta, ms: performance.now() - t0 }
  } finally {
    comp.dispose()
  }
}

/** Pass 1: segment and composite every frame. */
export async function processVideo(opts: ProcessOptions): Promise<ProcessResult> {
  const {
    file,
    backdrop,
    fps,
    inferShortEdge = 512,
    modelId,
    alphaAt,
    caption,
    filter,
    badge,
    cropRatio,
    signal,
    onProgress,
    onFrame,
    smoothing = 0,
  } = opts

  const comp = await openCompositor(file, inferShortEdge, modelId, alphaAt, caption, {
    filter,
    badge,
    cropRatio,
    depthSlice: opts.depthSlice,
  })
  try {
    comp.resetTemporal()
    const { duration } = comp.meta
    const total = Math.max(1, Math.floor(duration * fps))
    const frames: Blob[] = []

    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

      const blob = await comp.frameAt(i / fps, backdrop, smoothing)
      frames.push(blob)

      onProgress?.(i + 1, total)
      onFrame?.(blob, i)
    }

    return { frames, meta: comp.meta, fps }
  } finally {
    comp.dispose()
  }
}

/**
 * Pass 2: replay the stashed frames into a MediaRecorder at the target rate.
 *
 * `captureStream(0)` plus an explicit `requestFrame()` per frame is what keeps
 * the output frame count exact — letting the stream capture on its own timer
 * would duplicate or drop frames depending on how fast the replay ran.
 */
export async function encodeFrames(
  frames: Blob[],
  meta: VideoMeta,
  fps: number,
  transparent: boolean,
  signal?: AbortSignal
): Promise<Blob> {
  if (!frames.length) throw new Error("Nothing to encode")

  const mime = transparent ? TRANSPARENT_MIME : OPAQUE_MIME
  if (!MediaRecorder.isTypeSupported(mime)) {
    throw new Error(`This browser cannot encode ${mime}`)
  }

  const out = canvas2d(meta.width, meta.height)
  const stream = out.el.captureStream(0)
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack

  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.min(12_000_000, meta.width * meta.height * 8),
  })
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()
  const frameInterval = 1000 / fps

  try {
    for (const frame of frames) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

      const bitmap = await createImageBitmap(frame)
      out.ctx.clearRect(0, 0, meta.width, meta.height)
      out.ctx.drawImage(bitmap, 0, 0)
      bitmap.close()

      track.requestFrame()
      // Pace the replay: the recorder still stamps by wall clock, so the frames
      // have to be fed at roughly the rate they should play back at.
      await sleep(frameInterval)
    }
  } finally {
    recorder.stop()
    await stopped
    stream.getTracks().forEach((t) => t.stop())
  }

  return new Blob(chunks, { type: "video/webm" })
}

/** True alpha for editors: a PNG per frame keeps everything lossless. */
export async function framesToPngZip(frames: Blob[]): Promise<Blob> {
  const { default: JSZip } = await import("jszip")
  const zip = new JSZip()

  for (let i = 0; i < frames.length; i++) {
    const bitmap = await createImageBitmap(frames[i])
    const c = canvas2d(bitmap.width, bitmap.height)
    c.ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    const png = await toBlob(c.el, "image/png")
    if (png) {
      zip.file(`frame_${String(i).padStart(5, "0")}.png`, png)
    }
  }

  return zip.generateAsync({ type: "blob" })
}

// ─── helpers ───

function canvas2d(w: number, h: number, readFrequently = false) {
  const el = document.createElement("canvas")
  el.width = w
  el.height = h
  const ctx = el.getContext("2d", { willReadFrequently: readFrequently })!
  return { el, ctx }
}

function toBlob(
  el: HTMLCanvasElement,
  type: string,
  quality?: number
): Promise<Blob | null> {
  return new Promise((resolve) => el.toBlob(resolve, type, quality))
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked)
      video.removeEventListener("error", onError)
      resolve()
    }
    const onError = () => {
      video.removeEventListener("seeked", onSeeked)
      video.removeEventListener("error", onError)
      reject(new Error("Seek failed"))
    }
    video.addEventListener("seeked", onSeeked)
    video.addEventListener("error", onError)
    video.currentTime = time
  })
}

/**
 * segmentFrame is single-flight and returns null while busy. Here frames are
 * processed strictly in order, so a null means the previous frame's promise has
 * not settled yet — wait a tick and retry rather than dropping the frame, since
 * for offline export every frame matters.
 */
async function awaitFrame(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  modelId?: string
): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 600; attempt++) {
    const pending = segmentFrame(pixels, w, h, modelId)
    if (pending) return pending
    await sleep(10)
  }
  throw new Error("Segmentation worker never became available")
}
