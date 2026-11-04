// DINOv2 patch-similarity math.
//
// DINOv2-small embeds an image as one CLS token plus a grid of patch tokens
// (16x16 at its fixed 224x224 input). Cosine similarity between the clicked
// patch and every other patch answers "where else does this kind of thing
// appear" — click one shoe and both shoes light up.
//
// The grid is far too coarse to be a matte (each patch covers ~50x80 px on a
// real photo), so nothing here is ever shown as a final result. It produces
// seed points; SlimSAM turns seeds into crisp masks. Pure functions, tested.

/** Cosine similarity of every patch token to the query patch token. */
export function patchSimilarity(
  features: Float32Array,
  tokenCount: number,
  dim: number,
  queryPatch: number
): Float32Array {
  const patches = tokenCount - 1 // token 0 is CLS
  const out = new Float32Array(patches)
  const qOff = (queryPatch + 1) * dim

  let qNorm = 0
  for (let d = 0; d < dim; d++) qNorm += features[qOff + d] * features[qOff + d]
  qNorm = Math.sqrt(qNorm) || 1

  for (let p = 0; p < patches; p++) {
    const off = (p + 1) * dim
    let dot = 0
    let norm = 0
    for (let d = 0; d < dim; d++) {
      dot += features[off + d] * features[qOff + d]
      norm += features[off + d] * features[off + d]
    }
    out[p] = dot / ((Math.sqrt(norm) || 1) * qNorm)
  }
  return out
}

/** Binary mask (0/255) of patches at or above the threshold. */
export function maskFromSimilarity(sim: Float32Array, threshold: number): Uint8Array {
  const out = new Uint8Array(sim.length)
  for (let i = 0; i < sim.length; i++) out[i] = sim[i] >= threshold ? 255 : 0
  return out
}

export interface SeedPoint {
  x: number
  y: number
  /** Patches in the cluster this seed came from. */
  area: number
}

/**
 * One seed per connected cluster of similar patches, largest first.
 *
 * A single centroid for a scattered selection (both shoes, all the foliage)
 * would land between the objects, on none of them. Clustering first means
 * every seed actually sits on something similar to the click.
 */
export function seedPoints(
  sim: Float32Array,
  gridW: number,
  gridH: number,
  imageW: number,
  imageH: number,
  threshold: number,
  maxSeeds = 4,
  /** Patch the user actually clicked. Its cluster is always kept. */
  queryPatch?: number
): SeedPoint[] {
  const visited = new Uint8Array(gridW * gridH)
  const clusters: Array<{
    sx: number
    sy: number
    sw: number
    area: number
    peak: number
    isQuery: boolean
  }> = []

  for (let start = 0; start < sim.length; start++) {
    if (visited[start] || sim[start] < threshold) continue
    // Flood fill this cluster, accumulating a similarity-weighted centroid.
    const stack = [start]
    visited[start] = 1
    let sx = 0
    let sy = 0
    let sw = 0
    let area = 0
    let peak = 0
    let isQuery = false
    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % gridW
      const y = (idx / gridW) | 0
      const w = sim[idx]
      sx += x * w
      sy += y * w
      sw += w
      area++
      if (w > peak) peak = w
      if (idx === queryPatch) isQuery = true
      const neighbours = [
        x > 0 ? idx - 1 : -1,
        x < gridW - 1 ? idx + 1 : -1,
        y > 0 ? idx - gridW : -1,
        y < gridH - 1 ? idx + gridW : -1,
      ]
      for (const n of neighbours) {
        if (n >= 0 && !visited[n] && sim[n] >= threshold) {
          visited[n] = 1
          stack.push(n)
        }
      }
    }
    clusters.push({ sx: sx / (sw || 1), sy: sy / (sw || 1), sw, area, peak, isQuery })
  }

  // Non-query clusters have to earn their seed. Measured failure behind
  // this: clicking a shoe on a red backdrop seeded the backdrop too, and
  // SlimSAM dutifully selected the background. So a cluster the user did
  // not click must be strongly similar (peak clearly above the floor) and
  // must not sprawl across the frame the way backdrops do.
  const total = gridW * gridH
  const kept = clusters.filter(
    (c) => c.isQuery || (c.peak >= threshold + 0.1 && c.area <= total * 0.35)
  )
  kept.sort((a, b) => Number(b.isQuery) - Number(a.isQuery) || b.area - a.area)
  return kept.slice(0, maxSeeds).map((c) => ({
    // Patch centre, mapped into image coordinates.
    x: ((c.sx + 0.5) / gridW) * imageW,
    y: ((c.sy + 0.5) / gridH) * imageH,
    area: c.area,
  }))
}
