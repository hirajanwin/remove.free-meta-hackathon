// Depth model registry.
//
// Separate from the matting registry in `models.ts` because the two answer
// different questions: that one picks which pixels are the subject, this one
// how far away each pixel is. They also run in separate workers for a reason
// documented there — depth has to stay resident next to whichever matting model
// is live.
//
// Every size below was read off the repo's own file listing rather than
// estimated, because the download is the single biggest thing a visitor pays
// for and a wrong number here is a promise we break.

export type DepthDtype = "fp32" | "fp16" | "q8" | "q4f16"

export interface DepthModelDef {
  id: string
  label: string
  /** Hugging Face repo. Also the attribution. */
  repo: string
  tagline: string
  license: { id: string; name: string; url: string; allowsCommercialUse: boolean }
  /**
   * What the numbers mean.
   *
   * `relative` is inverse depth normalised per image: useful for ordering
   * surfaces, meaningless as a distance. `metric` is an actual distance, so two
   * images from the same model are comparable — which is what you need if the
   * map is going anywhere near a 3D pipeline.
   *
   * Every shipped model is `relative` today. The distinction stays because it
   * is the most important thing to know about a depth map and the moment a
   * metric model becomes usable in a browser it belongs here — see
   * REJECTED_DEPTH_MODELS for why the one candidate did not make it.
   */
  kind: "relative" | "metric"
  /** dtype and download size per backend. */
  variants: Record<"webgpu" | "wasm", { dtype: DepthDtype; bytes: number }>
  /** The resolution the model resizes its input to internally. */
  inputSize: number
  /** Honest note about when not to pick this one. */
  caveat?: string
}

const APACHE_2 = {
  id: "Apache-2.0",
  name: "Apache License 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  allowsCommercialUse: true,
}

const CC0 = {
  id: "CC0-1.0",
  name: "CC0 1.0 Universal (public domain)",
  url: "https://creativecommons.org/publicdomain/zero/1.0/",
  allowsCommercialUse: true,
}

export const DEPTH_MODELS: DepthModelDef[] = [
  {
    id: "depth-anything-v2-small",
    label: "Depth Anything V2 Small",
    repo: "onnx-community/depth-anything-v2-small",
    tagline:
      "The default. Already on your disk if you have used the Blur backdrop, so usually a free choice.",
    license: APACHE_2,
    kind: "relative",
    variants: {
      // 19.1 MiB at q4f16, 27.3 MiB at q8 — the two smallest builds that hold
      // up. fp32 is 99.1 MiB for detail this model does not have to give.
      webgpu: { dtype: "q4f16", bytes: 20_027_000 },
      wasm: { dtype: "q8", bytes: 28_626_000 },
    },
    inputSize: 518,
  },
  {
    id: "depth-anything-v2-base",
    label: "Depth Anything V2 Base",
    repo: "onnx-community/depth-anything-v2-base",
    tagline:
      "Same family, four times the parameters. Cleaner edges on hair and foliage, and it separates surfaces the small model flattens together.",
    license: APACHE_2,
    kind: "relative",
    variants: {
      webgpu: { dtype: "q4f16", bytes: 76_021_000 },
      wasm: { dtype: "q8", bytes: 106_954_000 },
    },
    inputSize: 518,
    // Measured rather than inferred from the parameter count, which is what I
    // had written first and got wrong. Same image (512px), warm session,
    // WebGPU, four runs each: Small 161-202 ms (median 178), Base 248-285 ms
    // (median 252). So 1.4x the time, not the 4x the parameter count suggests
    // — the extra depth is nearly free on a GPU because it is more work per
    // layer rather than a longer dependency chain. The download really is 3.8x.
    caveat:
      "3.8× the download of Small for about 1.4× the inference time (measured: 252 ms against 178 ms, same image, warm, WebGPU). Worth it if you are exporting; not worth it to steer a blur.",
  },
]

export const DEFAULT_DEPTH_MODEL_ID = "depth-anything-v2-small"

export function depthModelById(id: string): DepthModelDef {
  return DEPTH_MODELS.find((m) => m.id === id) ?? DEPTH_MODELS[0]
}

/**
 * The CacheStorage bucket a depth model's weights live in.
 *
 * Shaped like `cacheKeyFor` in the matting registry so the Model Storage page
 * can find, size and delete these too.
 *
 * Note for anyone who used the Blur backdrop before this existed: the depth
 * worker set no `cacheKey` at all back then, so its weights went into
 * transformers.js's own default `transformers-cache` bucket. That bucket is now
 * an orphan — the Model Storage page lists it under "Unrecognised caches" with
 * a Remove button, which is exactly the case that section was built for.
 */
export function depthCacheKeyFor(modelId: string, backend: "webgpu" | "wasm"): string {
  return `remove-free-depth-${modelId}-${backend}`
}

/**
 * Models evaluated and left out, so the reasoning is not lost.
 *
 * - **Apple DepthPro** (`onnx-community/DepthPro-ONNX`) is the best-looking
 *   monocular depth available and its smallest build is 600 MiB, with the fp32
 *   weights in a 3.8 GB external data file. That is not a download to hand
 *   someone on a page that promises to be quick.
 * - **Depth Anything V2 Large** is 389 MiB at fp32 and ~250 MiB quantised, for
 *   a gain over Base that does not show at web resolutions.
 * - **Depth Anything V3 Small** (`en970/depth-anything-v3-small-onnx`,
 *   Apache-2.0, 28.9 MiB int8) is newer and the reported fidelity is good, but
 *   it is one person's export with a few hundred downloads rather than an
 *   onnx-community build. Worth revisiting; not worth making the default on
 *   someone else's benchmark.
 * - **GLPN, DPT-large, DPT-hybrid-MiDaS** are all older than Depth Anything V2
 *   and larger for worse output.
 * - **Metric3D ViT Small** (`onnx-community/metric3d-vit-small`, CC0) was the
 *   one I most wanted, because it predicts actual distance rather than a
 *   per-image ramp and nothing else on the list does. It is out because it
 *   does not run. Its published fp16 build fails at inference with
 *
 *     Unexpected input data type. Actual: (tensor(float)),
 *     expected: (tensor(float16))
 *
 *   — the weights were cast to fp16 without a matching cast on the graph's
 *   input, so it demands fp16 tensors while transformers.js's image processor
 *   produces fp32. Nothing on our side bridges that; it needs a re-export
 *   upstream. Its fp32 build is 151 MiB and I could not get it to return a
 *   single map: the download completed and inference then produced neither a
 *   result nor an error, over several minutes. That may well be this test
 *   environment rather than the model, but a 151 MiB download with no evidence
 *   it works is not something to put in front of anyone. Worth revisiting if a
 *   quantised export appears.
 */
export const REJECTED_DEPTH_MODELS = [
  "onnx-community/DepthPro-ONNX",
  "onnx-community/metric3d-vit-small",
  "onnx-community/depth-anything-v2-large",
  "en970/depth-anything-v3-small-onnx",
  "Xenova/dpt-large",
] as const
