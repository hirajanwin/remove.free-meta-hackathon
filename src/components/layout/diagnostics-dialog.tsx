import * as React from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Cpu, Sparkles, HardDrive, CheckCircle2, AlertTriangle, RefreshCw, X, ArrowRight } from "lucide-react"
import { Link } from "@tanstack/react-router"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatBytes } from "@/lib/models"
import {
  readCacheReport,
  removeAllModelCaches,
  STORAGE_ESTIMATE_LAG_MS,
} from "@/lib/model-cache"
import { setBackend } from "@/lib/bg-removal"
import { getBackendOverride, type Backend } from "@/lib/models"
import { spring } from "@/lib/springs"

export function DiagnosticsDialog({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
} = {}) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = (val: boolean) => {
    if (!isControlled) setInternalOpen(val)
    onOpenChange?.(val)
  }

  const [gpuInfo, setGpuInfo] = React.useState<{
    hasWebGPU: boolean
    adapterVendor?: string
    adapterArchitecture?: string
    adapterDescription?: string
  }>({ hasWebGPU: false })

  const [override, setOverride] = React.useState<Backend | null>(() => getBackendOverride())
  const [cacheSize, setCacheSize] = React.useState<string>("Calculating...")
  const [modelBytes, setModelBytes] = React.useState<number | null>(null)
  const [clearing, setClearing] = React.useState(false)
  const [cleared, setCleared] = React.useState<string | null>(null)

  React.useEffect(() => {
    const handleOpen = () => setOpen(true)
    window.addEventListener("open-diagnostics", handleOpen)
    return () => window.removeEventListener("open-diagnostics", handleOpen)
  }, [])

  /**
   * Origin total and this app's model total, which are different numbers.
   *
   * The readout used to show only the origin estimate, which includes the app
   * shell and the history vault — so it never went to zero after clearing and
   * read as though clearing had not worked.
   */
  const checkStorage = React.useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
      try {
        const { usage, quota } = await navigator.storage.estimate()
        const mbUsed = ((usage || 0) / (1024 * 1024)).toFixed(1)
        const gbQuota = ((quota || 0) / (1024 * 1024 * 1024)).toFixed(1)
        setCacheSize(`${mbUsed} MB used of ${gbQuota} GB quota`)
      } catch {
        setCacheSize("Storage API inaccessible")
      }
    }
    try {
      const report = await readCacheReport()
      setModelBytes(report.totalModelBytes)
    } catch {
      setModelBytes(null)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return

    async function checkGPU() {
      if (typeof navigator !== "undefined" && (navigator as any).gpu) {
        try {
          const adapter = await (navigator as any).gpu.requestAdapter()
          if (adapter) {
            const info = (adapter as any).info || {}
            setGpuInfo({
              hasWebGPU: true,
              adapterVendor: info.vendor || "Hardware GPU",
              adapterArchitecture: info.architecture || "Modern GPU",
              adapterDescription: info.description || "Direct WebGPU Compute Provider",
            })
          } else {
            setGpuInfo({ hasWebGPU: false })
          }
        } catch {
          setGpuInfo({ hasWebGPU: false })
        }
      } else {
        setGpuInfo({ hasWebGPU: false })
      }
    }

    checkGPU()
    void checkStorage()
  }, [open, checkStorage])

  /**
   * Clear the model caches.
   *
   * This used to match keys containing "transformers" or "huggingface". Our
   * buckets are named `remove-free-<model>-<backend>` — none of which contain
   * either string — so the button deleted nothing at all and then popped an
   * alert saying the cache was cleared. It only ever caught the depth model,
   * which happens to sit in transformers.js's default bucket because no
   * cacheKey was set for it.
   *
   * Deleting by name is now the model registry's job, so the names cannot
   * drift apart again.
   */
  const clearModelCache = async () => {
    setClearing(true)
    setCleared(null)
    try {
      const removed = await removeAllModelCaches()
      setCleared(
        removed.length
          ? `Removed ${removed.length} ${removed.length === 1 ? "model" : "models"}. They re-download when next used.`
          : "Nothing was cached."
      )
      await checkStorage()
      // The origin estimate lags the deletion; read it again once it has
      // settled. See STORAGE_ESTIMATE_LAG_MS.
      window.setTimeout(() => void checkStorage(), STORAGE_ESTIMATE_LAG_MS)
    } catch (e: any) {
      setCleared(`Could not clear: ${e?.message || e}`)
    } finally {
      setClearing(false)
    }
  }

  // Close on Escape, the way a sheet should.
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  /**
   * A sheet inside the sidebar, not a modal over the app.
   *
   * Diagnostics is a status readout, not a decision — dimming the whole
   * workspace and taking focus to show a cache size is a heavier gesture than
   * the content deserves. It now rises out of the hardware badge it belongs to,
   * which also means the cutout stays visible behind it.
   *
   * The narrow column forces the layout to be honest: the two engine cards
   * stack instead of sitting side by side, and nothing here needed the width.
   */
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: spring.moderate.exit.duration }}
            onClick={() => setOpen(false)}
            // Lighter than --scrim on purpose: this dims the sidebar the sheet
            // rises out of, not the whole app, and the cutout behind it should
            // stay readable.
            className="absolute inset-0 z-30 bg-black/40"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-label="System and AI engine diagnostics"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 12, opacity: 0 }}
            // spring.moderate — the tier for sheets and sidebars. It should
            // feel like the badge expanding, not a panel flying in.
            transition={spring.moderate}
            className="absolute inset-x-2 bottom-2 z-40 flex max-h-[78%] flex-col overflow-hidden rounded-xl bg-surface-2 shadow-surface-4"
          >
            {/* The header stays put; only the readout scrolls. With a native
                overflow on the whole sheet the title scrolled away too. */}
            <div className="flex items-start justify-between gap-2 p-3 pb-1.5 shrink-0">
              <div className="min-w-0">
                <h2 className="text-[13px] font-semibold text-foreground flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-muted-foreground shrink-0" />
                  Engine Diagnostics
                </h2>
                <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                  Acceleration, model cache and local inference status.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close diagnostics"
                className="shrink-0 size-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-hover transition-colors duration-80"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-3 [&>div]:space-y-2.5 text-[12px]">
              {/* Execution provider */}
              <section className="rounded-lg bg-surface-3 shadow-surface-1 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Provider
                  </span>
                  {gpuInfo.hasWebGPU ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-ok">
                      <Sparkles className="size-3" /> WebGPU
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono text-warn">
                      <AlertTriangle className="size-3" /> WASM CPU
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">
                  {gpuInfo.hasWebGPU
                    ? `${gpuInfo.adapterVendor || "GPU"} · ${gpuInfo.adapterArchitecture || "accelerated"}`
                    : "No WebGPU here — running on the CPU runtime."}
                </p>

                {gpuInfo.hasWebGPU && (
                  <div className="pt-0.5 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        const next = override === "wasm" ? null : "wasm"
                        setBackend(next)
                        setOverride(next)
                      }}
                      className={
                        "w-full text-[10px] font-mono uppercase tracking-wider px-1.5 py-1 rounded-md transition-colors duration-80 " +
                        (override === "wasm"
                          ? "text-warn bg-warn/10"
                          : "text-muted-foreground bg-surface-4 hover:bg-surface-5 hover:text-foreground")
                      }
                    >
                      {override === "wasm" ? "CPU mode on" : "Force CPU mode"}
                    </button>
                    <p className="text-[11px] text-muted-foreground leading-snug">
                      Worth trying first if a cutout looks wrong or the tab
                      crashes — those are usually GPU-specific. Persists.
                    </p>
                  </div>
                )}
              </section>

              {/* Engines — stacked, because at this width a two-column grid
                  wrapped every label onto three lines. */}
              <section className="rounded-lg bg-surface-3 shadow-surface-1 p-2.5 space-y-2">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  Engines
                </span>
                <div className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-foreground truncate">Ultra (GPU)</span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">~2-4s</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] text-foreground truncate">Fast (CPU)</span>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">~6-10s</span>
                  </div>
                </div>
              </section>

              {/* Cache */}
              <section className="rounded-lg bg-surface-3 shadow-surface-1 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <HardDrive className="size-3" /> Cache
                  </span>
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={clearModelCache}
                    disabled={clearing || modelBytes === 0}
                    className="h-6 px-1.5 text-[10px] gap-1"
                  >
                    <RefreshCw className={cn("size-3", clearing && "animate-spin")} />
                    {clearing ? "Clearing" : "Clear"}
                  </Button>
                </div>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {modelBytes !== null && (
                    <span className="text-foreground">
                      {formatBytes(modelBytes)} in models
                    </span>
                  )}
                  {modelBytes !== null && " · "}
                  <span title="Reported by the browser, and approximate — it lags a deletion by a second or two.">
                    {cacheSize}
                  </span>
                </p>
                {cleared && (
                  <p role="status" className="text-[11px] text-ok leading-snug">
                    {cleared}
                  </p>
                )}
                <Link
                  to="/models"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-80"
                >
                  Per-model detail and removal
                  <ArrowRight className="size-3" />
                </Link>
              </section>

              <div className="flex items-start gap-1.5 rounded-lg bg-ok/8 p-2.5">
                <CheckCircle2 className="size-3.5 text-ok shrink-0 mt-px" />
                <p className="text-[11px] text-muted-foreground leading-snug">
                  <span className="text-foreground font-medium">Zero uploads.</span>{" "}
                  Every byte is processed in this browser's worker.
                </p>
              </div>
            </ScrollArea>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
