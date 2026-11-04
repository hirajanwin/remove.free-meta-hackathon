// On-device model bench.
//
// The model picker used to describe each option in prose written by whoever
// added it ("best edges on hair"). That is a claim about someone else's GPU on
// someone else's photo. This runs every model over the same images on the
// machine actually in front of the user and reports what happened.
//
// There is no ground truth here — these are stock photos, not a matting dataset
// with reference alphas — so this deliberately does not claim to measure
// accuracy. What it can measure honestly is speed, how much of the frame each
// model calls subject, how much soft edge it produces, and how far each one
// sits from what the others agree on. Those are enough to choose between them,
// and each is defined below so the numbers can be argued with.

import { MODELS, probeBackend, variantFor, type Backend } from "./models"
import { removeBackground } from "./bg-removal"

export interface BenchSample {
  id: string
  label: string
  url: string
}

/** The bundled samples, which are already precached for offline use. */
export const BENCH_SAMPLES: BenchSample[] = [
  { id: "portrait", label: "Portrait", url: "/samples/portrait.jpg" },
  { id: "sneakers", label: "Sneakers", url: "/samples/sneakers.jpg" },
  { id: "retriever", label: "Golden Retriever", url: "/samples/retriever.jpg" },
  { id: "car", label: "Sports Car", url: "/samples/car.jpg" },
]

/**
 * Alpha values in this range are neither fully cut nor fully kept. The fraction
 * of them is the closest thing to a hair/fur score available without reference
 * mattes: a model that resolves strands produces a wide soft band, one that
 * hard-thresholds produces almost none.
 *
 * Matches the band src/lib/refine.ts restricts the guided filter to, so the two
 * are talking about the same pixels.
 */
const SOFT_LO = 4
const SOFT_HI = 251

export interface BenchRun {
  sampleId: string
  /** Wall clock for the whole call, including decode and alpha refinement. */
  ms: number
  /** Share of pixels the model calls subject (alpha >= 128). */
  coverage: number
  /** Share of pixels left partially transparent. */
  soft: number
}

export interface BenchResult {
  modelId: string
  label: string
  backend: Backend
  licenseId: string
  downloadBytes: number
  /** The weights' real precision, which is not always the dtype argument. */
  dtype: string
  /** First run: includes fetching and initialising the model. */
  coldMs: number
  /** Median of the runs after the first. */
  warmMedianMs: number
  runs: BenchRun[]
  /**
   * Mean absolute difference from the per-pixel median of every model, as a
   * percentage of full opacity. Not an error rate — the consensus is not truth,
   * and if two models are wrong in the same way the third looks worst. It is
   * useful the other way round: a large number means "this one disagrees with
   * the rest", which is worth looking at.
   */
  disagreement: number
  error?: string
}

export interface BenchProgress {
  modelId: string
  modelLabel: string
  sampleLabel: string
  done: number
  total: number
}

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Run every model over every sample.
 *
 * Models are the outer loop on purpose. The matting worker keeps exactly one
 * live pipeline and disposes the rest to stay inside GPU memory, so alternating
 * models per sample would pay a cold start on every single run and measure
 * nothing but download speed.
 */
export async function runBench(
  samples: BenchSample[] = BENCH_SAMPLES,
  modelIds: string[] = MODELS.map((m) => m.id),
  onProgress?: (p: BenchProgress) => void
): Promise<BenchResult[]> {
  // Ask for an adapter rather than assume one. Reporting "WebGPU" next to
  // timings produced on the CPU would make the whole page a lie.
  const backend = await probeBackend()

  const blobs = new Map<string, Blob>()
  for (const s of samples) {
    blobs.set(s.id, await (await fetch(s.url)).blob())
  }

  const total = modelIds.length * samples.length
  let done = 0

  // Kept per model so the consensus can be computed once everything has run.
  const alphas = new Map<string, Map<string, Uint8Array>>()
  const results: BenchResult[] = []

  for (const modelId of modelIds) {
    const model = MODELS.find((m) => m.id === modelId)
    if (!model) continue
    const variant = variantFor(model, backend)

    const runs: BenchRun[] = []
    const perSample = new Map<string, Uint8Array>()
    let failure: string | undefined

    for (const sample of samples) {
      onProgress?.({
        modelId,
        modelLabel: model.label,
        sampleLabel: sample.label,
        done,
        total,
      })

      try {
        const t0 = performance.now()
        const out = await removeBackground(blobs.get(sample.id)!, modelId)
        const ms = performance.now() - t0

        const a = out.alpha
        let opaque = 0
        let soft = 0
        for (let i = 0; i < a.length; i++) {
          if (a[i] >= 128) opaque++
          if (a[i] >= SOFT_LO && a[i] <= SOFT_HI) soft++
        }

        perSample.set(sample.id, a)
        runs.push({
          sampleId: sample.id,
          ms,
          coverage: opaque / a.length,
          soft: soft / a.length,
        })
      } catch (err: any) {
        // One model failing is a result, not a reason to abandon the bench —
        // "RMBG will not load on this device" is exactly what a user needs to
        // know before picking it.
        failure = err?.message || String(err)
        break
      } finally {
        done++
      }
    }

    alphas.set(modelId, perSample)
    results.push({
      modelId,
      label: model.label,
      backend,
      licenseId: model.license.id,
      downloadBytes: variant.bytes,
      dtype: variant.precision ?? variant.dtype,
      coldMs: runs[0]?.ms ?? 0,
      warmMedianMs: median(runs.slice(1).map((r) => r.ms)),
      runs,
      disagreement: 0,
      error: failure,
    })
  }

  applyDisagreement(results, alphas, samples)
  return results
}

/**
 * Fill in each model's distance from the per-pixel median of all of them.
 *
 * Needs at least three models to mean anything: with two, the median is their
 * midpoint and both are equidistant from it by construction.
 */
function applyDisagreement(
  results: BenchResult[],
  alphas: Map<string, Map<string, Uint8Array>>,
  samples: BenchSample[]
) {
  const usable = results.filter((r) => !r.error && r.runs.length === samples.length)
  if (usable.length < 3) return

  const totals = new Map<string, { sum: number; n: number }>()
  for (const r of usable) totals.set(r.modelId, { sum: 0, n: 0 })

  for (const sample of samples) {
    const set = usable.map((r) => alphas.get(r.modelId)!.get(sample.id)!)
    // A model can return a different size only if it failed to run at native
    // resolution; skip rather than compare mismatched buffers.
    if (set.some((a) => a.length !== set[0].length)) continue

    const n = set[0].length
    const scratch = new Array<number>(set.length)
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < set.length; k++) scratch[k] = set[k][i]
      scratch.sort((a, b) => a - b)
      const mid =
        scratch.length % 2
          ? scratch[scratch.length >> 1]
          : (scratch[(scratch.length >> 1) - 1] + scratch[scratch.length >> 1]) / 2
      for (let k = 0; k < set.length; k++) {
        const t = totals.get(usable[k].modelId)!
        t.sum += Math.abs(set[k][i] - mid)
        t.n++
      }
    }
  }

  for (const r of usable) {
    const t = totals.get(r.modelId)!
    r.disagreement = t.n ? t.sum / t.n / 255 : 0
  }
}
