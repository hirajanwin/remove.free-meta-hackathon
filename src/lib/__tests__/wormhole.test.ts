import { describe, expect, it, vi } from "vitest"
import {
  createVirtualScroll,
  KEY_IMPULSE,
} from "../wormhole/virtual-scroll"
import {
  PRESETS,
  DEFAULT_PRESET_ID,
  DITHER_MODES,
  DITHER_SHAPES,
  LAYOUT,
  presetById,
  instanceCountFor,
  textureIndexFor,
} from "../wormhole/presets"

describe("virtual scroll", () => {
  it("does not move until an impulse arrives", () => {
    const s = createVirtualScroll()
    for (let i = 0; i < 10; i++) s.update()
    expect(s.offset.current).toBe(0)
    expect(s.velocity.current).toBe(0)
  })

  it("carries momentum after the input stops", () => {
    const s = createVirtualScroll(0.87)
    s.impulse(1)
    s.update()
    const firstStep = s.offset.current
    // No further input; friction alone should keep it moving for a while.
    s.update()
    const secondStep = s.offset.current - firstStep
    expect(secondStep).toBeGreaterThan(0)
    expect(secondStep).toBeLessThan(firstStep)
  })

  it("comes to a complete stop rather than creeping forever", () => {
    const s = createVirtualScroll(0.87)
    s.impulse(1)
    // Exponential decay never reaches zero, so a threshold snaps it. Without
    // that the ring drifts at an imperceptible rate indefinitely and never
    // stops re-rendering.
    for (let i = 0; i < 500; i++) s.update()
    expect(s.velocity.current).toBe(0)
  })

  it("respects friction: less friction settles sooner", () => {
    const framesToRest = (friction: number) => {
      const s = createVirtualScroll(friction)
      s.impulse(1)
      let n = 0
      // do/while, not while: the impulse is still pending before the first
      // update, so velocity reads 0 and a leading test exits immediately —
      // which made this assertion compare 0 with 0 and pass for the wrong
      // reason until it did not.
      do {
        s.update()
        n++
      } while (s.velocity.current !== 0 && n < 5000)
      return n
    }
    expect(framesToRest(0.5)).toBeLessThan(framesToRest(0.95))
  })

  it("accumulates impulses that arrive between frames", () => {
    const s = createVirtualScroll(0.87)
    s.impulse(1)
    s.impulse(1)
    s.update()
    const both = s.velocity.current

    const one = createVirtualScroll(0.87)
    one.impulse(1)
    one.update()
    expect(both).toBeCloseTo(one.velocity.current * 2, 10)
  })

  it("gives a key press the same weight as a wheel notch", () => {
    // A trackpad notch is ~100 deltaY at a 0.01 scale, so one arrow press has
    // to be worth 1.0 — a keyboard user should not need ten presses to travel
    // what one flick does.
    expect(KEY_IMPULSE).toBeCloseTo(1, 10)
  })

  it("only cancels a wheel gesture that is really vertical", () => {
    const s = createVirtualScroll()
    const el = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement
    s.attach(el)
    const onWheel = (el.addEventListener as any).mock.calls.find(
      (c: any[]) => c[0] === "wheel"
    )[1]

    // Mostly horizontal: left alone, so a back-swipe still works and the page
    // behind stays scrollable.
    const horizontal = { deltaX: 50, deltaY: 5, preventDefault: vi.fn() }
    onWheel(horizontal)
    expect(horizontal.preventDefault).not.toHaveBeenCalled()
    expect(s.velocity.current).toBe(0)
    s.update()
    expect(s.offset.current).toBe(0)

    const vertical = { deltaX: 5, deltaY: 50, preventDefault: vi.fn() }
    onWheel(vertical)
    expect(vertical.preventDefault).toHaveBeenCalled()
    s.update()
    expect(s.offset.current).toBeGreaterThan(0)
  })

  it("registers passive correctly: never passive where it calls preventDefault", () => {
    const s = createVirtualScroll()
    const calls: Array<[string, unknown, any]> = []
    const el = {
      addEventListener: (t: string, h: unknown, o: any) => calls.push([t, h, o]),
      removeEventListener: () => {},
    } as unknown as HTMLElement
    s.attach(el)
    // A passive listener cannot preventDefault; the browser ignores the call
    // and the page scrolls underneath the gallery.
    for (const type of ["wheel", "touchmove"]) {
      const call = calls.find((c) => c[0] === type)!
      expect(call[2]?.passive).toBe(false)
    }
    expect(calls.find((c) => c[0] === "touchstart")![2]?.passive).toBe(true)
  })

  it("detaches every listener it attached", () => {
    const s = createVirtualScroll()
    const added: string[] = []
    const removed: string[] = []
    const el = {
      addEventListener: (t: string) => added.push(t),
      removeEventListener: (t: string) => removed.push(t),
    } as unknown as HTMLElement
    s.attach(el)()
    expect(removed.sort()).toEqual(added.sort())
  })
})

describe("presets", () => {
  it("has a default that exists", () => {
    expect(PRESETS.some((p) => p.id === DEFAULT_PRESET_ID)).toBe(true)
  })

  it("falls back rather than throwing on an unknown id", () => {
    expect(presetById("nope")).toBe(PRESETS[0])
  })

  it("gives every preset a distinct id and a hint", () => {
    const ids = PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PRESETS) expect(p.hint.length).toBeGreaterThan(10)
  })

  it("draws no frame anywhere — the box is what the product removes", () => {
    for (const p of PRESETS) expect(p.borderWidth).toBe(0)
  })

  it("keeps slots-per-turn consistent with the slot width", () => {
    // If these drift apart the ring either overlaps itself or shows gaps.
    // circumference / slot width should land on the configured count.
    const circumference = 2 * Math.PI * LAYOUT.radius
    const implied = circumference / LAYOUT.planeWidth
    expect(Math.abs(implied - LAYOUT.imagesPerTurn)).toBeLessThan(1)
  })

  it("asks less of a device that could not give us WebGPU", () => {
    expect(instanceCountFor("wasm")).toBeLessThan(instanceCountFor("webgpu"))
  })
})


/**
 * Reproduce the vertex shader's placement on the CPU.
 *
 * The shader is the only place this maths lives, so the only way to assert
 * anything about slot positions is to mirror it — kept deliberately literal
 * against the GLSL rather than tidied, so a divergence is visible.
 */
function slotPositions(count: number, scrollOffset: number) {
  const total = count * LAYOUT.spiralStep
  const startY = -(total / 2)
  const out: { i: number; x: number; y: number; z: number }[] = []
  for (let i = 0; i < count; i++) {
    const angle = i * ((Math.PI * 2) / LAYOUT.imagesPerTurn)
    let y = startY + i * LAYOUT.spiralStep + scrollOffset
    y = (((y + total * 0.5) % total) + total) % total - total * 0.5
    out.push({
      i,
      x: Math.sin(angle) * LAYOUT.radius,
      y,
      z: Math.cos(angle) * LAYOUT.radius,
    })
  }
  return out
}

/** Closest pair of slot centres over a full wrap of the scroll. */
function closestPair(count: number) {
  let worst = Infinity
  const total = count * LAYOUT.spiralStep
  for (let s = 0; s < total; s += 0.05) {
    const p = slotPositions(count, s)
    for (let a = 0; a < p.length; a++) {
      for (let b = a + 1; b < p.length; b++) {
        const d = Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y, p[a].z - p[b].z)
        if (d < worst) worst = d
      }
    }
  }
  return worst
}

describe("ring geometry — no two slots in the same place", () => {
  it("holds a whole number of turns, on both backends", () => {
    // This is the whole fix. The Y wrap sends a slot leaving the top round to
    // the bottom, and it only lands where the next slot down should be if the
    // angular travel over `count` slots is a whole number of revolutions.
    for (const backend of ["webgpu", "wasm"] as const) {
      const count = instanceCountFor(backend)
      expect(count % LAYOUT.imagesPerTurn).toBe(0)
    }
  })

  it("keeps every pair of slots further apart than a slot is wide", () => {
    for (const backend of ["webgpu", "wasm"] as const) {
      const count = instanceCountFor(backend)
      // Anything under the slot width means one cutout drawn through another.
      expect(closestPair(count)).toBeGreaterThan(LAYOUT.planeWidth * 0.9)
    }
  })

  it("collapses when the turn count is fractional, which is the bug", () => {
    // Guards the reasoning, not the code: 20 slots at 9 per turn is 2.22 turns
    // and puts two slots 1.6 apart in a 4.2-wide slot. If this ever stops
    // failing, the wrap has changed and the invariant above needs rethinking
    // rather than trusting.
    expect(20 % LAYOUT.imagesPerTurn).not.toBe(0)
    expect(closestPair(20)).toBeLessThan(LAYOUT.planeWidth * 0.5)
  })
})

describe("texture assignment — no repeat in one angular column", () => {
  /** Slots sharing an angle form a column; a repeat there is a visible stack. */
  function stripedColumns(count: number, unique: number) {
    const columns = new Map<number, number[]>()
    for (let i = 0; i < count; i++) {
      const col = i % LAYOUT.imagesPerTurn
      if (!columns.has(col)) columns.set(col, [])
      columns.get(col)!.push(textureIndexFor(i, count, unique))
    }
    let striped = 0
    for (const tiles of columns.values()) {
      if (new Set(tiles).size !== tiles.length) striped++
    }
    return striped
  }

  it("never repeats within a column when it is possible not to", () => {
    for (const backend of ["webgpu", "wasm"] as const) {
      const count = instanceCountFor(backend)
      const turns = count / LAYOUT.imagesPerTurn
      for (let unique = 1; unique <= 12; unique++) {
        const striped = stripedColumns(count, unique)
        if (unique >= turns) {
          expect(striped).toBe(0)
        } else {
          // Pigeonhole: fewer images than rows in a column cannot avoid one.
          expect(striped).toBeGreaterThan(0)
        }
      }
    }
  })

  it("beats plain cycling, which stripes whenever unique divides perTurn", () => {
    const count = instanceCountFor("webgpu")
    // Three cutouts at nine per turn is the case that showed this: every
    // column was a pair of identical images stacked on each other.
    const cycled = new Map<number, number[]>()
    for (let i = 0; i < count; i++) {
      const col = i % LAYOUT.imagesPerTurn
      if (!cycled.has(col)) cycled.set(col, [])
      cycled.get(col)!.push(i % 3)
    }
    const cycledStriped = [...cycled.values()].filter(
      (t) => new Set(t).size !== t.length
    ).length
    expect(cycledStriped).toBeGreaterThan(0)
    expect(stripedColumns(count, 3)).toBe(0)
  })

  it("stays in range for any input, including an empty atlas", () => {
    for (const unique of [0, 1, 5]) {
      for (let i = 0; i < 40; i++) {
        const tile = textureIndexFor(i, 18, unique)
        expect(tile).toBeGreaterThanOrEqual(0)
        expect(tile).toBeLessThan(Math.max(1, unique))
      }
    }
  })
})

describe("the full parameter set is surfaced", () => {
  it("offers every dither mode and shape the shader implements", () => {
    // The shader branches on these integers; a mode listed here that it does
    // not implement silently renders as the default.
    expect(DITHER_MODES.map((m) => m.value)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 15,
    ])
    expect(DITHER_SHAPES).toHaveLength(11)
    expect(new Set(DITHER_SHAPES.map((s) => s.value)).size).toBe(11)
  })

  it("defaults to the grid preset the reference is recognised by", () => {
    const base = presetById(DEFAULT_PRESET_ID)
    expect(base.grid.enabled).toBe(true)
    expect(base.shape.kind).not.toBe("none")
  })

  it("gives every preset a complete grid and shape", () => {
    for (const p of PRESETS) {
      expect(typeof p.grid.radius).toBe("number")
      expect(p.grid.radius).toBeGreaterThan(LAYOUT.radius)
      expect(typeof p.shape.kind).toBe("string")
    }
  })
})
