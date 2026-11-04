// Where model weights come from.
//
// Production: an R2 bucket on its own custom domain. The browser fetches weights
// directly from R2, so these requests never invoke a Worker and never count
// against the 100,000/day free-plan request budget. R2 egress is always free and
// reads are Class B operations (10M/month free).
//
// Dev / no bucket yet: Hugging Face directly. Also zero Cloudflare usage.
//
// What must never come back: proxying weights through our own Worker route. That
// spends metered requests on immutable files that a CDN can serve for free.

import type { Backend, ModelDef } from "./models"

/** Set to the R2 bucket's custom domain, e.g. https://weights.remove.free */
const R2_BASE_URL = (
  import.meta.env?.VITE_WEIGHTS_BASE_URL ?? ""
).replace(/\/$/, "")

export type WeightsSource = "r2" | "huggingface"

export function weightsSource(): WeightsSource {
  return R2_BASE_URL ? "r2" : "huggingface"
}

export interface WeightsResolution {
  source: WeightsSource
  /** Repo id handed to from_pretrained. */
  modelId: string
  /** transformers.js env.remoteHost */
  remoteHost: string
  /** transformers.js env.remotePathTemplate */
  remotePathTemplate: string
}

/**
 * transformers.js builds weight URLs from a single global template, so the
 * repo id we pass has to match whichever layout we're serving.
 *
 *   R2:  {base}/{our-model-id}/onnx/{file}
 *   HF:  https://huggingface.co/{upstream-repo}/resolve/main/onnx/{file}
 */
export function resolveWeights(
  model: ModelDef,
  backend: Backend
): WeightsResolution {
  if (R2_BASE_URL) {
    return {
      source: "r2",
      // Mirrored per model AND backend, since a model may need a different
      // export per backend (see ModelVariant.repo).
      modelId: `${model.id}/${backend}`,
      remoteHost: R2_BASE_URL,
      remotePathTemplate: "{model}/",
    }
  }

  return {
    source: "huggingface",
    modelId: model.variants[backend].repo ?? model.upstream,
    remoteHost: "https://huggingface.co",
    remotePathTemplate: "{model}/resolve/{revision}/",
  }
}

/** Direct URL to one weight file. Used by the diagnostics panel and preflight checks. */
export function weightUrl(
  model: ModelDef,
  backend: Backend,
  file = model.variants[backend].file
): string {
  const r = resolveWeights(model, backend)
  return r.source === "r2"
    ? `${R2_BASE_URL}/${model.id}/${backend}/onnx/${file}`
    : `https://huggingface.co/${r.modelId}/resolve/main/onnx/${file}`
}

/**
 * Where onnxruntime-web loads its own .wasm runtime from.
 *
 * By default the wasm ships as a static asset, which works and is free — but it
 * is the single largest file in the deploy and Cloudflare rejects any static
 * asset over 25 MiB. The margin is thin: the bundled `asyncify` build is 22.5
 * MiB (90% of the cap) and onnxruntime-web's `jsep` build is 24.9 MiB, i.e.
 * within 113 KB of it. An upstream version bump can therefore break a deploy
 * outright rather than degrade.
 *
 * Setting VITE_ORT_WASM_BASE_URL moves those files off static assets (R2, say)
 * and removes the cap from the picture entirely. It must point at a directory
 * holding the .wasm files for the EXACT installed onnxruntime-web version —
 * a mismatch fails at runtime, not at build — so version the path.
 */
const ORT_WASM_BASE_URL = (
  import.meta.env?.VITE_ORT_WASM_BASE_URL ?? ""
).replace(/\/$/, "")

/** Returns a wasmPaths value for transformers.js, or null to use the bundled asset. */
export function ortWasmPaths(): string | null {
  return ORT_WASM_BASE_URL ? `${ORT_WASM_BASE_URL}/` : null
}
