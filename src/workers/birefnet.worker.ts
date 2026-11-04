// Background removal Web Worker running @huggingface/transformers off the main thread.
//
// Every model in the registry runs on both backends. The backend is detected from
// the device (WebGPU where available, WASM otherwise); the model is the user's
// choice. Pipelines are cached per model+backend pair so switching models back and
// forth doesn't re-download anything.

import {
  cacheKeyFor,
  defaultModelFor,
  detectBackend,
  probeBackend,
  setBackendOverride,
  getModel,
  type Backend,
  type ModelDef,
} from "../lib/models"
import { ortWasmPaths, resolveWeights } from "../lib/weights"
import { refineAlpha } from "../lib/refine"
import { applyMaterial, materialById } from "../lib/recipe/materials"

interface Pipeline {
  runInference: (rawImg: any) => Promise<any>
  RawImage: any
  backend: Backend
  model: ModelDef
  /** Releases the ONNX session and its GPU buffers. */
  dispose: () => Promise<void>
}

/**
 * At most two live pipelines.
 *
 * Each entry is a full ONNX session with its own GPU buffers, and they used to
 * accumulate: selecting all THREE models in one session died with
 * `RuntimeError: memory access out of bounds`. GPU memory, not download time,
 * is the binding constraint, so this was capped at one.
 *
 * One turned out to be a cap too far. The progressive preview alternates the
 * fast model and the chosen one on every image, and under a cap of one each
 * switch disposed and rebuilt the other session — which would have made the
 * "fast" preview cost more than it saved.
 *
 * Two was then measured rather than assumed, on the worst case of the two
 * largest models (BiRefNet 109 MiB + RMBG 84 MiB) alternating over three
 * rounds:
 *
 *   round 0   rmbg 13.97 s   birefnet 1.92 s   <- building both sessions
 *   round 1   rmbg  0.31 s   birefnet 1.69 s
 *   round 2   rmbg  0.30 s   birefnet 1.69 s
 *
 * Steady state with no rebuild and no error, so the crash needed all three.
 *
 * Evicting is still cheap to recover from — the weights are already in Cache
 * Storage, so a rebuild costs a second or two and no network.
 */
const pipelines = new Map<string, Promise<Pipeline>>()
const MAX_LIVE_PIPELINES = 2

/**
 * Keys with an inference currently running.
 *
 * Disposing a session mid-inference leaves the caller's message unanswered,
 * which used to deadlock the frame pipeline permanently. Eviction therefore
 * skips busy pipelines and retries once they are idle.
 */
const busyKeys = new Set<string>()
let evictionPending = false

async function evictExcept(keepKey: string, limit = MAX_LIVE_PIPELINES) {
  let deferred = false

  for (const [key, pending] of [...pipelines.entries()]) {
    if (key === keepKey) continue
    if (pipelines.size <= limit) break
    if (busyKeys.has(key)) {
      deferred = true
      continue
    }
    pipelines.delete(key)
    try {
      const pipeline = await pending
      await pipeline.dispose()
    } catch {
      // A pipeline that never finished loading has nothing to release.
    }
  }

  // Something was mid-inference; try again when the queue drains.
  evictionPending = deferred
}

/** Runs `fn` while marking `key` busy, so eviction leaves it alone. */
async function withPipeline<T>(key: string, fn: () => Promise<T>): Promise<T> {
  busyKeys.add(key)
  try {
    return await fn()
  } finally {
    busyKeys.delete(key)
    if (evictionPending && busyKeys.size === 0) {
      evictionPending = false
      void evictExcept(key)
    }
  }
}

function cacheKey(modelId: string, backend: Backend) {
  return `${modelId}:${backend}`
}

async function buildPipeline(
  model: ModelDef,
  backend: Backend
): Promise<Pipeline> {
  const { AutoModel, AutoProcessor, RawImage, env } = await import(
    "@huggingface/transformers"
  )

  const weights = resolveWeights(model, backend)
  const variant = model.variants[backend]

  // Weights are fetched straight from R2 (or Hugging Face) by the browser —
  // never through one of our own Worker routes. See src/lib/weights.ts.
  env.allowLocalModels = false
  env.useBrowserCache = true
  env.remoteHost = weights.remoteHost
  env.remotePathTemplate = weights.remotePathTemplate
  // Shared with the model manager, which deletes this exact bucket.
  env.cacheKey = cacheKeyFor(model.id, backend)

  // Optionally load onnxruntime-web's own .wasm off-origin. Defaults to the
  // bundled static asset; see ortWasmPaths() for why an escape hatch exists.
  const wasmPaths = ortWasmPaths()
  if (wasmPaths) {
    ;(env.backends as any).onnx.wasm.wasmPaths = wasmPaths
  }

  postMessage({
    type: "init-start",
    gpu: backend === "webgpu",
    backend,
    modelId: model.id,
    modelLabel: model.label,
    dtype: variant.dtype,
    bytes: variant.bytes,
    weightsSource: weights.source,
  })

  const loaded = await AutoModel.from_pretrained(weights.modelId, {
    device: backend,
    dtype: variant.dtype,
    ...(variant.modelFileName ? { model_file_name: variant.modelFileName } : {}),
    progress_callback: (p: any) => {
      if (p.status === "progress") {
        postMessage({
          type: "download-progress",
          modelId: model.id,
          progress: p.progress || 0,
          file: describeFile(p.file),
          loaded: p.loaded,
          total: p.total,
        })
      }
    },
  })

  // Preprocessing is per-model — RMBG uses mean 0.5 / unit std, BiRefNet uses
  // ImageNet statistics. Passing the wrong one silently degrades the matte.
  const processor = await AutoProcessor.from_pretrained(weights.modelId, {
    config: { ...model.processor },
  })

  // Tensor names differ between models — RMBG-1.4 calls its input "input",
  // BiRefNet calls it "input_image" — so read them off the loaded graph rather
  // than hardcoding. Keeps adding a third model from breaking on a name.
  const session = (loaded as any).sessions?.model ?? (loaded as any).session
  const inputName: string = session?.inputNames?.[0] ?? "input"
  // BiRefNet emits several side outputs; the final refined map is the last one.
  const outputNames: string[] = session?.outputNames ?? ["output"]
  const outputName = outputNames[outputNames.length - 1]

  console.info(
    `[${model.id}/${backend}] input="${inputName}" outputs=[${outputNames.join(", ")}] using "${outputName}"`
  )

  const runInference = async (rawImg: any) => {
    const { pixel_values } = await processor(rawImg)
    const outputs = await loaded({ [inputName]: pixel_values })

    const tensor = outputs[outputName] ?? Object.values(outputs)[0]
    if (!tensor) {
      throw new Error(
        `Model ${model.id} returned no usable output (expected "${outputName}")`
      )
    }
    // Drop the batch dimension, then map to 0..1 alpha. BiRefNet emits logits;
    // reading those straight as 0-255 saturates to fully opaque.
    const batch = tensor[0]
    return model.outputActivation === "sigmoid" ? batch.sigmoid() : batch
  }

  // Warm up with a 1x1 image so shaders are compiled before the first real job.
  postMessage({ type: "warming-up", modelId: model.id })
  try {
    await runInference(new RawImage(new Uint8ClampedArray([128, 128, 128]), 1, 1, 3))
  } catch (warmupErr) {
    console.warn("Warmup inference notice:", warmupErr)
  }

  postMessage({
    type: "ready",
    gpu: backend === "webgpu",
    backend,
    modelId: model.id,
    modelLabel: model.label,
  })

  return {
    runInference,
    RawImage,
    backend,
    model,
    dispose: async () => {
      try {
        await (loaded as any).dispose?.()
      } catch {
        // Older builds expose no dispose; dropping the reference is all we can do.
      }
    },
  }
}

function describeFile(file?: string): string {
  if (!file) return "neural weights"
  if (file.endsWith(".onnx")) return "AI model weights"
  if (file.endsWith(".json")) return "model configuration"
  return "engine assets"
}

async function initPipeline(modelId: string): Promise<Pipeline> {
  const model = getModel(modelId)
  // Ask for an adapter before choosing anything. The variants differ per
  // backend — MODNet is 13 MiB fp16 on WebGPU and 6 MiB int8 on WASM — so
  // guessing wrong means downloading the wrong file and then failing to build a
  // session with it, which is what iOS Safari did.
  const backend = await probeBackend()
  const key = cacheKey(model.id, backend)

  let existing = pipelines.get(key)
  if (!existing) {
    // Free the space BEFORE allocating, not after.
    //
    // This used to evict once the new session had finished building, which
    // meant the peak was MAX_LIVE_PIPELINES + 1 — three sessions at a cap of
    // two. Three is exactly the count that produced `RuntimeError: memory
    // access out of bounds` and `getBindGroupLayout of undefined`, and it
    // explains why the crash only ever appeared while cycling models (running
    // the bench, or clicking through the picker) and never during ordinary use.
    //
    // Evicting to one below the cap first means a switch holds at most the cap,
    // and the await matters: the old session's GPU memory is released before
    // the new one asks for any.
    await evictExcept(key, MAX_LIVE_PIPELINES - 1)

    existing = buildPipeline(model, backend).catch((err) => {
      // Don't cache a failed load, or the user can never retry.
      pipelines.delete(key)
      throw err
    })
    pipelines.set(key, existing)
  }
  return existing
}

self.onmessage = async (e: MessageEvent) => {
  const {
    action,
    id,
    fileBlob,
    blobUrl,
    frame,
    // Same backend-aware default as the main thread, so a message that omits
    // modelId cannot resurrect the 214 MiB CPU path this fixes.
    modelId = defaultModelFor(detectBackend()),
  } = e.data

  // The worker is a separate realm with no localStorage, so the main thread
  // hands the override over rather than the worker reading it.
  if (action === "set-backend") {
    setBackendOverride(e.data.backend ?? null)
    // Sessions are keyed by model+backend, so anything already built belongs to
    // the old provider and has to go.
    for (const [key, pending] of [...pipelines.entries()]) {
      pipelines.delete(key)
      pending.then((p) => p.dispose()).catch(() => {})
    }
    postMessage({ type: "backend-changed", backend: detectBackend() })
    return
  }

  if (action === "init") {
    try {
      await initPipeline(modelId)
    } catch (err: any) {
      postMessage({
        type: "init-error",
        modelId,
        error: err?.message || String(err),
      })
    }
    return
  }

  // Live video path. A webcam frame must not go through Blob encode/decode —
  // that alone costs more than the inference. Raw RGBA arrives here as a
  // transferred buffer and is wrapped directly, and alpha refinement is skipped
  // because at these frame sizes there is no upscale blur to undo and the cost
  // would eat the frame budget.
  if (action === "segment-frame") {
    try {
      const pipeline = await initPipeline(modelId)
      const { runInference, RawImage } = pipeline

      const image = new RawImage(
        new Uint8ClampedArray(frame.data),
        frame.width,
        frame.height,
        frame.channels
      )

      const t0 = performance.now()
      const key = cacheKey(modelId, await probeBackend())
      const tTensor = await withPipeline(key, () => runInference(image))
      const mask = await RawImage.fromTensor(
        tTensor.mul(255).to("uint8")
      ).resize(frame.width, frame.height)
      const maskData = new Uint8Array(mask.data)
      const inferMs = performance.now() - t0

      ;(self as any).postMessage(
        {
          type: "frame-done",
          id,
          modelId,
          width: frame.width,
          height: frame.height,
          maskData: maskData.buffer,
          inferMs,
        },
        [maskData.buffer]
      )
    } catch (err: any) {
      postMessage({
        type: "frame-error",
        id,
        modelId,
        error: err?.message || String(err),
      })
    }
    return
  }

/**
 * Largest image the pipeline will process, in pixels.
 *
 * Nothing capped this before, and the failure mode was not a slow run but an
 * out-of-memory crash. Every stage allocates a full-resolution RGBA buffer —
 * the source, the cutout, the composite, and three to six more for depth-aware
 * blur — so a 24 MP photo asks for well over half a gigabyte before anything
 * has gone wrong.
 *
 * 12 MP is chosen to sit above what phone cameras actually produce (12 MP is
 * the common sensor size) and comfortably below Safari's per-canvas ceiling of
 * 16,777,216 pixels, which is the hard wall that turns this from slow into
 * broken.
 *
 * Capping here rather than on the main thread means everything downstream
 * follows automatically: the reported dimensions are the capped ones, so the
 * caller decodes the original at exactly the size the alpha was computed for.
 */
const MAX_PIXELS = 12_000_000

function capPixels(image: any, id: string) {
  const pixels = image.width * image.height
  if (pixels <= MAX_PIXELS) return image

  const scale = Math.sqrt(MAX_PIXELS / pixels)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  postMessage({
    type: "downscaled",
    id,
    from: { width: image.width, height: image.height },
    to: { width, height },
  })

  return image.resize(width, height)
}

  if (action === "segment") {
    const t0 = performance.now()
    try {
      const pipeline = await initPipeline(modelId)
      const { runInference, RawImage } = pipeline

      let image: any
      if (fileBlob) {
        image = await RawImage.fromBlob(fileBlob)
      } else if (blobUrl) {
        image = await RawImage.read(blobUrl)
      } else {
        throw new Error("No image provided to worker")
      }

      image = capPixels(image, id)

      postMessage({ type: "processing-start", id, modelId })

      const key = cacheKey(modelId, await probeBackend())
      let tTensor: any
      try {
        tTensor = await withPipeline(key, () => runInference(image))
      } catch (inferErr) {
        // A session whose inference threw is not necessarily usable again —
        // `getBindGroupLayout of undefined` and `memory access out of bounds`
        // both mean the GPU context underneath it is gone. Leaving the broken
        // pipeline in the map would make every later job fail the same way, so
        // drop it and let the next attempt rebuild from cached weights.
        pipelines.delete(key)
        throw inferErr
      }
      const mask = await RawImage.fromTensor(
        tTensor.mul(255).to("uint8")
      ).resize(image.width, image.height)

      // mask.data holds single-channel alpha values (0-255), width*height long.
      let maskData = new Uint8Array(mask.data)

      // The mask was inferred at the model's input size and scaled up to the
      // source dimensions, so on a large photo every edge is a soft bilinear
      // ramp. Snap it back to the image's real edges. No-ops under a 2x
      // upscale, where there is nothing to recover.
      // The material says what is being cut out, and that is what decides how
      // the edge is finished — see lib/recipe/materials.ts. `auto` reproduces
      // exactly what this did before materials existed.
      const material = materialById(e.data.material ?? "auto")
      const strength = typeof e.data.edgeStrength === "number" ? e.data.edgeStrength : 1

      const tRefine = performance.now()
      const refined = refineAlpha(
        maskData,
        image.data as Uint8Array,
        image.channels as number,
        image.width as number,
        image.height as number,
        material.refine
      )
      const refineMs = performance.now() - tRefine
      const didRefine = refined !== maskData
      maskData = refined
      if (didRefine) {
        console.info(
          `[${modelId}] refined ${image.width}x${image.height} alpha in ${refineMs.toFixed(0)}ms (${material.id})`
        )
      }

      // Snap and unmix, after refinement and only inside the uncertain band.
      // Scaled by `strength` so a family like "hair" is a starting point rather
      // than one fixed amount.
      if (material.snap > 0 || material.unmix > 0) {
        const tMat = performance.now()
        const scaled = {
          ...material,
          snap: Math.round(material.snap * strength),
          unmix: Math.min(1, material.unmix * strength),
        }
        const { snapped, unmixed } = applyMaterial(
          maskData,
          image.data as Uint8Array,
          image.channels as number,
          scaled
        )
        console.info(
          `[${modelId}] ${material.id}: snapped ${snapped}, unmixed ${unmixed} in ${(performance.now() - tMat).toFixed(0)}ms`
        )
      }

      const duration = ((performance.now() - t0) / 1000).toFixed(2)

      ;(self as any).postMessage(
        {
          type: "segment-done",
          id,
          modelId,
          width: image.width,
          height: image.height,
          maskData: maskData.buffer,
          duration,
        },
        [maskData.buffer]
      )
    } catch (err: any) {
      console.error("Worker segmentation failed:", err)
      postMessage({
        type: "segment-error",
        id,
        modelId,
        error: err?.message || String(err),
      })
    }
  }
}
