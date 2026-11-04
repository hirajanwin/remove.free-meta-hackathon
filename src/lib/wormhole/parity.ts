// Golden-vector parity for the wormhole's vertex shader.
//
// The helix layout, the wrap, the cylinder bend and the centre pinch are all
// GLSL, and until now nothing tested any of it — the only evidence it was
// correct was a screenshot I looked at. That is exactly the gap Paperlab closes
// with its deformer parity gate, and the argument transfers directly: a vertex
// program is a pure function, so it can be evaluated on a grid and compared
// against an independent implementation of the same maths.
//
// The JS twin below is deliberately written from the geometry rather than
// transcribed from the shader. Transcribing would make the test a mirror that
// agrees with whatever the shader does, including whatever it does wrong.
//
// One real difference from Paperlab's case: the two paths here are float64 (JS)
// and float32 (GPU), so the epsilon has to admit that. It is set from what the
// arithmetic can actually guarantee rather than from what happened to pass.

import { LAYOUT } from "./presets"

/**
 * Tolerance, in world units, on a ring of radius 6.
 *
 * Set from a measurement, and the measurement was a surprise. The obvious
 * derivation is float32 rounding: a coordinate of order 10 resolves to about
 * 1e-6, so 5e-4 looked generous. It failed — uniformly, by 1.14e-3, on every
 * case.
 *
 * Isolating the terms showed why. The wrapped height agreed to 7.7e-7 and the
 * angle to 6.4e-7, both float32 noise as expected. The entire disagreement was
 * `sin()` itself: at 1.3962634 rad this GPU returns 0.9846185 where the true
 * value is 0.9848078 — **1.9e-4 relative**, which is about 3000x float32's
 * epsilon. GLSL ES does not require better; drivers implement trig with fast
 * polynomials, and a desktop GPU is free to be this far off at highp.
 *
 * So the floor here is the driver's trig accuracy, not the float width:
 * 1.9e-4 relative on a radius of 6 is 1.14e-3 absolute, which is exactly what
 * was measured. 3e-3 clears that with headroom for a less accurate driver,
 * and it is still two orders of magnitude tighter than any structural error
 * this gate exists to catch — a sign flip, a dropped wrap or a wrong
 * slots-per-turn all move a vertex by whole world units, not thousandths.
 *
 * Half a centimetre on a six-metre ring is also far below anything visible, so
 * a regression that hides under this epsilon is a regression nobody could see.
 */
export const PARITY_EPSILON = 3e-3

export interface ParityCase {
  name: string
  instanceCount: number
  scrollOffset: number
  rotation: number
  scale: number
  squeezeAmount: number
  squeezeWidth: number
}

/**
 * Cases chosen for the places the maths changes character, not for coverage of
 * the option ranges. A parity gate earns its keep at the boundaries.
 */
export const parityCases: ParityCase[] = [
  {
    name: "at rest, two full turns",
    instanceCount: 18,
    scrollOffset: 0,
    rotation: 0,
    scale: 0.83,
    squeezeAmount: 0,
    squeezeWidth: 7.5,
  },
  {
    name: "mid-wrap — the seam the duplicate-position bug lived at",
    instanceCount: 18,
    // Half a slot's travel, so slots are straddling the modulo boundary.
    scrollOffset: LAYOUT.spiralStep * 0.5,
    rotation: 0.7,
    scale: 0.83,
    squeezeAmount: 0,
    squeezeWidth: 7.5,
  },
  {
    name: "exactly on the wrap boundary",
    instanceCount: 18,
    scrollOffset: (18 * LAYOUT.spiralStep) / 2,
    rotation: 0,
    scale: 0.83,
    squeezeAmount: 0,
    squeezeWidth: 7.5,
  },
  {
    name: "full pinch — the gaussian at its steepest",
    instanceCount: 18,
    scrollOffset: 1.3,
    rotation: 2.1,
    scale: 0.83,
    squeezeAmount: 0.8,
    squeezeWidth: 7.5,
  },
  {
    name: "narrow pinch, where exp() falls off fastest",
    instanceCount: 18,
    scrollOffset: 0,
    rotation: 0,
    scale: 0.83,
    // A narrow gaussian is where float32's exp diverges most from float64's.
    squeezeAmount: 0.5,
    squeezeWidth: 1,
  },
  {
    name: "the wasm slot count, one turn",
    instanceCount: 9,
    scrollOffset: 2.2,
    rotation: -1.4,
    scale: 0.83,
    squeezeAmount: 0.2,
    squeezeWidth: 7.5,
  },
  {
    name: "large slots, where the bend's theta is biggest",
    instanceCount: 18,
    scrollOffset: 0,
    rotation: 0,
    // Scale multiplies the local x that becomes the bend angle, so this is the
    // case where the plane wraps furthest around the cylinder.
    scale: 1.6,
    squeezeAmount: 0,
    squeezeWidth: 7.5,
  },
  {
    name: "negative scroll, a long way round",
    instanceCount: 18,
    scrollOffset: -37.4,
    rotation: 5.9,
    scale: 0.83,
    squeezeAmount: 0.3,
    squeezeWidth: 7.5,
  },
]

export interface ParityPoint {
  x: number
  y: number
  z: number
}

/**
 * The JS twin: where a vertex lands, derived from the geometry.
 *
 * `slot` is the instance index, and `u`/`v` are the plane's own coordinates in
 * [-0.5, 0.5] — the same space `position` occupies in the vertex shader before
 * scaling.
 */
export function expectedPosition(
  c: ParityCase,
  slot: number,
  u: number,
  v: number
): ParityPoint {
  const total = c.instanceCount * LAYOUT.spiralStep
  const startY = -(total / 2)

  // Local position of this vertex on its own flat plane, scaled.
  const localX = u * LAYOUT.planeWidth * c.scale
  const localY = v * LAYOUT.planeHeight * c.scale

  // The slot's own height, wrapped into the ring.
  const base = startY + slot * LAYOUT.spiralStep + c.scrollOffset
  const wrapped = (((base + total * 0.5) % total) + total) % total - total * 0.5
  const y = wrapped + localY

  // The centre pinch: a gaussian in height, narrowing the radius.
  const gauss = Math.exp(-(y * y) / (c.squeezeWidth * c.squeezeWidth))
  const radius = LAYOUT.radius * (1 - c.squeezeAmount * gauss)

  // The bend: this vertex's own x becomes an angle, so the quad arrives curved
  // around the cylinder rather than chorded across it.
  // Reduced exactly as the shader reduces it — see the note in the GLSL chunk.
  // Both sides must take the same path for the same reason Paperlab's deformers
  // do: agreement by construction rather than by luck.
  const TAU = Math.PI * 2
  const raw = slot * (TAU / LAYOUT.imagesPerTurn) + c.rotation
  const angle = raw - TAU * Math.floor(raw / TAU)
  const theta = localX / (radius * LAYOUT.curvature)
  const final = angle + theta

  return {
    x: Math.sin(final) * radius,
    y,
    z: Math.cos(final) * radius,
  }
}

/** The grid of sample points each case is evaluated over. */
export const PARITY_GRID = 9

export function parityPoints(): { u: number; v: number }[] {
  const out: { u: number; v: number }[] = []
  for (let i = 0; i < PARITY_GRID; i++) {
    for (let j = 0; j < PARITY_GRID; j++) {
      // Corners included: that is where the bend's theta is largest and where a
      // sign error hides from a centre-weighted sample.
      out.push({
        u: i / (PARITY_GRID - 1) - 0.5,
        v: j / (PARITY_GRID - 1) - 0.5,
      })
    }
  }
  return out
}
