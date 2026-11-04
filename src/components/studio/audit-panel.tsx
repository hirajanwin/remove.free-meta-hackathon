import * as React from "react"
import { Cloud, Cpu, Download, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  addRunLogListener,
  clearRunLog,
  formatCost,
  formatMs,
  getRunLog,
  whereLabel,
  type RunEntry,
} from "@/lib/run-info"

/**
 * The audit trail: everything the app did, with model, place, time and
 * cost. It is also the demo's credibility layer — a judge can open this
 * and see exactly which operations were local ($0) and which went to
 * Meta's cloud, instead of taking the privacy pitch on faith.
 */
export function AuditPanel() {
  const [log, setLog] = React.useState<RunEntry[]>(() => getRunLog())
  React.useEffect(() => addRunLogListener(setLog), [])

  const cloudCost = log.reduce((sum, e) => sum + (e.cost ?? 0), 0)
  const localCount = log.filter((e) => e.where !== "cloud").length

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "remove-free-audit.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  if (log.length === 0) {
    return (
      <div className="space-y-2 py-2">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Nothing yet. Every matte, selection, agent run and export will be
          recorded here with its model, where it ran, how long it took and
          what it cost.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 py-1">
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>
          {log.length} ops · {localCount} local · cloud {formatCost(cloudCost)}
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={exportJson}
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-foreground"
            title="Download audit log as JSON"
          >
            <Download className="size-3" /> JSON
          </button>
          <button
            type="button"
            onClick={clearRunLog}
            className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-hover hover:text-foreground"
            title="Clear audit log"
          >
            <Trash2 className="size-3" /> Clear
          </button>
        </span>
      </div>

      <ol className="space-y-1">
        {log.map((e) => (
          <li key={e.id} className="rounded-lg bg-surface-2 shadow-surface-1 px-2 py-1.5 space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-foreground truncate">{e.action}</span>
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {formatMs(e.ms)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground min-w-0">
              {e.where === "cloud" ? (
                <Cloud className="size-3 shrink-0" />
              ) : (
                <Cpu className="size-3 shrink-0" />
              )}
              <span className="truncate">{e.model}</span>
              <span aria-hidden>·</span>
              <span className="shrink-0">{whereLabel(e.where)}</span>
              <span aria-hidden>·</span>
              <span className={"shrink-0 font-mono " + (e.cost === 0 ? "text-ok" : "")}>
                {formatCost(e.cost)}
              </span>
            </div>
            {e.detail && (
              <p className="text-[10px] text-muted-foreground truncate" title={e.detail}>
                {e.detail}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Latest-run summary bar for the middle panel. */
export function LatestRunBar() {
  const [log, setLog] = React.useState<RunEntry[]>(() => getRunLog())
  React.useEffect(() => addRunLogListener(setLog), [])
  const latest = log[0]
  if (!latest) return null
  return (
    <div
      className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground truncate"
      title={`${latest.action} — ${latest.model} · ${whereLabel(latest.where)} · ${formatMs(latest.ms)} · ${formatCost(latest.cost)}${latest.detail ? ` · ${latest.detail}` : ""}`}
    >
      {latest.where === "cloud" ? <Cloud className="size-3 shrink-0" /> : <Cpu className="size-3 shrink-0" />}
      <span className="text-foreground/80 truncate">{latest.model}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0">{whereLabel(latest.where)}</span>
      <span aria-hidden>·</span>
      <span className="shrink-0">{formatMs(latest.ms)}</span>
      <span aria-hidden>·</span>
      <span className={latest.cost === 0 ? "text-ok shrink-0" : "shrink-0"}>{formatCost(latest.cost)}</span>
    </div>
  )
}
