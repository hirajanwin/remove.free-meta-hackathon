import * as React from "react"
import { Button } from "@/components/ui/button"

// Guided tour: five coachmarks that walk the value chain — agent, tools,
// layers, Meta features, export. Targets are found by data-tour / id, the
// card sits next to the highlight, and missing targets are skipped rather
// than breaking the walk (the right sidebar can be closed).
//
// Started from the left sidebar's Guide button or the empty state; the
// seen flag lives in localStorage so it never nags twice uninvited.

export interface TourStep {
  target: string
  title: string
  body: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    target: '[data-tour="start"]',
    title: "Start here",
    body: "Drop a photo, pick a sample, or run the 60-second demo and watch the whole chain work on the retriever. Everything after this is refinement.",
  },
  {
    target: '[data-tour="command"]',
    title: "Start with a sentence",
    body: "Tell the agent what you want — “keep the dog on white”. Muse plans it, SAM 3.1 finds it, the local matte cuts it, and a measured check verifies it.",
  },
  {
    target: '[data-tour="dock"]',
    title: "Every tool, one key away",
    body: "The dock on the canvas's right edge: object select, select-similar, marquee, lasso, pen, brush, healing, clone stamp, eyedropper. Each has a letter shortcut (hover to see it).",
  },
  {
    target: "#panel-layers",
    title: "Layers you can reason about",
    body: "Backdrop, SAM objects, subject, badge, caption — toggle eyes here. Hiding a SAM object re-proposes everything still visible.",
  },
  {
    target: "#panel-meta",
    title: "Meta AI, your key, your rules",
    body: "Paste your own Meta API key to unlock SAM 3.1 text layers, Muse Image backdrops and voice commands. No key? Everything local still works, including offline text select.",
  },
  {
    target: "#dl",
    title: "Finish and ship it",
    body: "Download the cutout, or use Social Pack (five platform sizes), Seller Pack (marketplace squares from Batch) and the share card. All rendered locally.",
  },
]

const SEEN_KEY = "remove-free:tour-done"

export function useTour() {
  const [step, setStep] = React.useState<number | null>(null)
  const [rect, setRect] = React.useState<DOMRect | null>(null)

  React.useEffect(() => {
    const start = () => setStep(0)
    window.addEventListener("start-tour", start)
    return () => window.removeEventListener("start-tour", start)
  }, [])

  React.useEffect(() => {
    if (step === null) return
    // Skip steps whose target is not on screen right now.
    const el = document.querySelector(TOUR_STEPS[step].target)
    if (!el) {
      if (step < TOUR_STEPS.length - 1) setStep(step + 1)
      else setStep(null)
      return
    }
    el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    const update = () => setRect(el.getBoundingClientRect())
    update()
    const t = setTimeout(update, 350)
    window.addEventListener("resize", update)
    return () => {
      clearTimeout(t)
      window.removeEventListener("resize", update)
    }
  }, [step])

  const close = React.useCallback(() => {
    setStep(null)
    try {
      localStorage.setItem(SEEN_KEY, "1")
    } catch {
      // private mode: tour simply re-offers
    }
  }, [])

  return { step, setStep, rect, close }
}

export function TourOverlay({
  step,
  rect,
  onStep,
  onClose,
}: {
  step: number
  rect: DOMRect | null
  onStep: (n: number | null) => void
  onClose: () => void
}) {
  if (!rect) return null
  const current = TOUR_STEPS[step]
  const cardW = 320
  const left = Math.min(
    Math.max(12, rect.left),
    Math.max(12, window.innerWidth - cardW - 12)
  )
  const below = rect.bottom + 10 + 170 < window.innerHeight
  const top = below ? rect.bottom + 10 : Math.max(12, rect.top - 180)

  return (
    <>
      <div
        aria-hidden
        className="fixed z-[60] rounded-xl outline outline-2 outline-[color:var(--focus-ring,#6B97FF)] outline-offset-2 pointer-events-none"
        style={{
          left: rect.left - 4,
          top: rect.top - 4,
          width: rect.width + 8,
          height: rect.height + 8,
        }}
      />
      <div
        role="dialog"
        aria-label={`Tour: ${current.title}`}
        className="fixed z-[61] rounded-2xl bg-surface-2 shadow-surface-4 p-3.5 space-y-2"
        style={{ left, top, width: cardW }}
      >
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-muted-foreground">
            {step + 1} of {TOUR_STEPS.length}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
        </div>
        <h2 className="text-[13px] font-semibold text-foreground">{current.title}</h2>
        <p className="text-[11px] leading-relaxed text-muted-foreground">{current.body}</p>
        <div className="flex items-center gap-1.5 pt-1">
          {step > 0 && (
            <Button size="compact" variant="ghost" onClick={() => onStep(step - 1)} className="text-[11px] h-7">
              Back
            </Button>
          )}
          <Button
            size="compact"
            variant="primary"
            onClick={() => (step < TOUR_STEPS.length - 1 ? onStep(step + 1) : onClose())}
            className="text-[11px] h-7 flex-1"
          >
            {step < TOUR_STEPS.length - 1 ? "Next" : "Done"}
          </Button>
        </div>
        <div className="flex gap-1 justify-center">
          {TOUR_STEPS.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={
                "size-1.5 rounded-full " + (i === step ? "bg-foreground" : "bg-muted-foreground/30")
              }
            />
          ))}
        </div>
      </div>
    </>
  )
}

export function tourSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1"
  } catch {
    return false
  }
}
