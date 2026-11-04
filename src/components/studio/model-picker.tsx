"use client";

import { useEffect, useState } from "react"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { Tooltip } from "@/components/ui/tooltip"
import {
  MODELS,
  formatBytes,
  type Backend,
} from "@/lib/models"
import {
  addProgressListener,
  getActiveModelId,
  setActiveModel,
  type ProcessProgress,
} from "@/lib/bg-removal"
import { weightsSource } from "@/lib/weights"
import { useBackend } from "@/hooks/use-backend"

type LoadState =
  | { kind: "idle" }
  | { kind: "downloading"; percent: number }
  | { kind: "warming" }
  | { kind: "ready" }
  | { kind: "error"; message: string }

export function ModelPicker() {
  // Backend is a property of the device, not a user choice — every model runs on
  // both. Resolved on the client only, since navigator.gpu doesn't exist during
  // any static prerender.
  const backend = useBackend()
  const [modelId, setModelId] = useState<string>(getActiveModelId())
  const [state, setState] = useState<LoadState>({ kind: "idle" })

  useEffect(() => {
    // The selected model is already correct: bg-removal reads the stored
    // preference before it starts the worker.
    setModelId(getActiveModelId())
  }, [])

  useEffect(() => {
    return addProgressListener((p: ProcessProgress) => {
      // Ignore chatter about a model that isn't the selected one.
      if (p.modelId && p.modelId !== modelId) return

      switch (p.type) {
        case "init-start":
          setState({ kind: "downloading", percent: 0 })
          break
        case "download-progress":
          setState({ kind: "downloading", percent: Math.round(p.progress ?? 0) })
          break
        case "warming-up":
          setState({ kind: "warming" })
          break
        case "ready":
          setState({ kind: "ready" })
          break
        case "init-error":
          setState({ kind: "error", message: p.error ?? "Failed to load" })
          break
      }
    })
  }, [modelId])

  function select(next: string) {
    if (next === modelId) return
    setModelId(next)
    setState({ kind: "idle" })
    setActiveModel(next)
  }

  const selectedIndex = Math.max(
    0,
    MODELS.findIndex((m) => m.id === modelId)
  )
  const model = MODELS[selectedIndex] ?? MODELS[0]
  const variant = backend ? model.variants[backend] : null
  const caveat = backend ? model.caveats?.[backend] : undefined

  return (
    <div className="pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Neural Model
        </label>
        <Tooltip
          side="left"
          content={
            <span className="block max-w-[220px]">
              {backend === "webgpu"
                ? "WebGPU is available, so inference runs on the GPU."
                : "No WebGPU on this device, so inference runs on the CPU via WASM."}{" "}
              Both models run on either backend.
            </span>
          }
        >
          <span
            className={
              "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded cursor-help " +
              (backend === "webgpu"
                ? "text-ok bg-ok/10"
                : "text-warn bg-warn/10")
            }
          >
            {backend === null ? "…" : backend === "webgpu" ? "GPU" : "CPU"}
          </span>
        </Tooltip>
      </div>

      <TabsSubtle
        selectedIndex={selectedIndex}
        onSelect={(idx) => select(MODELS[idx]!.id)}
        size="compact"
        className="w-full flex"
      >
        {MODELS.map((m, i) => (
          <TabsSubtleItem key={m.id} index={i} label={m.label} />
        ))}
      </TabsSubtle>

      <p className="text-[11px] leading-snug text-muted-foreground">
        {model.tagline}
      </p>

      {/* Download size matters: this is fetched once per model per backend and
          cached in the browser, but it is not small. */}
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Download
        </span>
        <span className="text-[11px] font-mono text-foreground/80 font-medium">
          {variant ? formatBytes(variant.bytes) : "—"}
          {variant && (
            <span className="text-muted-foreground"> · {variant.precision ?? variant.dtype}</span>
          )}
        </span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          Status
        </span>
        <span className="text-[11px] font-mono font-medium">
          {state.kind === "downloading" && (
            <span className="text-muted-foreground">
              downloading {state.percent}%
            </span>
          )}
          {state.kind === "warming" && (
            <span className="text-muted-foreground">warming up</span>
          )}
          {state.kind === "ready" && <span className="text-ok">ready</span>}
          {state.kind === "idle" && (
            <span className="text-muted-foreground">idle</span>
          )}
          {state.kind === "error" && (
            <Tooltip
              side="left"
              content={<span className="block max-w-[240px]">{state.message}</span>}
            >
              <span className="text-danger cursor-help">failed</span>
            </Tooltip>
          )}
        </span>
      </div>

      {caveat && (
        <p className="text-[10px] leading-snug text-warn bg-warn/5 border border-warn/15 rounded-md px-2 py-1.5">
          {caveat}
        </p>
      )}

      {/* Attribution is a licence condition for RMBG (CC BY-NC), not a courtesy.
          Do not remove this, and do not hide the model's real identity. */}
      <div className="pt-1 border-t border-border/40 space-y-1">
        <div className="flex justify-between items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            License
          </span>
          <a
            href={model.license.url}
            target="_blank"
            rel="noreferrer noopener"
            className={
              "text-[10px] font-mono hover:underline " +
              (model.license.allowsCommercialUse
                ? "text-ok"
                : "text-warn")
            }
          >
            {model.license.id}
          </a>
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {model.attribution}
        </p>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Weights fetched from{" "}
          {weightsSource() === "r2" ? "our object storage" : "Hugging Face"} and
          cached in your browser. Images never leave this device.
        </p>
      </div>
    </div>
  )
}
