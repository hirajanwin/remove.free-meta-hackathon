// RobustVideoMatting: video matting with actual temporal memory.
//
// Every other model here is an image model applied per frame, which is the
// known weakness of this approach on real footage — nothing carries between
// frames, so the matte can shimmer where the subject moves. RVM is recurrent:
// four hidden-state tensors flow out of each frame and back into the next, so
// the model remembers what it just saw.
//
// It does not go through transformers.js, which has no RVM architecture. This
// drives onnxruntime-web directly.
//
//   inputs   src [1,3,H,W]  r1i r2i r3i r4i  downsample_ratio
//   outputs  fgr [1,3,H,W]  pha [1,1,H,W]    r1o r2o r3o r4o
//
// Licensed GPL-3.0, unlike everything else here — kept deliberately, since the
// alternative is per-frame flicker on moving footage.
//
// The fp32 export is used rather than fp16 (14.3 MiB vs 7.2 MiB): JavaScript
// has no native half type, so fp16 would mean hand-packing every input tensor
// into Uint16Array for no gain at this size.

import type { InferenceSession, Tensor as OrtTensor } from "onnxruntime-web"
import { ortWasmPaths } from "../lib/weights"

/**
 * Where the weights live. GitHub's release assets send no
 * Access-Control-Allow-Origin, so the file cannot be fetched from a browser
 * and has to be self-hosted. See scripts/sync-weights.mjs.
 */
const MODEL_URL =
  (import.meta as any).env?.VITE_RVM_URL || "/models/rvm_mobilenetv3_fp32.onnx"

/**
 * RVM runs on WASM, not WebGPU.
 *
 * ONNX Runtime's WebGPU provider computes this graph incorrectly. On an
 * identical frame the alpha histogram (% of pixels per 32-wide bucket) was:
 *
 *   wasm     52.9  0.2 0.2 0.1 0.2 0.2 0.2  46.0   <- clean matte
 *   webgpu   64.8  3.7 3.8 4.6 11.2 6.9 3.2  1.8   <- washed out, 1.8% opaque
 *
 * The wasm result matches MODNet's shape on the same image (52.8 / 45.8), so
 * the model and the pre/post-processing are right and the backend is wrong.
 * WASM costs ~303ms a frame against WebGPU's ~30-80ms, which is an acceptable
 * trade for an offline export that is actually correct.
 */
let e_forcedProvider: string | null = "wasm"

let ort: typeof import("onnxruntime-web") | null = null
let session: InferenceSession | null = null
let loading: Promise<InferenceSession> | null = null

/** Recurrent state carried between frames. */
let state: Record<string, OrtTensor> | null = null

async function getSession(): Promise<InferenceSession> {
  if (session) return session
  if (loading) return loading

  loading = (async () => {
    ort = await import("onnxruntime-web/webgpu")
    postMessage({ type: "rvm-loading" })

    // This project builds against onnxruntime-web's "extern wasm" variant, so
    // the runtime is not bundled and every consumer has to say where it lives.
    // transformers.js does this for its own ORT instance; ours is separate and
    // would otherwise fail with "no available backend found".
    if (!ort.env.wasm.wasmPaths) {
      ort.env.wasm.wasmPaths =
        ortWasmPaths() ??
        `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ort.env.versions.web}/dist/`
    }

    const providers: any[] = (e_forcedProvider ? [e_forcedProvider] : ["webgpu", "wasm"]) as any
    const created = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: providers,
      graphOptimizationLevel: "all",
    })

    session = created
    postMessage({
      type: "rvm-ready",
      inputs: created.inputNames,
      outputs: created.outputNames,
    })
    return created
  })().catch((err) => {
    loading = null
    postMessage({ type: "rvm-error", error: err?.message || String(err) })
    throw err
  })

  return loading
}

/**
 * Reset the recurrent memory.
 *
 * Essential between clips, and after a seek: carrying state across a cut makes
 * the model blend two unrelated scenes for several frames.
 */
function resetState() {
  state = null
}

/**
 * Initial recurrent state for the first frame of a clip.
 *
 * A single zero shaped [1,1,1,1] — RVM broadcasts it and allocates the real
 * state itself. A zero-LENGTH array is rejected: ORT checks data length against
 * the declared shape ("Tensor's size(1) does not match data length(0)").
 */
function initialState(o: typeof import("onnxruntime-web")) {
  const zero = () => new o.Tensor("float32", new Float32Array(1), [1, 1, 1, 1])
  return { r1i: zero(), r2i: zero(), r3i: zero(), r4i: zero() }
}

self.onmessage = async (e: MessageEvent) => {
  const { action, id } = e.data

  try {
    if (action === "rvm-init") {
      await getSession()
      return
    }

    if (action === "rvm-force-provider") {
      e_forcedProvider = e.data.provider ?? null
      session = null
      loading = null
      state = null
      postMessage({ type: "rvm-reset-done", id })
      return
    }

    if (action === "rvm-reset") {
      resetState()
      postMessage({ type: "rvm-reset-done", id })
      return
    }

    if (action === "rvm-frame") {
      const sess = await getSession()
      if (!ort) throw new Error("Runtime not loaded")

      const { width, height, downsampleRatio = 0.4 } = e.data
      const rgba = new Uint8ClampedArray(e.data.frame)

      // RGBA bytes -> planar CHW float32 in 0..1, which is what `src` expects.
      const plane = width * height
      const src = new Float32Array(plane * 3)
      for (let i = 0, p = 0; i < plane; i++, p += 4) {
        src[i] = rgba[p] / 255
        src[plane + i] = rgba[p + 1] / 255
        src[plane * 2 + i] = rgba[p + 2] / 255
      }

      const prev = state ?? initialState(ort)
      const feeds: Record<string, OrtTensor> = {
        src: new ort.Tensor("float32", src, [1, 3, height, width]),
        r1i: prev.r1i,
        r2i: prev.r2i,
        r3i: prev.r3i,
        r4i: prev.r4i,
        // Rank 1, not a scalar: the graph declares shape [1] and ORT rejects
        // rank 0 with "Invalid rank for input: downsample_ratio".
        downsample_ratio: new ort.Tensor(
          "float32",
          new Float32Array([downsampleRatio]),
          [1]
        ),
      }

      const t0 = performance.now()
      const out = await sess.run(feeds)
      const inferMs = performance.now() - t0

      // Carry the recurrent outputs into the next frame. This is the whole
      // point of the model: r*o becomes r*i.
      state = {
        r1i: out.r1o,
        r2i: out.r2o,
        r3i: out.r3o,
        r4i: out.r4o,
      }

      const pha = out.pha.data as Float32Array
      const alpha = new Uint8Array(plane)
      for (let i = 0; i < plane; i++) {
        const v = pha[i]
        alpha[i] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0
      }

      const buffer = alpha.buffer
      ;(self as any).postMessage(
        { type: "rvm-alpha", id, width, height, inferMs, maskData: buffer },
        [buffer]
      )
      return
    }
  } catch (err: any) {
    postMessage({ type: "rvm-error", id, error: err?.message || String(err) })
  }
}
