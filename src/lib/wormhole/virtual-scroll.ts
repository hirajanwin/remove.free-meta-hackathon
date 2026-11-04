// Momentum scroll for the wormhole.
//
// Straight from the reference's `useVirtualScroll`: input adds impulse,
// friction decays velocity, position accumulates. What changed is where it
// listens and what it accepts.
//
// The reference attaches `wheel` to `window` with `preventDefault()`, because
// its page is nothing but the gallery. Doing that here would stop every other
// page in the app from scrolling, since this app is a studio with sidebars and
// long routes — so the listener goes on the canvas and only cancels the event
// while the pointer is actually over it.
//
// It also only accepts wheel and touch. Wheel and touch are both pointer
// affordances; a page whose only control is the scroll wheel cannot be operated
// from a keyboard at all. `impulse()` is exposed so arrow keys can drive the
// same physics rather than a parallel path that behaves differently.

export interface VirtualScroll {
  offset: { current: number }
  velocity: { current: number }
  friction: { current: number }
  /** Add an impulse from any source. Arrow keys use this. */
  impulse: (delta: number) => void
  /** Advance the physics one frame. Call from the render loop. */
  update: () => void
  /** Attach input listeners to an element. Returns its own teardown. */
  attach: (element: HTMLElement) => () => void
}

const WHEEL_SCALE = 0.01
const TOUCH_SCALE = 0.01
/** Below this, velocity is snapped to zero so the ring stops rather than creeping. */
const REST_THRESHOLD = 0.0001

export function createVirtualScroll(initialFriction = 0.87): VirtualScroll {
  const offset = { current: 0 }
  const velocity = { current: 0 }
  const friction = { current: initialFriction }
  const pending = { current: 0 }

  const impulse = (delta: number) => {
    pending.current += delta
  }

  const update = () => {
    velocity.current += pending.current
    pending.current = 0
    velocity.current *= friction.current
    if (Math.abs(velocity.current) < REST_THRESHOLD) velocity.current = 0
    offset.current += velocity.current
  }

  const attach = (element: HTMLElement) => {
    let lastTouchY = 0

    const onWheel = (e: WheelEvent) => {
      // Only claim the gesture when it is genuinely ours. A trackpad swipe that
      // starts on the canvas but is mostly horizontal is probably the user
      // trying to go back, and the page behind still has to be scrollable when
      // the wormhole does not fill it.
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      e.preventDefault()
      impulse(e.deltaY * WHEEL_SCALE)
    }

    const onTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0].clientY
      velocity.current = 0
    }

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault()
      const y = e.touches[0].clientY
      impulse((lastTouchY - y) * TOUCH_SCALE)
      lastTouchY = y
    }

    element.addEventListener("wheel", onWheel, { passive: false })
    element.addEventListener("touchstart", onTouchStart, { passive: true })
    element.addEventListener("touchmove", onTouchMove, { passive: false })

    return () => {
      element.removeEventListener("wheel", onWheel)
      element.removeEventListener("touchstart", onTouchStart)
      element.removeEventListener("touchmove", onTouchMove)
    }
  }

  return { offset, velocity, friction, impulse, update, attach }
}

/**
 * One arrow press, in the same units a wheel notch produces.
 *
 * A trackpad notch is around 100 deltaY, so this is roughly "one flick" and
 * keyboard travel matches pointer travel instead of being a token gesture.
 */
export const KEY_IMPULSE = 100 * WHEEL_SCALE
