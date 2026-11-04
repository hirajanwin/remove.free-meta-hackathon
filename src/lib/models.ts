// Model registry.
//
// Every model here runs on BOTH backends (WebGPU and WASM). The backend is a
// property of the device; the model is the user's choice. What genuinely differs
// per model is the preprocessing and which quantisation we ship per backend, so
// both live here rather than being hardcoded in the worker.
//
// Weights are served from R2 (see scripts/sync-weights.mjs). Nothing in this
// file may point at a metered Worker route.

export type Backend = "webgpu" | "wasm"

export type Dtype = "fp32" | "fp16" | "q8"

export interface ModelVariant {
  /** dtype passed to transformers.js for this backend. */
  dtype: Dtype
  /** File inside the repo's onnx/ directory. */
  file: string
  /** Download size in bytes, from the upstream repo. Used for UI estimates. */
  bytes: number
  /**
   * Source repo for this backend, when it differs from the model's default.
   *
   * Needed because a stock ONNX export is not necessarily WebGPU-runnable: the
   * onnx-community BiRefNet export compiles a shader wanting 11 storage buffers
   * per stage, and common GPUs (Apple Metal included) cap that at 10, so it
   * fails at inference with "Too many storage buffers in shader". Repos exist
   * that re-export the same weights within WebGPU's limits.
   */
  repo?: string
  /**
   * Explicit `model_file_name` for transformers.js. Needed when the file's name
   * already encodes its precision — passing dtype alone makes the library
   * append a second suffix and look for e.g. model_fp16_fp16.onnx.
   */
  modelFileName?: string
  /**
   * The weights' actual precision, when it differs from `dtype`.
   *
   * BiRefNet's WebGPU file is fp16 but has to be requested as "fp32", because
   * the name already carries the suffix and transformers.js would otherwise
   * look for model_fp16_fp16.onnx. Reporting the argument as though it were the
   * precision tells the user the download is twice the width it is.
   */
  precision?: Dtype
}

export interface License {
  id: string
  name: string
  url: string
  /** False means the model may not be used for commercial advantage. */
  allowsCommercialUse: boolean
}

/**
 * Preprocessing. These values are NOT interchangeable between models — feeding
 * RMBG's normalisation to BiRefNet produces a visibly degraded matte, so each
 * model carries the config from its own preprocessor_config.json.
 */
export interface ProcessorConfig {
  do_normalize: boolean
  do_pad: boolean
  do_rescale: boolean
  do_resize: boolean
  image_mean: [number, number, number]
  image_std: [number, number, number]
  feature_extractor_type: string
  resample: number
  rescale_factor: number
  /**
   * Either a fixed square (BiRefNet, RMBG) or a shortest-edge target that
   * preserves aspect ratio (MODNet). The fixed form resizes a portrait photo
   * into a square, which distorts the subject before inference; shortest_edge
   * avoids that.
   */
  size: { width: number; height: number } | { shortest_edge: number }
  /** Round the resized dimensions to a multiple of this. Required by MODNet. */
  size_divisibility?: number
}

export interface ModelDef {
  /** Stable id. Doubles as the R2 key prefix, so never rename without migrating. */
  id: string
  label: string
  tagline: string
  /** Upstream Hugging Face repo. Source of truth for the sync script and for attribution. */
  upstream: string
  license: License
  /** Credit line shown in the UI. Required by attribution-style licenses. */
  attribution: string
  processor: ProcessorConfig
  /**
   * Activation to apply to the raw graph output before reading it as alpha.
   *
   * RMBG-1.4 bakes the sigmoid into its graph, so its output is already 0..1.
   * BiRefNet emits raw logits — reading those directly as 0-255 saturates to
   * fully opaque and removes nothing at all.
   */
  outputActivation: "none" | "sigmoid"
  variants: Record<Backend, ModelVariant>
  /** Honest warning surfaced in the UI when a backend/model pair is a poor fit. */
  caveats?: Partial<Record<Backend, string>>
}

const MIT: License = {
  id: "MIT",
  name: "MIT",
  url: "https://opensource.org/license/mit",
  allowsCommercialUse: true,
}

const APACHE_2: License = {
  id: "Apache-2.0",
  name: "Apache License 2.0",
  url: "https://www.apache.org/licenses/LICENSE-2.0",
  allowsCommercialUse: true,
}

// RVM ships under GPL-3.0. Recorded because the manager states a license for
// every download, and an unstated one reads as permissive.
const GPL_3: License = {
  id: "GPL-3.0",
  name: "GNU General Public License v3.0",
  url: "https://www.gnu.org/licenses/gpl-3.0.html",
  allowsCommercialUse: true,
}

const CC_BY_NC_4: License = {
  id: "CC-BY-NC-4.0",
  name: "Creative Commons Attribution-NonCommercial 4.0",
  url: "https://creativecommons.org/licenses/by-nc/4.0/",
  allowsCommercialUse: false,
}

export const MODELS: ModelDef[] = [
  {
    // Tiny, permissive and battle-tested (~99k downloads). At 6 MiB quantised it
    // is ~14x smaller than BiRefNet, which is the difference between a visitor
    // waiting half a minute for their first cutout and waiting a second or two.
    // Trained for portrait matting, so it is the fast default for people shots
    // rather than a general-purpose replacement.
    id: "modnet",
    label: "MODNet",
    tagline: "Instant load, tuned for people. Apache-2.0.",
    upstream: "Xenova/modnet",
    license: APACHE_2,
    attribution:
      "MODNet by Zhanghan Ke et al., ONNX conversion by Xenova. Apache-2.0 licensed.",
    // From Xenova/modnet/preprocessor_config.json — mean and std both 0.5, and
    // dynamic sizing on the shortest edge rather than a fixed square.
    processor: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [0.5, 0.5, 0.5],
      feature_extractor_type: "ImageFeatureExtractor",
      resample: 2,
      rescale_factor: 1 / 255,
      size: { shortest_edge: 512 },
      size_divisibility: 32,
    },
    outputActivation: "none",
    variants: {
      webgpu: { dtype: "fp16", file: "model_fp16.onnx", bytes: 13_002_342 },
      wasm: { dtype: "q8", file: "model_quantized.onnx", bytes: 6_606_028 },
    },
  },
  {
    id: "birefnet-lite",
    label: "BiRefNet Lite",
    tagline: "Best edges on hair, fur and fine detail. MIT licensed.",
    upstream: "onnx-community/BiRefNet_lite-ONNX",
    license: MIT,
    attribution:
      "BiRefNet by Peng Zheng et al., ONNX conversion by onnx-community. MIT licensed.",
    // From onnx-community/BiRefNet_lite-ONNX/preprocessor_config.json — ImageNet
    // normalisation, unlike RMBG below.
    processor: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.485, 0.456, 0.406],
      image_std: [0.229, 0.224, 0.225],
      feature_extractor_type: "ImageFeatureExtractor",
      resample: 2,
      rescale_factor: 1 / 255,
      size: { width: 1024, height: 1024 },
    },
    outputActivation: "sigmoid",
    variants: {
      // A WebGPU-constrained re-export. The onnx-community graph exceeds the
      // maxStorageBuffersPerShaderStage limit on common GPUs and cannot run.
      webgpu: {
        // The file is already fp16; declaring fp16 too would make
        // transformers.js look for model_fp16_fp16.onnx. Per the repo's README.
        dtype: "fp32",
        precision: "fp16",
        modelFileName: "model_fp16",
        file: "model_fp16.onnx",
        bytes: 114_556_928,
        repo: "jiabins0303/birefnet-lite-1024-webgpu",
      },
      // Upstream ships no int8 export, so WASM has to run fp32: a much bigger
      // download and far slower inference. Offered, but flagged as such.
      wasm: { dtype: "fp32", file: "model.onnx", bytes: 223_985_664 },
    },
    caveats: {
      wasm: "No int8 export exists upstream, so CPU mode downloads 214 MiB and runs slowly. RMBG is the better CPU choice.",
    },
  },
  {
    id: "rmbg-1.4",
    label: "RMBG 1.4",
    tagline: "Smallest and fastest. Non-commercial use only.",
    upstream: "briaai/RMBG-1.4",
    license: CC_BY_NC_4,
    attribution:
      "RMBG v1.4 by BRIA AI, used under CC BY-NC 4.0. Non-commercial use only.",
    // From briaai/RMBG-1.4/preprocessor_config.json — mean 0.5, unit std.
    processor: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [1, 1, 1],
      feature_extractor_type: "ImageFeatureExtractor",
      resample: 2,
      rescale_factor: 1 / 255,
      size: { width: 1024, height: 1024 },
    },
    outputActivation: "none",
    variants: {
      webgpu: { dtype: "fp16", file: "model_fp16.onnx", bytes: 88_186_880 },
      wasm: { dtype: "q8", file: "model_quantized.onnx", bytes: 44_355_584 },
    },
  },
]

export const DEFAULT_MODEL_ID = "birefnet-lite"

/**
 * The CacheStorage bucket a model's weights live in.
 *
 * This is `env.cacheKey` for transformers.js, and it is the same string the
 * model manager deletes to reclaim the space — so it has to be defined once.
 * It was previously written out inline in the worker, which meant the manager
 * could have shipped deleting a bucket nobody was writing to.
 *
 * Never change the shape of this: a rename does not migrate anything, it just
 * orphans every already-downloaded model on every existing device.
 */
export function cacheKeyFor(modelId: string, backend: Backend): string {
  return `remove-free-${modelId}-${backend}`
}

/**
 * Models that are not the user's choice of matting network but are still real
 * downloads sitting on their disk: the refine brush's segmenter, the depth
 * network behind the bokeh background, and the video matting model.
 *
 * They belong in the manager for exactly one reason — someone who never uses
 * the refine brush should be able to see the 40 MiB it took and get it back.
 */
export interface AuxModelDef {
  id: string
  label: string
  /** What in the product pulls this download in. */
  usedFor: string
  upstream: string
  license: License
  /** Approximate download, in bytes. */
  bytes: number
  /**
   * The CacheStorage bucket, or null when the weights are not in CacheStorage
   * at all and therefore cannot be removed from script.
   */
  cacheKey: string | null
  /** Stated when cacheKey is null, so the UI can explain rather than hide it. */
  notRemovableBecause?: string
}

export const AUX_MODELS: AuxModelDef[] = [
  {
    id: "slimsam",
    label: "SlimSAM 77",
    usedFor: "Refine brush — click-to-select subject regions",
    upstream: "Xenova/slimsam-77-uniform",
    license: APACHE_2,
    bytes: 41_000_000,
    cacheKey: "remove-free-slimsam",
  },
  {
    id: "grounding-dino",
    label: "Grounding DINO Tiny",
    usedFor: "Offline text select — boxes that seed SlimSAM masks",
    upstream: "onnx-community/grounding-dino-tiny-ONNX",
    license: APACHE_2,
    bytes: 151_100_000,
    cacheKey: "remove-free-grounding-dino",
  },
  {
    id: "dinov2",
    label: "DINOv2 Small",
    usedFor: "Refine brush — shift-click to select everything similar",
    upstream: "Xenova/dinov2-small",
    license: APACHE_2,
    bytes: 12_300_000,
    cacheKey: "remove-free-dinov2",
  },
  // Depth models used to be listed here as one lumped row pointing at
  // transformers.js's default bucket, because the depth worker set no cacheKey.
  // They have their own registry and their own section on the storage page now
  // — per model AND backend, like the matting ones. Anyone who used the Blur
  // backdrop before that change has weights in the old `transformers-cache`
  // bucket; it shows up under "Unrecognised caches" with a Remove button, which
  // is precisely the case that section was built for.
  {
    id: "rvm",
    label: "Robust Video Matting",
    usedFor: "Video cutout — temporally stable per-frame matting",
    upstream: "https://github.com/PeterL1n/RobustVideoMatting",
    license: GPL_3,
    bytes: 15_000_000,
    cacheKey: null,
    notRemovableBecause:
      "Loaded directly by onnxruntime-web rather than transformers.js, so it sits in the browser's ordinary HTTP cache. Scripts cannot delete that; clearing site data does.",
  },
]

/**
 * CacheStorage buckets that belong to the app itself, not to a model.
 *
 * The manager needs this to stay away from them: the shell and runtime caches
 * are what make the app work offline, and the share cache holds an image
 * someone is mid-way through sending us. `remove-free-` is a prefix both
 * models and app caches use, so a prefix match alone would have offered to
 * delete the app.
 */
export function isAppCache(name: string): boolean {
  return (
    name.startsWith("remove-free-shell-") ||
    name.startsWith("remove-free-runtime-") ||
    name === "remove-free-share"
  )
}

/**
 * The model to start on, given what the device can actually run.
 *
 * This used to be a constant, which quietly made the worst case the default.
 * BiRefNet has no int8 export upstream, so on a device without WebGPU it falls
 * back to fp32: a 214 MiB download before the first cutout, then CPU inference
 * slow enough that nobody waits for it.
 *
 * The CPU replacement was RMBG on the strength of a comment in this file
 * ("RMBG is the better CPU choice") and its download size. Then the CPU path was
 * actually run — same photo, warm session, WASM provider forced:
 *
 *   MODNet   3.84 s    6 MiB   Apache-2.0
 *   RMBG    22.47 s   42 MiB   CC BY-NC 4.0
 *
 * Six times faster, seven times smaller, and permissively licensed. The GPU
 * bench says MODNet is the weaker matte — it keeps 23.6% of the frame where the
 * other two agree on ~28%, because it is a portrait model — but 22 s is not a
 * result most people wait for, and a good matte nobody sees is worth nothing.
 * RMBG and BiRefNet stay one click away in the picker for anyone who wants to
 * wait.
 *
 * Choosing on measurement also removed a wart the size-based guess had
 * introduced: CPU visitors are no longer defaulted onto a non-commercial model.
 */
export function defaultModelFor(backend: Backend): string {
  return backend === "webgpu" ? DEFAULT_MODEL_ID : "modnet"
}

export function getModel(id: string): ModelDef {
  const found = MODELS.find((m) => m.id === id)
  if (!found) {
    throw new Error(
      `Unknown model "${id}". Known models: ${MODELS.map((m) => m.id).join(", ")}`
    )
  }
  return found
}

/**
 * Forced backend, when someone has asked for one.
 *
 * Module state, so each realm has its own copy — the worker is told separately
 * rather than reading storage it does not have.
 */
let backendOverride: Backend | null = null

/**
 * Pin the execution provider, or pass null to go back to detection.
 *
 * This exists because the CPU path is the one that matters most and is the
 * hardest to reach: it is what every device without WebGPU falls back to, and
 * on a machine that has WebGPU there is otherwise no way to run it at all — so
 * it could regress indefinitely without anyone noticing. It doubles as the
 * first thing to try when someone reports a GPU-specific failure.
 */
export function setBackendOverride(backend: Backend | null) {
  backendOverride = backend
  // A forced provider invalidates whatever the probe concluded, and clearing
  // one must re-probe rather than reuse a stale answer.
  probedBackend = null
  probeInFlight = null
}

export function getBackendOverride(): Backend | null {
  return backendOverride
}

/** Result of actually asking for a GPU adapter, once we have. */
let probedBackend: Backend | null = null
let probeInFlight: Promise<Backend> | null = null

/**
 * Decide the provider by requesting an adapter, not by feature-detecting.
 *
 * `navigator.gpu` existing does not mean WebGPU works. iOS Safari 26 exposes
 * the object and then fails `requestAdapter()`, so the optimistic check chose
 * WebGPU, transformers.js could not create a session, and the app died on the
 * first image with:
 *
 *   no available backend found. ERR: [webgpu] Error: Failed to get GPU adapter.
 *
 * Not a degraded experience — nothing worked at all, on every iPhone. The probe
 * is async, which is why it exists alongside detectBackend() rather than inside
 * it, and it is cached because requesting an adapter is not free.
 */
export async function probeBackend(): Promise<Backend> {
  if (backendOverride) return backendOverride
  if (probedBackend) return probedBackend
  if (probeInFlight) return probeInFlight

  probeInFlight = (async (): Promise<Backend> => {
    const gpu = typeof navigator !== "undefined" ? (navigator as any).gpu : null
    if (!gpu) return "wasm"
    try {
      const adapter = await gpu.requestAdapter()
      return adapter ? "webgpu" : "wasm"
    } catch {
      // Present but unusable — exactly the iOS Safari case.
      return "wasm"
    }
  })().then((backend) => {
    probedBackend = backend
    probeInFlight = null
    return backend
  })

  return probeInFlight
}

/**
 * The provider to use right now.
 *
 * Once probeBackend() has resolved this returns its answer. Before that it can
 * only guess, so callers that decide something expensive — which model to
 * download, which variant to build — must await the probe first.
 */
export function detectBackend(): Backend {
  if (backendOverride) return backendOverride
  if (probedBackend) return probedBackend
  const hasWebGPU =
    typeof navigator !== "undefined" && Boolean((navigator as any).gpu)
  return hasWebGPU ? "webgpu" : "wasm"
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(0)} MiB`
}

/** Download size for a model/backend pair, for the UI to show before committing. */
export function variantFor(model: ModelDef, backend: Backend): ModelVariant {
  return model.variants[backend]
}
