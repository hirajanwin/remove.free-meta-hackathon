// Run log: every meaningful thing the app did, with provenance.
//
// One entry per operation — a matte, a SAM call, an agent run, an export —
// recording which model did it, where it ran (this device or Meta's
// cloud), how long it took, and what it cost. The middle panel shows the
// latest entry; the Audit tab shows all of them. Zero cost is stated, not
// implied: local work is free and the log says so.

export type RunWhere = "device-gpu" | "device-cpu" | "cloud"

export interface RunEntry {
  id: string
  at: number
  /** What happened, in the user's words: "Background removal", "SAM text select 'dog'". */
  action: string
  /** Model that did it, by its display label. */
  model: string
  where: RunWhere
  ms?: number
  /** USD cost. 0 means provably free (local). Undefined = not applicable. */
  cost?: number
  /** Extra measured detail: "800×1283 · subject 16.1% · confidence 0.91". */
  detail?: string
}

const MAX_ENTRIES = 60

let entries: RunEntry[] = []
const listeners = new Set<(entries: RunEntry[]) => void>()

export function recordRun(entry: Omit<RunEntry, "id" | "at">) {
  const full: RunEntry = {
    ...entry,
    id: `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    at: Date.now(),
  }
  entries = [full, ...entries].slice(0, MAX_ENTRIES)
  listeners.forEach((cb) => cb(entries))
}

export function getRunLog(): RunEntry[] {
  return entries
}

export function clearRunLog() {
  entries = []
  listeners.forEach((cb) => cb(entries))
}

export function addRunLogListener(cb: (entries: RunEntry[]) => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function whereLabel(where: RunWhere): string {
  return where === "cloud"
    ? "Meta cloud"
    : where === "device-gpu"
      ? "On-device GPU"
      : "On-device CPU"
}

export function formatCost(cost: number | undefined): string {
  if (cost === undefined) return "—"
  if (cost === 0) return "$0"
  return `~$${cost.toFixed(cost < 0.01 ? 4 : 2)}`
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
