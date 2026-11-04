// The edit layer is where a user's own work lives, so a silent regression here
// destroys something they cannot get back. These are the invariants the studio
// relies on rather than a line-coverage exercise.

import { describe, it, expect } from "vitest"
import {
  UNTOUCHED,
  ERASED,
  RESTORED,
  createEditMask,
  resolveAlpha,
  strokeBounds,
  paintStroke,
  capturePatch,
  applyPatch,
  hasEdits,
} from "../brush"

describe("resolveAlpha", () => {
  it("lets the model decide where the user has not", () => {
    expect(resolveAlpha(137, UNTOUCHED)).toBe(137)
  })

  it("overrides the model completely where the user has", () => {
    // Not "mostly transparent" — an erase the model disagrees with must still
    // be fully gone, or a brush stroke leaves a ghost.
    expect(resolveAlpha(255, ERASED)).toBe(0)
    expect(resolveAlpha(0, RESTORED)).toBe(255)
  })
})

describe("paintStroke", () => {
  it("sweeps a capsule between samples rather than dotting them", () => {
    // The bug this guards: pointer samples arrive far apart on a fast drag, and
    // painting a circle per sample leaves visible gaps between them.
    const mask = createEditMask(64, 64)
    paintStroke(mask, 64, 64, { x: 8, y: 32 }, { x: 56, y: 32 }, {
      mode: "erase",
      radius: 3,
      softness: 0,
    })

    for (let x = 8; x <= 56; x++) {
      expect(mask[32 * 64 + x]).toBe(ERASED)
    }
  })

  it("stays inside the image", () => {
    const mask = createEditMask(16, 16)
    const rect = paintStroke(mask, 16, 16, { x: -50, y: 8 }, { x: -40, y: 8 }, {
      mode: "restore",
      radius: 2,
      softness: 0,
    })
    // Entirely off-canvas: nothing to paint and nothing to redraw.
    expect(rect).toBeNull()
    expect(hasEdits(mask)).toBe(false)
  })

  it("reports bounds matching what strokeBounds predicted", () => {
    // Undo captures the patch using strokeBounds BEFORE the stroke runs, so the
    // two must agree or undo restores the wrong rectangle.
    const mask = createEditMask(40, 40)
    const from = { x: 10, y: 12 }
    const to = { x: 25, y: 30 }
    const predicted = strokeBounds(40, 40, from, to, 4)
    const actual = paintStroke(mask, 40, 40, from, to, { mode: "erase", radius: 4, softness: 0 })
    expect(actual).toEqual(predicted)
  })
})

describe("undo patches", () => {
  it("restores exactly the pixels a stroke changed", () => {
    const mask = createEditMask(32, 32)
    // Pre-existing work that must survive an undo of the next stroke.
    paintStroke(mask, 32, 32, { x: 4, y: 4 }, { x: 6, y: 4 }, { mode: "restore", radius: 2, softness: 0 })
    const before = Uint8Array.from(mask)

    const rect = strokeBounds(32, 32, { x: 16, y: 16 }, { x: 24, y: 20 }, 5)!
    const patch = capturePatch(mask, 32, rect)
    paintStroke(mask, 32, 32, { x: 16, y: 16 }, { x: 24, y: 20 }, {
      mode: "erase",
      radius: 5,
      softness: 0,
    })
    expect(mask).not.toEqual(before)

    applyPatch(mask, 32, patch)
    expect(mask).toEqual(before)
  })
})

describe("hasEdits", () => {
  it("is false for a fresh mask and true after any mark", () => {
    // The progressive preview swaps the model's alpha underneath the user, and
    // uses this to decide whether their strokes are worth carrying over.
    const mask = createEditMask(8, 8)
    expect(hasEdits(mask)).toBe(false)
    mask[17] = RESTORED
    expect(hasEdits(mask)).toBe(true)
  })
})
