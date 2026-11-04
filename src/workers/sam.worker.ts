// Click-to-select, via SlimSAM.
//
// Runs in its own worker rather than sharing the matting worker, because that
// one deliberately keeps a single live pipeline and disposes the rest — a policy
// that exists to stop three ONNX sessions exhausting GPU memory. Selection needs
// to stay resident *alongside* whichever matting model is active, so it gets its
// own worker and its own budget.
//
// Model: Xenova/slimsam-77-uniform (Apache-2.0). Chosen on size and track
// record — quantised it is 8.5 MiB of vision encoder plus 4.7 MiB of prompt
// decoder, about 13 MiB total, against 148 MiB for sam2-hiera-tiny and 144 MiB
// for the smallest usable Grounding DINO quantisation. It also has ~52k
// downloads where onnx-community/sam2-hiera-tiny has none.
//
// The split matters as much as the size: the vision encoder runs ONCE per image
// and the prompt decoder runs per click, so clicks stay responsive after the
// first encode rather than re-running the whole network.

const MODEL_ID = "Xenova/slimsam-77-uniform"

let modelPromise: Promise<any> | null = null

/** Embeddings for the image currently loaded, reused across clicks. */
let current: {
  embeddings: any
  originalSizes: any
  reshapedSizes: any
  width: number
  height: number
} | null = null

async function getModel() {
  if (modelPromise) return modelPromise

  modelPromise = (async () => {
    const { SamModel, AutoProcessor, env } = await import("@huggingface/transformers")

    // Same hosting policy as the matting models: fetched by the browser from
    // Hugging Face, never through a server of ours.
    env.allowLocalModels = false
    env.useBrowserCache = true
    env.cacheKey = "remove-free-slimsam"

    postMessage({ type: "sam-loading" })

    const model = await SamModel.from_pretrained(MODEL_ID, {
      // fp16 rather than q8: it is what the reference transformers.js demo uses
      // on WebGPU, and the decoder is small enough that the quality is free.
      dtype: "fp16",
      device: "webgpu",
      progress_callback: (p: any) => {
        if (p.status === "progress") {
          postMessage({ type: "sam-progress", progress: p.progress || 0 })
        }
      },
    })
    const processor = await AutoProcessor.from_pretrained(MODEL_ID)

    postMessage({ type: "sam-ready" })
    return { model, processor }
  })().catch((err) => {
    modelPromise = null
    postMessage({ type: "sam-error", error: err?.message || String(err) })
    throw err
  })

  return modelPromise
}

self.onmessage = async (e: MessageEvent) => {
  const { action, id } = e.data

  try {
    if (action === "sam-init") {
      await getModel()
      return
    }

    // Encode an image once; every later click reuses these embeddings.
    if (action === "sam-encode") {
      const { model, processor } = await getModel()
      const { RawImage } = await import("@huggingface/transformers")

      const image = new RawImage(
        new Uint8ClampedArray(e.data.frame.data),
        e.data.frame.width,
        e.data.frame.height,
        4
      )

      const inputs = await processor(image)
      const embeddings = await model.get_image_embeddings(inputs)

      current = {
        embeddings,
        originalSizes: inputs.original_sizes,
        reshapedSizes: inputs.reshaped_input_sizes,
        width: e.data.frame.width,
        height: e.data.frame.height,
      }

      postMessage({
        type: "sam-encoded",
        id,
        width: e.data.frame.width,
        height: e.data.frame.height,
      })
      return
    }

    if (action === "sam-select") {
      if (!current) throw new Error("No image has been encoded yet")

      const { model, processor } = await getModel()
      const { Tensor } = await import("@huggingface/transformers")

      const points: Array<{ x: number; y: number; label: number }> = e.data.points
      if (!points.length) throw new Error("No points given")

      // Points must be in the model's RESHAPED input space, not the original
      // image's. Passing original pixels looks plausible and mostly lands on
      // large objects, but is off by the resize ratio — about 25% on a
      // 800x1283 image, which is why selections needed a containment fallback
      // so often. Normalise, then scale by reshaped_input_sizes.
      const reshaped = current.reshapedSizes[0] // [height, width]
      const input_points = new Tensor(
        "float32",
        points.flatMap((p) => [
          (p.x / current!.width) * reshaped[1],
          (p.y / current!.height) * reshaped[0],
        ]),
        [1, 1, points.length, 2]
      )
      const input_labels = new Tensor(
        "int64",
        points.map((p) => BigInt(p.label)),
        [1, 1, points.length]
      )

      const t0 = performance.now()
      const outputs = await model({
        ...current.embeddings,
        input_points,
        input_labels,
      })

      const masks = await processor.post_process_masks(
        outputs.pred_masks,
        current.originalSizes,
        current.reshapedSizes
      )
      const scores = outputs.iou_scores.data as Float32Array
      const mask = masks[0]
      // post_process_masks returns [batch, numMasks, H, W]. Read from the end
      // rather than destructuring positionally — assuming 3 dimensions here
      // silently produced a 3px-tall empty mask.
      const dims = mask.dims
      const h = dims[dims.length - 2]
      const w = dims[dims.length - 1]
      const numMasks = dims.length >= 3 ? dims[dims.length - 3] : 1

      const src = mask.data as Uint8Array | BigInt64Array | Float32Array
      const plane = h * w

      // SAM proposes several candidates per prompt (typically part, sub-object,
      // whole object). Picking the highest predicted IoU is not reliable: on a
      // test click it returned a 3%-coverage region that did not even contain
      // the clicked pixel. So require the candidate to actually contain the
      // click, and only then prefer the confident one.
      const first = points[0]
      const px = Math.min(w - 1, Math.max(0, Math.round(first.x)))
      const py = Math.min(h - 1, Math.max(0, Math.round(first.y)))
      const pointIndex = py * w + px

      let best = -1
      let bestScore = -Infinity
      for (let mi = 0; mi < numMasks; mi++) {
        const off = mi * plane
        if (!Number(src[off + pointIndex])) continue // does not contain the click
        const score = scores[mi] ?? 0
        if (score > bestScore) {
          bestScore = score
          best = mi
        }
      }

      // Nothing contained the click: fall back to the highest-scoring candidate
      // rather than returning an empty mask.
      if (best < 0) {
        best = 0
        for (let mi = 1; mi < numMasks; mi++) {
          if ((scores[mi] ?? 0) > (scores[best] ?? 0)) best = mi
        }
        bestScore = scores[best] ?? 0
      }

      const offset = best * plane
      const out = new Uint8Array(plane)
      for (let i = 0; i < plane; i++) {
        out[i] = Number(src[offset + i]) ? 255 : 0
      }

      const buffer = out.buffer
      ;(self as any).postMessage(
        {
          type: "sam-mask",
          id,
          width: w,
          height: h,
          score: bestScore,
          candidate: best,
          candidates: numMasks,
          ms: performance.now() - t0,
          maskData: buffer,
        },
        [buffer]
      )
      return
    }
  } catch (err: any) {
    postMessage({
      type: "sam-error",
      id,
      error: err?.message || String(err),
    })
  }
}

// Loaded with { type: "module" }; keeps these declarations off the global scope.
export {}
