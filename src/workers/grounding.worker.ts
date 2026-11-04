// Grounding DINO tiny: offline text -> boxes, in its own worker.
//
// This is the no-key fallback for text selection, and it is deliberately
// opt-in: the smallest usable quantisation is 151 MiB, against 13 MiB for
// SlimSAM. It only ever finds boxes; SlimSAM turns box centres into masks,
// exactly like the DINOv2 similarity seeds.
//
// Model: onnx-community/grounding-dino-tiny-ONNX (Apache-2.0; upstream
// IDEA-Research/grounding-dino-tiny). WebGPU only for now — the WASM
// quantisation is 204 MiB and slow enough to be a trap.

import { filterBoxes } from "../lib/grounding"

const MODEL_ID = "onnx-community/grounding-dino-tiny-ONNX"

let pipePromise: Promise<any> | null = null
let pipeDevice: "webgpu" | "wasm" = "webgpu"

async function buildPipe(device: "webgpu" | "wasm") {
  const { pipeline, env } = await import("@huggingface/transformers")

  env.allowLocalModels = false
  env.useBrowserCache = true
  env.cacheKey = "remove-free-grounding-dino"

  postMessage({ type: "grounding-loading", device })

  const pipe = await pipeline("zero-shot-object-detection", MODEL_ID, {
    // q4f16 on GPU; the CPU quantised build on WASM. The GPU graph currently
    // fails inside ORT's Gather kernel on some drivers (measured in Chrome:
    // "indices element out of data bounds"), so WASM is a real fallback,
    // not a formality — see the retry in grounding-detect.
    dtype: device === "webgpu" ? "q4f16" : "q8",
    device,
    progress_callback: (p: any) => {
      if (p.status === "progress") {
        postMessage({ type: "grounding-progress", progress: p.progress || 0 })
      }
    },
  })

  postMessage({ type: "grounding-ready", device })
  return pipe
}

function getPipe(device: "webgpu" | "wasm" = pipeDevice) {
  if (pipePromise && device === pipeDevice) return pipePromise
  pipeDevice = device
  pipePromise = buildPipe(device).catch((err) => {
    pipePromise = null
    postMessage({ type: "grounding-error", error: err?.message || String(err) })
    throw err
  })
  return pipePromise
}

self.onmessage = async (e: MessageEvent) => {
  const { action, id } = e.data

  try {
    if (action === "grounding-init") {
      await getPipe()
      return
    }

    if (action === "grounding-detect") {
      const { RawImage } = await import("@huggingface/transformers")

      const makeImage = () =>
        new RawImage(
          new Uint8ClampedArray(e.data.frame.data),
          e.data.frame.width,
          e.data.frame.height,
          4
        )

      // Grounding DINO's text query must be lowercase and end with a dot
      // ("a cat." per the model card). Without it the tokenizer produces a
      // sequence the graph's Gather node rejects outright — measured:
      // "indices element out of data bounds" on both backends.
      const phrase = e.data.prompt.toLowerCase().trim().replace(/\.+$/, "") + "."

      const t0 = performance.now()
      let out: any
      try {
        const pipe = await getPipe()
        out = await pipe(makeImage(), [phrase], { threshold: 0.25 })
      } catch (err) {
        // GPU kernel failure (see buildPipe): rebuild on WASM and retry once.
        if (pipeDevice !== "webgpu") throw err
        postMessage({ type: "grounding-progress", progress: 0 })
        const pipe = await getPipe("wasm")
        out = await pipe(makeImage(), [phrase], { threshold: 0.25 })
      }

      const boxes = filterBoxes(
        (out as any[]).map((r) => ({
          label: String(r.label ?? e.data.prompt),
          score: Number(r.score ?? 0),
          box: {
            xmin: Number(r.box.xmin),
            ymin: Number(r.box.ymin),
            xmax: Number(r.box.xmax),
            ymax: Number(r.box.ymax),
          },
        }))
      )

      postMessage({
        type: "grounding-boxes",
        id,
        boxes,
        width: e.data.frame.width,
        height: e.data.frame.height,
        ms: performance.now() - t0,
      })
      return
    }
  } catch (err: any) {
    postMessage({ type: "grounding-error", id, error: err?.message || String(err) })
  }
}

export {}
