import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { MODELS, AUX_MODELS, cacheKeyFor, isAppCache } from "../models"

/**
 * A minimal CacheStorage. The interesting behaviour here is all about which
 * buckets get read and which get deleted, so the fake stores names and byte
 * counts and nothing else.
 */
function fakeCaches(buckets: Record<string, Record<string, number>>) {
  const store = new Map(Object.entries(buckets).map(([k, v]) => [k, { ...v }]))
  return {
    store,
    api: {
      keys: async () => [...store.keys()],
      has: async (k: string) => store.has(k),
      open: async (k: string) => {
        const files = store.get(k) ?? {}
        return {
          keys: async () =>
            Object.keys(files).map((name) => ({ url: `https://x/onnx/${name}` })),
          match: async (req: { url: string }) => {
            const name = req.url.split("/").pop()!
            return {
              clone: () => ({ blob: async () => ({ size: files[name] }) }),
            }
          },
        }
      },
      delete: async (k: string) => store.delete(k),
    },
  }
}

let restore: (() => void) | null = null

function install(buckets: Record<string, Record<string, number>>) {
  const fake = fakeCaches(buckets)
  const g = globalThis as any
  // `navigator` is a getter-only property in this environment, so it has to be
  // redefined rather than assigned.
  const prevCaches = Object.getOwnPropertyDescriptor(g, "caches")
  const prevNav = Object.getOwnPropertyDescriptor(g, "navigator")
  Object.defineProperty(g, "caches", {
    value: fake.api,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(g, "navigator", {
    value: { storage: { estimate: async () => ({ usage: 1, quota: 2 }) } },
    configurable: true,
    writable: true,
  })
  restore = () => {
    if (prevCaches) Object.defineProperty(g, "caches", prevCaches)
    else delete g.caches
    if (prevNav) Object.defineProperty(g, "navigator", prevNav)
    else delete g.navigator
  }
  return fake
}

afterEach(() => {
  restore?.()
  restore = null
  vi.resetModules()
})

// The module reads `caches` at call time, so a fresh import per test is not
// required — but it is imported dynamically so the fake is installed first.
async function mod() {
  return await import("../model-cache")
}

describe("cacheKeyFor", () => {
  it("is the string the worker actually sets as env.cacheKey", () => {
    // If this ever drifts, the manager deletes buckets nobody writes to and
    // reports every model as absent. It is the whole reason the key moved out
    // of the worker.
    expect(cacheKeyFor("birefnet-lite", "webgpu")).toBe(
      "remove-free-birefnet-lite-webgpu"
    )
  })

  it("gives every model and backend a distinct bucket", () => {
    const keys = MODELS.flatMap((m) => [
      cacheKeyFor(m.id, "webgpu"),
      cacheKeyFor(m.id, "wasm"),
    ])
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe("isAppCache", () => {
  it("protects the caches that make the app work", () => {
    expect(isAppCache("remove-free-shell-7")).toBe(true)
    expect(isAppCache("remove-free-runtime-7")).toBe(true)
    expect(isAppCache("remove-free-share")).toBe(true)
  })

  it("does not claim a model bucket", () => {
    // Both share the remove-free- prefix, which is exactly why a prefix match
    // alone would have offered to delete the app.
    for (const m of MODELS) {
      expect(isAppCache(cacheKeyFor(m.id, "webgpu"))).toBe(false)
    }
    for (const m of AUX_MODELS) {
      if (m.cacheKey) expect(isAppCache(m.cacheKey)).toBe(false)
    }
  })
})

describe("readCacheReport", () => {
  it("splits the shared runtime out of the model's own bytes", async () => {
    install({
      [cacheKeyFor("birefnet-lite", "webgpu")]: {
        "model_fp16.onnx": 114_834_127,
        "config.json": 81,
        "ort-wasm-simd-threaded.asyncify.wasm": 23_567_050,
      },
    })
    const { readCacheReport } = await mod()
    const report = await readCacheReport()
    const row = report.models.find(
      (r) => r.model.id === "birefnet-lite" && r.backend === "webgpu"
    )!
    expect(row.state.modelBytes).toBe(114_834_208)
    expect(row.state.runtimeBytes).toBe(23_567_050)
    expect(row.state.bytes).toBe(138_401_258)
    expect(report.totalRuntimeBytes).toBe(23_567_050)
  })

  it("calls a bucket holding only a config an interrupted download", async () => {
    install({
      [cacheKeyFor("modnet", "wasm")]: { "config.json": 81 },
    })
    const { readCacheReport } = await mod()
    const report = await readCacheReport()
    const row = report.models.find(
      (r) => r.model.id === "modnet" && r.backend === "wasm"
    )!
    // Files, so removable — but not "cached", because picking it still costs a
    // full download.
    expect(row.state.files.length).toBe(1)
    expect(row.state.present).toBe(false)
  })

  it("does not call a bucket holding only the runtime a cached model", async () => {
    install({
      [cacheKeyFor("modnet", "webgpu")]: {
        "ort-wasm-simd-threaded.asyncify.wasm": 23_567_050,
      },
    })
    const { readCacheReport } = await mod()
    const report = await readCacheReport()
    const row = report.models.find(
      (r) => r.model.id === "modnet" && r.backend === "webgpu"
    )!
    expect(row.state.present).toBe(false)
  })

  it("reports an unknown bucket without claiming an app cache", async () => {
    install({
      "remove-free-shell-9": { "index.html": 500 },
      "remove-free-share": {},
      "remove-free-oldmodel-webgpu": { "model.onnx": 5_000_000 },
    })
    const { readCacheReport } = await mod()
    const report = await readCacheReport()
    expect(report.other.map((s) => s.key)).toEqual([
      "remove-free-oldmodel-webgpu",
    ])
  })
})

describe("removeCache", () => {
  beforeEach(() => {
    install({
      "remove-free-shell-9": { "index.html": 500 },
      [cacheKeyFor("modnet", "webgpu")]: { "model_fp16.onnx": 12_000_000 },
    })
  })

  it("refuses an app cache even when asked directly", async () => {
    const { removeCache } = await mod()
    await expect(removeCache("remove-free-shell-9")).rejects.toThrow(
      /Refusing/
    )
  })

  it("removes a model cache", async () => {
    const { removeCache } = await mod()
    await expect(removeCache(cacheKeyFor("modnet", "webgpu"))).resolves.toBe(
      true
    )
  })

  it("reports false rather than throwing for a bucket already gone", async () => {
    const { removeCache } = await mod()
    await expect(removeCache("remove-free-nothing-here")).resolves.toBe(false)
  })
})

describe("removeAllModelCaches", () => {
  it("takes the models and the orphans, and leaves the app alone", async () => {
    const fake = install({
      "remove-free-shell-9": { "index.html": 500 },
      "remove-free-runtime-9": { "app.js": 500 },
      "remove-free-share": {},
      [cacheKeyFor("modnet", "webgpu")]: { "model_fp16.onnx": 12_000_000 },
      [cacheKeyFor("birefnet-lite", "wasm")]: { "model.onnx": 214_000_000 },
      "remove-free-oldmodel-webgpu": { "model.onnx": 5_000_000 },
    })
    const { removeAllModelCaches } = await mod()
    const removed = await removeAllModelCaches()
    expect(removed.sort()).toEqual(
      [
        cacheKeyFor("birefnet-lite", "wasm"),
        cacheKeyFor("modnet", "webgpu"),
        "remove-free-oldmodel-webgpu",
      ].sort()
    )
    expect([...fake.store.keys()].sort()).toEqual([
      "remove-free-runtime-9",
      "remove-free-share",
      "remove-free-shell-9",
    ])
  })

  it("returns what it removed, not what it intended to", async () => {
    install({})
    const { removeAllModelCaches } = await mod()
    expect(await removeAllModelCaches()).toEqual([])
  })
})
