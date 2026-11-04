// DINOv2 "select similar", in its own worker.
//
// Its own worker for the same reason SlimSAM and Depth have theirs: the
// matting worker deliberately keeps one live pipeline, and this model has to
// stay resident next to whichever matting model is active.
//
// Model: Xenova/dinov2-small (Apache-2.0, ~12 MiB). It only ever *proposes*:
// its patch grid is 16x16, far too coarse for a matte. The worker returns
// seed points and a coarse similarity mask; SlimSAM produces the real mask
// from the seeds. See src/lib/similarity.ts.

import { maskFromSimilarity, patchSimilarity, seedPoints } from "../lib/similarity"

const MODEL_ID = "Xenova/dinov2-small"

let modelPromise: Promise<any> | null = null
let current: {
  features: Float32Array
  tokenCount: number
  dim: number
  gridW: number
  gridH: number
  width: number
  height: number
} | null = null

async function getModel() {
  if (modelPromise) return modelPromise

  modelPromise = (async () => {
    const { AutoModel, AutoImageProcessor, env } = await import(
      "@huggingface/transformers"
    )

    env.allowLocalModels = false
    env.useBrowserCache = true
    env.cacheKey = "remove-free-dinov2"

    const webgpu = "gpu" in navigator && !!(navigator as any).gpu
    const device = webgpu ? "webgpu" : "wasm"

    postMessage({ type: "dino-loading", device })

    const model = await AutoModel.from_pretrained(MODEL_ID, {
      dtype: webgpu ? "q4f16" : "q8",
      device,
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          postMessage({ type: "dino-progress", progress: p.progress || 0 })
        }
      },
    })
    const processor = await AutoImageProcessor.from_pretrained(MODEL_ID)

    postMessage({ type: "dino-ready", device })
    return { model, processor }
  })().catch((err) => {
    modelPromise = null
    postMessage({ type: "dino-error", error: err?.message || String(err) })
    throw err
  })

  return modelPromise
}

self.onmessage = async (e: MessageEvent) => {
  const { action, id } = e.data

  try {
    if (action === "dino-init") {
      await getModel()
      return
    }

    if (action === "dino-encode") {
      const { model, processor } = await getModel()
      const { RawImage } = await import("@huggingface/transformers")

      const image = new RawImage(
        new Uint8ClampedArray(e.data.frame.data),
        e.data.frame.width,
        e.data.frame.height,
        4
      )

      const inputs = await processor(image)
      const output = await model(inputs)
      const hidden = output.last_hidden_state ?? output[0]
      if (!hidden?.dims || hidden.dims.length !== 3) {
        throw new Error("DINOv2 returned an unexpected output shape")
      }
      const [, tokenCount, dim] = hidden.dims
      const patches = tokenCount - 1
      const grid = Math.round(Math.sqrt(patches))
      if (grid * grid !== patches) {
        throw new Error(`DINOv2 patch grid is not square (${patches} patches)`)
      }

      current = {
        features: new Float32Array(hidden.data),
        tokenCount,
        dim,
        gridW: grid,
        gridH: grid,
        width: e.data.frame.width,
        height: e.data.frame.height,
      }

      postMessage({
        type: "dino-encoded",
        id,
        width: current.width,
        height: current.height,
      })
      return
    }

    if (action === "dino-similar") {
      if (!current) throw new Error("No image has been encoded yet")
      const { x, y, threshold } = e.data as {
        x: number
        y: number
        threshold: number
      }

      const patchX = Math.min(
        current.gridW - 1,
        Math.max(0, Math.floor((x / current.width) * current.gridW))
      )
      const patchY = Math.min(
        current.gridH - 1,
        Math.max(0, Math.floor((y / current.height) * current.gridH))
      )
      const queryPatch = patchY * current.gridW + patchX

      const t0 = performance.now()
      const sim = patchSimilarity(current.features, current.tokenCount, current.dim, queryPatch)
      const mask = maskFromSimilarity(sim, threshold)
      const seeds = seedPoints(
        sim,
        current.gridW,
        current.gridH,
        current.width,
        current.height,
        threshold,
        4,
        queryPatch
      )

      const maskBuffer = mask.buffer as ArrayBuffer
      ;(self as any).postMessage(
        {
          type: "dino-similar-result",
          id,
          maskData: maskBuffer,
          width: current.gridW,
          height: current.gridH,
          seeds,
          ms: performance.now() - t0,
        },
        [maskBuffer]
      )
      return
    }
  } catch (err: any) {
    postMessage({ type: "dino-error", id, error: err?.message || String(err) })
  }
}

// Loaded with { type: "module" }; keeps these declarations off the global scope.
export {}
