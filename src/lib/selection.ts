// Selection geometry for the marquee, lasso and pen tools.
//
// Photoshop has had these for decades; the interesting part here is only
// that their output lands in the same proposal flow as SAM's masks, so a
// hand-drawn region and a model-found one are applied, tinted and undone
// identically. Pure functions; tested.

export interface Point {
  x: number
  y: number
}

/** Filled rectangle mask between two corners, in image pixels. */
export function rectMask(
  width: number,
  height: number,
  a: Point,
  b: Point
): Uint8Array {
  const out = new Uint8Array(width * height)
  const x1 = Math.max(0, Math.min(Math.round(a.x), Math.round(b.x)))
  const x2 = Math.min(width - 1, Math.max(Math.round(a.x), Math.round(b.x)))
  const y1 = Math.max(0, Math.min(Math.round(a.y), Math.round(b.y)))
  const y2 = Math.min(height - 1, Math.max(Math.round(a.y), Math.round(b.y)))
  for (let y = y1; y <= y2; y++) {
    const row = y * width
    for (let x = x1; x <= x2; x++) out[row + x] = 255
  }
  return out
}

/**
 * Filled polygon mask via scanline even-odd fill: per row, intersect the
 * polygon edges, sort the crossings, fill between pairs. Cost tracks
 * rows x edges plus the filled area, not pixels x points.
 */
export function polygonMask(
  width: number,
  height: number,
  points: Point[]
): Uint8Array {
  const out = new Uint8Array(width * height)
  if (points.length < 3) return out

  for (let y = 0; y < height; y++) {
    const scanY = y + 0.5
    const crossings: number[] = []
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i]
      const p2 = points[(i + 1) % points.length]
      if (p1.y === p2.y) continue
      const [top, bottom] = p1.y < p2.y ? [p1, p2] : [p2, p1]
      if (scanY < top.y || scanY >= bottom.y) continue
      const t = (scanY - p1.y) / (p2.y - p1.y)
      crossings.push(p1.x + t * (p2.x - p1.x))
    }
    crossings.sort((a, b) => a - b)
    const row = y * width
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const x1 = Math.max(0, Math.ceil(crossings[i] - 0.5))
      const x2 = Math.min(width - 1, Math.floor(crossings[i + 1] - 0.5))
      for (let x = x1; x <= x2; x++) out[row + x] = 255
    }
  }
  return out
}
