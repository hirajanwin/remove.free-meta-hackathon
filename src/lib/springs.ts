// Fluid Functionalism motion tokens.
// Each tier's value is the ENTER transition — a critically damped spring,
// except the largest tier which keeps a subtle bounce.
// Its `.exit` is the matching EXIT transition — a crisp, quicker tween.

export const spring = {
  fast: {
    type: "spring" as const,
    duration: 0.08,
    bounce: 0,
    exit: { duration: 0.06 },
  },
  // Critically damped: lands precisely with no overshoot.
  // Ideal for dropdowns, tabs, sheets, and sidebars.
  moderate: {
    type: "spring" as const,
    duration: 0.16,
    bounce: 0,
    exit: { duration: 0.12 },
  },
  // Slow spring with subtle bounce for dialogs, modals, and hero reveals.
  slow: {
    type: "spring" as const,
    duration: 0.24,
    bounce: 0.12,
    exit: { duration: 0.16 },
  },
} as const

export const exitFallbackMs = (tier: { exit: { duration: number } }) =>
  Math.round(tier.exit.duration * 1000) + 100

/**
 * The standard easing curve, matching `--default-transition-timing-function`
 * in app.css and the critically damped springs above, for the rare transition
 * that has to be built as a string rather than a class.
 */
export const easeStandard = "cubic-bezier(0.2, 0, 0, 1)"

/**
 * The fourth tier: the cutout reveal.
 *
 * Deliberately slower than `slow` (240ms). This is the one moment the product
 * exists for, it happens once per image, and at 240ms the background was gone
 * before the eye had followed it. It lives here rather than in the route so
 * that no component invents its own timing — a tier with a stated reason is
 * still a tier.
 *
 * A tween, not a spring: it drives an `opacity` cross-fade in plain CSS, and a
 * spring's overshoot has no meaning on a value clamped to [0, 1].
 */
export const reveal = {
  durationMs: 420,
  easing: easeStandard,
  /** Ready to assign to `style.transition`. */
  css: `opacity 420ms ${easeStandard}`,
} as const
