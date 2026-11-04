// What is actually on the user's disk, and how to give it back.
//
// Every model in this app is a download the visitor paid for in bandwidth and
// storage — BiRefNet's WebGPU build alone is 138 MiB measured, not estimated.
// A product whose whole claim is "nothing leaves your device" owes the user a
// way to see what it put on their device and to remove it.
//
// Everything here reads CacheStorage directly rather than keeping a manifest.
// A manifest can disagree with reality: the browser evicts caches under storage
// pressure without telling us, a download can fail halfway and leave a bucket
// holding a config file and no weights, and a stale entry would then offer to
// free space that is not there. The bytes reported below are summed from the
// stored responses themselves.

import {
  AUX_MODELS,
  MODELS,
  cacheKeyFor,
  isAppCache,
  type AuxModelDef,
  type Backend,
  type ModelDef,
} from "./models"
import {
  DEPTH_MODELS,
  depthCacheKeyFor,
  type DepthModelDef,
} from "./depth-models"

export interface CachedFile {
  name: string
  bytes: number
  /**
   * True for onnxruntime-web's own .wasm/.mjs runtime rather than the model.
   *
   * transformers.js stores the runtime inside whichever model's cache bucket
   * pulled it in, so the same 23.5 MiB sits in up to six buckets. Without this
   * split, "Remove BiRefNet · WebGPU" reads as freeing 132 MiB of BiRefNet when
   * 23.5 MiB of it is a shared runtime the next model downloads again.
   */
  runtime: boolean
}

const RUNTIME_FILE = /^ort-wasm|\.wasm$|^onnxruntime/i

/** One CacheStorage bucket, as it exists right now. */
export interface CacheState {
  key: string
  present: boolean
  files: CachedFile[]
  /** Everything in the bucket. */
  bytes: number
  /** Just the model's own weights and configs. */
  modelBytes: number
  /** Just the shared onnxruntime-web runtime. */
  runtimeBytes: number
}

export interface ModelCacheRow {
  model: ModelDef
  backend: Backend
  /** Registry's expected download size, for comparison with what is stored. */
  expectedBytes: number
  state: CacheState
}

export interface AuxCacheRow {
  model: AuxModelDef
  state: CacheState | null
}

export interface DepthCacheRow {
  model: DepthModelDef
  backend: Backend
  expectedBytes: number
  state: CacheState
}

export interface CacheReport {
  models: ModelCacheRow[]
  aux: AuxCacheRow[]
  depth: DepthCacheRow[]
  /**
   * Buckets that exist but belong to no model — the app shell, the runtime
   * cache, a share in flight, or something a previous version wrote under a
   * name this one no longer uses.
   *
   * Surfaced rather than hidden: an orphan from a renamed model is exactly the
   * kind of thing that silently keeps 138 MiB forever.
   */
  other: CacheState[]
  totalModelBytes: number
  /**
   * How much of the above is duplicated copies of onnxruntime-web.
   *
   * Reported because it is the one number on this page that is the app's fault
   * rather than the model's, and it is not small: one copy is 23.5 MiB.
   */
  totalRuntimeBytes: number
  usage: number | null
  quota: number | null
}

const EMPTY: CacheState = {
  key: "",
  present: false,
  files: [],
  bytes: 0,
  modelBytes: 0,
  runtimeBytes: 0,
}

/**
 * Sum the bytes of every response in one bucket.
 *
 * Measured from the stored blob, not from `content-length`, and the difference
 * is not academic. For BiRefNet's WebGPU bucket the two disagree by 18.9 MiB
 * (16%): the .onnx is served uncompressed so the header matches, but
 * onnxruntime's .wasm arrives brotli-encoded — 4.73 MiB over the wire, 23.57
 * MiB once stored. `content-length` is the transfer size. This page is about
 * reclaiming disk, so it has to report what is on disk.
 *
 * Reading `.size` off a cache-backed Blob does not pull the body into memory;
 * the browser keeps it file-backed.
 */
async function readCache(key: string): Promise<CacheState> {
  if (typeof caches === "undefined") return { ...EMPTY, key }

  const has = await caches.has(key)
  if (!has) return { ...EMPTY, key }

  const cache = await caches.open(key)
  const requests = await cache.keys()

  const files: CachedFile[] = await Promise.all(
    requests.map(async (request) => {
      const name = decodeURIComponent(new URL(request.url).pathname.split("/").pop() || "?")
      const runtime = RUNTIME_FILE.test(name)
      const response = await cache.match(request)
      if (!response) return { name, bytes: 0, runtime }
      const blob = await response.clone().blob()
      return { name, bytes: blob.size, runtime }
    })
  )

  files.sort((a, b) => b.bytes - a.bytes)

  const modelBytes = files
    .filter((f) => !f.runtime)
    .reduce((sum, f) => sum + f.bytes, 0)
  const runtimeBytes = files
    .filter((f) => f.runtime)
    .reduce((sum, f) => sum + f.bytes, 0)

  return {
    key,
    // A bucket holding only a config.json is a failed or interrupted download,
    // not a cached model — and the test has to be against the model's own
    // bytes, or a bucket with nothing but the 23.5 MiB runtime in it would
    // report as a cached model.
    present: files.some((f) => !f.runtime && f.bytes > 1_000_000),
    files,
    bytes: modelBytes + runtimeBytes,
    modelBytes,
    runtimeBytes,
  }
}

/**
 * How many models are cached, without reading a single byte.
 *
 * The sidebar badge needs a count on every render; `readCacheReport` opens
 * every bucket and stats every file in it, which is far too much work for a
 * number next to a nav item.
 */
export async function countCachedModels(): Promise<number> {
  if (typeof caches === "undefined") return 0
  const existing = new Set(await caches.keys())
  let n = 0
  for (const model of MODELS) {
    for (const backend of ["webgpu", "wasm"] as Backend[]) {
      if (existing.has(cacheKeyFor(model.id, backend))) n++
    }
  }
  for (const model of AUX_MODELS) {
    if (model.cacheKey && existing.has(model.cacheKey)) n++
  }
  for (const model of DEPTH_MODELS) {
    for (const backend of ["webgpu", "wasm"] as Backend[]) {
      if (existing.has(depthCacheKeyFor(model.id, backend))) n++
    }
  }
  return n
}

export async function readCacheReport(): Promise<CacheReport> {
  const existing =
    typeof caches === "undefined" ? [] : await caches.keys()

  const modelRows: ModelCacheRow[] = []
  for (const model of MODELS) {
    for (const backend of ["webgpu", "wasm"] as Backend[]) {
      const key = cacheKeyFor(model.id, backend)
      modelRows.push({
        model,
        backend,
        expectedBytes: model.variants[backend].bytes,
        state: await readCache(key),
      })
    }
  }

  const auxRows: AuxCacheRow[] = []
  for (const model of AUX_MODELS) {
    auxRows.push({
      model,
      state: model.cacheKey ? await readCache(model.cacheKey) : null,
    })
  }

  // Depth models are per model AND backend, like the matting ones, so they get
  // a row each rather than one lumped entry. Without this the Depth tab could
  // put 160 MiB on someone's disk with nothing on the storage page to remove
  // it, which is the failure that page exists to prevent.
  const depthRows: DepthCacheRow[] = []
  for (const model of DEPTH_MODELS) {
    for (const backend of ["webgpu", "wasm"] as Backend[]) {
      depthRows.push({
        model,
        backend,
        expectedBytes: model.variants[backend].bytes,
        state: await readCache(depthCacheKeyFor(model.id, backend)),
      })
    }
  }

  const accounted = new Set<string>([
    ...modelRows.map((r) => r.state.key),
    ...auxRows.map((r) => r.state?.key).filter((k): k is string => !!k),
    ...depthRows.map((r) => r.state.key),
  ])

  const other: CacheState[] = []
  for (const key of existing) {
    if (accounted.has(key) || isAppCache(key)) continue
    other.push(await readCache(key))
  }

  const estimate =
    typeof navigator !== "undefined" && navigator.storage?.estimate
      ? await navigator.storage.estimate().catch(() => null)
      : null

  return {
    models: modelRows,
    aux: auxRows,
    depth: depthRows,
    other,
    totalModelBytes:
      modelRows.reduce((sum, r) => sum + r.state.bytes, 0) +
      auxRows.reduce((sum, r) => sum + (r.state?.bytes ?? 0), 0) +
      depthRows.reduce((sum, r) => sum + r.state.bytes, 0),
    totalRuntimeBytes:
      modelRows.reduce((sum, r) => sum + r.state.runtimeBytes, 0) +
      auxRows.reduce((sum, r) => sum + (r.state?.runtimeBytes ?? 0), 0) +
      depthRows.reduce((sum, r) => sum + r.state.runtimeBytes, 0),
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
  }
}

/**
 * `navigator.storage.estimate()` lags a deletion by a second or two.
 *
 * Measured: immediately after removing 151.8 MB of models it still reported
 * 151,863,645 bytes used, and only fell to 422,119 some seconds later. The
 * model totals on the page are read from CacheStorage and are correct
 * instantly, so without a second read the origin figure sits next to them
 * contradicting them — "0 MiB in models · 144.8 MB used".
 */
export const STORAGE_ESTIMATE_LAG_MS = 2500

/**
 * Delete one bucket.
 *
 * Refuses to touch an app cache. The manager's UI never offers one, but this
 * is the function that does the destroying, so the guarantee belongs here too
 * rather than in the component that happens to call it today.
 */
export async function removeCache(key: string): Promise<boolean> {
  if (isAppCache(key)) {
    throw new Error(`Refusing to delete the app cache "${key}".`)
  }
  if (typeof caches === "undefined") return false
  return caches.delete(key)
}

/**
 * Delete every model bucket, leaving the app's own caches intact.
 *
 * Returns the keys actually removed, so the caller can report what happened
 * instead of claiming a number it assumed.
 */
export async function removeAllModelCaches(): Promise<string[]> {
  const report = await readCacheReport()
  const keys = [
    ...report.models.filter((r) => r.state.files.length > 0).map((r) => r.state.key),
    ...report.depth.filter((r) => r.state.files.length > 0).map((r) => r.state.key),
    ...report.aux
      .filter((r) => r.state && r.state.files.length > 0)
      .map((r) => r.state!.key),
    ...report.other.map((s) => s.key),
  ]

  const removed: string[] = []
  for (const key of keys) {
    if (await removeCache(key)) removed.push(key)
  }
  return removed
}
