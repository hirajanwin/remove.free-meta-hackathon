// Image -> social video: a slow Ken Burns pan/zoom over the finished
// composite, recorded with MediaRecorder (Bannerbear-style animated
// templates, minus the render farm).
//
// The recorder stamps by wall clock, so frames are drawn from
// requestAnimationFrame against elapsed time — the animation duration is
// real time, which is exactly what a 3-second social clip wants.

export interface AnimateOptions {
  seconds?: number
  /** Zoom travel across the clip, e.g. 0.08 = zoom in by 8%. */
  zoom?: number
  signal?: AbortSignal
  onProgress?: (fraction: number) => void
}

export async function animateComposite(
  source: HTMLCanvasElement,
  opts: AnimateOptions = {}
): Promise<Blob> {
  const seconds = opts.seconds ?? 3
  const zoom = opts.zoom ?? 0.08

  const mime = "video/webm;codecs=vp9"
  if (!MediaRecorder.isTypeSupported(mime)) {
    throw new Error("This browser cannot record WebM video.")
  }

  const out = document.createElement("canvas")
  out.width = source.width
  out.height = source.height
  const ctx = out.getContext("2d")!

  const stream = out.captureStream(30)
  const chunks: Blob[] = []
  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: Math.min(12_000_000, source.width * source.height * 6),
  })
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve()
  })

  recorder.start()
  const t0 = performance.now()

  await new Promise<void>((resolve) => {
    const tick = () => {
      if (opts.signal?.aborted) return resolve()
      const t = Math.min(1, (performance.now() - t0) / (seconds * 1000))
      // Ease in-out so the move starts and lands gently.
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
      const scale = 1 + zoom * eased
      const dw = source.width * scale
      const dh = source.height * scale

      ctx.clearRect(0, 0, out.width, out.height)
      ctx.drawImage(source, (out.width - dw) / 2, (out.height - dh) / 2, dw, dh)

      opts.onProgress?.(t)
      if (t < 1) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame(tick)
  })

  recorder.stop()
  await stopped
  stream.getTracks().forEach((t) => t.stop())
  return new Blob(chunks, { type: "video/webm" })
}
