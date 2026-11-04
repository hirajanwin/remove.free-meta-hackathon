// Monocular depth estimation, used to make the Blur backdrop obey the scene.
//
// The blur we shipped first was uniform: every background pixel got the same
// radius, which is not what a lens does. A real f/1.4 frame is sharp at the
// subject's distance and blurs progressively with how far a thing sits from
// that plane, so a wall two metres behind the subject is softer than a chair
// just behind their shoulder. With a depth map we can reproduce that.
//
// The model is no longer fixed here: the registry in lib/depth-models.ts holds
// the choices and the Depth tab picks one, because a depth map someone is going
// to export deserves a better model than a blur radius needs. Bokeh still gets
// the default (Depth Anything V2 Small) and still pays 20 MiB for it.
//
// Its own worker, deliberately. The matting worker keeps exactly one live
// pipeline and disposes the rest to stop several ONNX sessions exhausting GPU
// memory; depth has to stay resident next to whichever matting model is active,
// exactly like SlimSAM does.

import {
  DEFAULT_DEPTH_MODEL_ID,
  depthCacheKeyFor,
  depthModelById,
} from "../lib/depth-models"

let usedDevice: "webgpu" | "wasm" = "wasm"

/**
 * One live pipeline, keyed by model id.
 *
 * The Depth tab lets you switch models, and each is 20-160 MiB of GPU
 * allocation. Keeping the previous one alive while building the next is the
 * mistake that produced `getBindGroupLayout of undefined` in the matting
 * worker, so the same discipline applies: dispose first, then allocate.
 */
let current: { id: string; pipe: Promise<any> } | null = null

async function getPipe(modelId: string) {
  if (current?.id === modelId) return current.pipe

  if (current) {
    // Free before allocating, not after. Two depth sessions at once is a peak
    // of two models' worth of VRAM on top of whichever matting model is live.
    const previous = current
    current = null
    try {
      const pipe = await previous.pipe
      await pipe?.dispose?.()
    } catch {
      // A pipeline that failed to build has nothing to dispose.
    }
  }

  const model = depthModelById(modelId)

  const pipe = (async () => {
    const { pipeline, env } = await import("@huggingface/transformers")

    // Same hosting policy as everything else here: the browser fetches weights
    // from Hugging Face, never through a server of ours.
    env.allowLocalModels = false
    env.useBrowserCache = true

    const webgpu = "gpu" in navigator && !!(navigator as any).gpu
    usedDevice = webgpu ? "webgpu" : "wasm"

    // Explicit, and per model+backend, so the Model Storage page can size and
    // remove each one. This used to be unset, which put every depth download
    // into transformers.js's own default bucket.
    env.cacheKey = depthCacheKeyFor(model.id, usedDevice)

    postMessage({ type: "depth-loading", device: usedDevice, modelId: model.id })

    return pipeline("depth-estimation", model.repo, {
      dtype: model.variants[usedDevice].dtype,
      device: usedDevice,
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          postMessage({ type: "depth-progress", progress: p.progress || 0 })
        }
      },
    })
  })()
    .then((p) => {
      postMessage({ type: "depth-ready", device: usedDevice, modelId: model.id })
      return p
    })
    .catch((err) => {
      if (current?.id === modelId) current = null
      postMessage({ type: "depth-error", error: err?.message || String(err) })
      throw err
    })

  current = { id: modelId, pipe }
  return pipe
}

self.onmessage = async (e: MessageEvent) => {
  const { action, id } = e.data

  try {
    if (action === "depth-init") {
      await getPipe(e.data.modelId || DEFAULT_DEPTH_MODEL_ID)
      return
    }

    if (action === "depth-estimate") {
      const pipe = await getPipe(e.data.modelId || DEFAULT_DEPTH_MODEL_ID)
      const { RawImage } = await import("@huggingface/transformers")

      const { width, height } = e.data.frame
      const image = new RawImage(
        new Uint8ClampedArray(e.data.frame.data),
        width,
        height,
        4
      )

      const t0 = performance.now()
      const out = await pipe(image)
      const ms = performance.now() - t0

      // `depth` is a single-channel RawImage already resized back to the input
      // dimensions and normalised to 0-255, where brighter means nearer. That
      // is exactly the form the compositor wants, so no post-processing here.
      const depth = out.depth
      const bytes = new Uint8Array(depth.data as ArrayLike<number>)

      const buffer = bytes.buffer
      ;(self as any).postMessage(
        {
          type: "depth-map",
          id,
          width: depth.width,
          height: depth.height,
          ms,
          device: usedDevice,
          depthData: buffer,
        },
        [buffer]
      )
      return
    }
  } catch (err: any) {
    postMessage({ type: "depth-error", id, error: err?.message || String(err) })
  }
}

// Loaded with { type: "module" }; keeps these declarations off the global scope.
export {}
