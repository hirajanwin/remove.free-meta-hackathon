import * as React from "react"

import { addProgressListener, type ProcessProgress } from "@/lib/bg-removal"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"

/**
 * Loading a model has two phases that feel entirely different.
 *
 * Fetching the weights has a percentage. Compiling the graph afterwards does
 * not — transformers.js reports nothing while the runtime builds shaders — and
 * for BiRefNet on WebGPU it takes about eight seconds. /bench measured a cold
 * run at 10.2 s with the weights ALREADY cached against a 2 s warm run, so
 * almost all of that is compilation rather than download.
 *
 * Showing "Downloading… 100%" across that stretch reads as a hang, which is why
 * the two are separated and the compile phase counts elapsed seconds instead of
 * a percentage it cannot know.
 */
export type LoadPhase = "idle" | "downloading" | "compiling"

export interface ModelLoadState {
  phase: LoadPhase
  message: string
  percent: number
  /** Seconds spent compiling. Meaningless in any other phase. */
  elapsed: number
}

export function useModelLoad(): ModelLoadState {
  const [phase, setPhase] = React.useState<LoadPhase>("idle")
  const [message, setMessage] = React.useState("")
  const [percent, setPercent] = React.useState(0)
  const [elapsed, setElapsed] = React.useState(0)

  /**
   * Bytes per file, because transformers.js reports progress *per file*.
   * A model is several files (weights, tokenizer, config), so forwarding the
   * raw number made the bar reach 100%, drop back to 75% and climb again —
   * observed going 100 -> 75 while loading RMBG. Summing the parts is the only
   * way the number means anything.
   */
  const files = React.useRef(new Map<string, { loaded: number; total: number }>())

  React.useEffect(
    () =>
      addProgressListener((p: ProcessProgress) => {
        if (p.type === "init-start") {
          files.current.clear()
          setPhase("downloading")
          setPercent(0)
          setMessage(`Fetching ${p.modelLabel ?? "the model"}...`)
        } else if (p.type === "download-progress") {
          setPhase("downloading")
          setMessage("Downloading model weights...")

          if (p.total) {
            files.current.set(p.file ?? "weights", {
              loaded: p.loaded ?? 0,
              total: p.total,
            })
            let loaded = 0
            let total = 0
            for (const f of files.current.values()) {
              loaded += f.loaded
              total += f.total
            }
            // Only ever climb: a file whose size is not known until it starts
            // downloading would otherwise still push the total up and the
            // percentage down.
            setPercent((prev) =>
              total ? Math.max(prev, Math.min(100, Math.round((loaded / total) * 100))) : prev
            )
          } else if (p.progress !== undefined) {
            setPercent((prev) => Math.max(prev, Math.round(p.progress!)))
          }
        } else if (p.type === "warming-up") {
          setPhase("compiling")
          setMessage("Compiling the model for your GPU...")
        } else if (p.type === "ready" || p.type === "init-error") {
          setPhase("idle")
          setMessage("")
        }
      }),
    []
  )

  React.useEffect(() => {
    if (phase !== "compiling") {
      setElapsed(0)
      return
    }
    const started = performance.now()
    const t = window.setInterval(
      () => setElapsed(Math.round((performance.now() - started) / 1000)),
      500
    )
    return () => window.clearInterval(t)
  }, [phase])

  return { phase, message, percent, elapsed }
}

/**
 * The strip shown while a model loads.
 *
 * Rendered on every route that can trigger a load, not just the studio. Batch
 * and Video had no feedback at all: a first-time visitor dropping a file there
 * waited through a 109 MiB download with nothing on screen to say so.
 */
export function ModelLoadBar({ className = "" }: { className?: string }) {
  const { phase, message, percent, elapsed } = useModelLoad()
  if (phase === "idle") return null

  return (
    <div
      className={
        "px-4 py-2 bg-surface-2 shrink-0 flex items-center justify-between text-xs text-foreground font-medium shadow-surface-1 " +
        className
      }
    >
      <ThinkingIndicator words={[message]} size="compact" />
      <span className="font-mono text-[11px] text-muted-foreground">
        {phase === "compiling" ? `${elapsed}s` : `${percent}%`}
      </span>
    </div>
  )
}
