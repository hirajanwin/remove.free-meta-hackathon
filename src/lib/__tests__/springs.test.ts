import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { spring, reveal, easeStandard, exitFallbackMs } from "../springs"

const css = readFileSync(new URL("../../styles/app.css", import.meta.url), "utf8")

describe("motion tokens", () => {
  it("orders the tiers, slowest last", () => {
    const ms = [spring.fast, spring.moderate, spring.slow].map((t) => t.duration * 1000)
    expect(ms).toEqual([...ms].sort((a, b) => a - b))
    // The reveal is a deliberate fourth tier, slower than every spring.
    expect(reveal.durationMs).toBeGreaterThan(spring.slow.duration * 1000)
  })

  it("exits quicker than it enters, on every tier", () => {
    for (const tier of [spring.fast, spring.moderate, spring.slow]) {
      expect(tier.exit.duration).toBeLessThan(tier.duration)
    }
  })

  it("clears a tier's exit before the fallback fires", () => {
    expect(exitFallbackMs(spring.moderate)).toBeGreaterThan(spring.moderate.exit.duration * 1000)
  })

  // app.css says it mirrors this file. This is the assertion that keeps that
  // true — the two drifted once already.
  it("shares its easing curve with the CSS default", () => {
    const match = css.match(/--default-transition-timing-function:\s*([^;]+);/)
    expect(match?.[1].trim()).toBe(easeStandard)
    expect(reveal.css).toContain(easeStandard)
  })

  it("matches the CSS default duration to the fast tier", () => {
    const match = css.match(/--default-transition-duration:\s*(\d+)ms;/)
    expect(Number(match?.[1])).toBe(spring.fast.duration * 1000)
  })
})
