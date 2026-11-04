import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import {
  HardDrive,
  Trash2,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
  Check,
  Cpu,
  Sparkles,
  Mountain,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  formatBytes,
  variantFor,
  type Backend,
  type ModelDef,
} from "@/lib/models"
import {
  readCacheReport,
  removeCache,
  removeAllModelCaches,
  STORAGE_ESTIMATE_LAG_MS,
  type CacheReport,
  type CacheState,
  type ModelCacheRow,
} from "@/lib/model-cache"
import { getActiveModelId } from "@/lib/bg-removal"
import { useBackend } from "@/hooks/use-backend"

export const Route = createFileRoute("/models")({
  component: ModelsPage,
})

/**
 * One copy of onnxruntime-web's wasm, measured from the cache rather than from
 * the package: 4.73 MiB over the wire brotli-encoded, 23.57 MiB stored.
 */
const RUNTIME_COPY = 23_567_050

const BACKEND_LABEL: Record<Backend, string> = {
  webgpu: "WebGPU",
  wasm: "WASM CPU",
}

function ModelsPage() {
  const [report, setReport] = React.useState<CacheReport | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const backend = useBackend()
  const activeId = getActiveModelId()

  const refresh = React.useCallback(async () => {
    try {
      setReport(await readCacheReport())
      setError(null)
    } catch (err: any) {
      setError(err?.message || String(err))
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  /**
   * Read once now, then once more after the storage estimate has caught up.
   * See STORAGE_ESTIMATE_LAG_MS — the cache totals are instant, the origin
   * estimate is not, and showing them together while they disagree reads as a
   * removal that did not work.
   */
  const refreshTwice = React.useCallback(async () => {
    await refresh()
    window.setTimeout(() => void refresh(), STORAGE_ESTIMATE_LAG_MS)
  }, [refresh])

  const remove = async (key: string, label: string) => {
    setBusy(key)
    setNote(null)
    try {
      const gone = await removeCache(key)
      // Say what happened rather than assuming it worked. A bucket can be
      // absent already — two tabs open, or the browser evicted it.
      setNote(gone ? `Removed ${label}.` : `${label} was already gone.`)
      await refreshTwice()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  const removeEverything = async () => {
    setBusy("__all__")
    setNote(null)
    try {
      const removed = await removeAllModelCaches()
      setNote(
        removed.length
          ? `Removed ${removed.length} cached ${removed.length === 1 ? "model" : "models"}.`
          : "Nothing was cached."
      )
      await refreshTwice()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  const cachedCount =
    (report?.models.filter((r) => r.state.present).length ?? 0) +
    (report?.aux.filter((r) => r.state?.present).length ?? 0)

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full p-4 md:p-6">
      {/* ─── Header + storage total ─── */}
      <div className="flex flex-col gap-4 p-4.5 rounded-2xl bg-surface-2 shadow-surface-1">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <HardDrive className="size-5 text-foreground" />
                Model Manager
              </h1>
              <Badge variant="secondary" dot={true} className="text-[10px]">
                {BACKEND_LABEL[backend]}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              Every model runs on your device, which means every model was
              downloaded to it. This is what is actually stored, measured from
              the cache rather than estimated from the registry — and each one
              can be removed. Removing a model does not disable it; the next
              time you pick it, it downloads again.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              onClick={() => void refresh()}
              variant="secondary"
              size="compact"
              className="gap-1.5"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
            <Button
              onClick={() => void removeEverything()}
              variant="destructive"
              size="compact"
              disabled={busy !== null || cachedCount === 0}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {busy === "__all__" ? "Removing…" : "Remove all"}
            </Button>
          </div>
        </div>

        {report && (
          <StorageBar
            modelBytes={report.totalModelBytes}
            runtimeBytes={report.totalRuntimeBytes}
            usage={report.usage}
            quota={report.quota}
          />
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-4 rounded-2xl bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {note && (
        <div
          role="status"
          className="flex items-center gap-2 p-3 rounded-2xl bg-surface-2 shadow-surface-1 text-xs text-foreground"
        >
          <Check className="size-3.5 text-ok shrink-0" />
          <span>{note}</span>
        </div>
      )}

      {!report && (
        <p className="text-xs text-muted-foreground px-1">Reading the cache…</p>
      )}

      {/* ─── Matting models ─── */}
      {report && (
        <section className="space-y-3">
          <SectionHeading
            icon={<Sparkles className="size-3.5" />}
            title="Matting models"
            hint="The network that decides which pixels are the subject. Your pick, per image."
          />
          {groupByModel(report.models).map(([model, rows]) => (
            <ModelCard
              key={model.id}
              model={model}
              rows={rows}
              isActive={model.id === activeId}
              busy={busy}
              onRemove={remove}
            />
          ))}
        </section>
      )}

      {/* ─── Depth models ─── */}
      {report && (
        <section className="space-y-3">
          <SectionHeading
            icon={<Mountain className="size-3.5" />}
            title="Depth models"
            hint="Chosen on the Depth tab. Per model and backend, like the matting ones — the bokeh backdrop uses the small one."
          />
          <div className="rounded-2xl bg-surface-2 shadow-surface-1 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Backend</TableHead>
                  <TableHead>Output</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Download</TableHead>
                  <TableHead className="text-right whitespace-nowrap">On disk</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.depth.map((row) => (
                  <TableRow key={row.state.key}>
                    <TableCell className="font-medium text-foreground whitespace-nowrap">
                      {row.model.label}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {BACKEND_LABEL[row.backend]}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {row.model.kind === "metric" ? "metres" : "relative"}
                    </TableCell>
                    <TableCell>
                      <LicenseBadge
                        id={row.model.license.id}
                        url={row.model.license.url}
                        commercial={row.model.license.allowsCommercialUse}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {formatBytes(row.expectedBytes)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {row.state.modelBytes ? formatBytes(row.state.modelBytes) : "—"}
                      {row.state.runtimeBytes > 0 && (
                        <span
                          className="block text-[10px] text-muted-foreground font-normal"
                          title="Shared inference runtime stored in this model's cache."
                        >
                          +{formatBytes(row.state.runtimeBytes)} runtime
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge state={row.state} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="compact"
                        disabled={!row.state.files.length || busy !== null}
                        onClick={() =>
                          void remove(
                            row.state.key,
                            `${row.model.label} (${BACKEND_LABEL[row.backend]})`
                          )
                        }
                        className="gap-1.5"
                      >
                        <Trash2 className="size-3.5" />
                        {busy === row.state.key ? "Removing…" : "Remove"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* ─── Supporting models ─── */}
      {report && (
        <section className="space-y-3">
          <SectionHeading
            icon={<Cpu className="size-3.5" />}
            title="Supporting models"
            hint="Pulled in by a specific feature rather than chosen. Never downloaded unless you use that feature."
          />
          <div className="rounded-2xl bg-surface-2 shadow-surface-1 overflow-hidden">
            <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead>Used for</TableHead>
                    <TableHead>License</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Download</TableHead>
                    <TableHead className="text-right whitespace-nowrap">On disk</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.aux.map(({ model, state }) => (
                    <TableRow key={model.id}>
                      <TableCell className="font-medium text-foreground whitespace-nowrap">
                        {model.label}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-xs">
                        {model.usedFor}
                      </TableCell>
                      <TableCell>
                        <LicenseBadge
                          id={model.license.id}
                          url={model.license.url}
                          commercial={model.license.allowsCommercialUse}
                        />
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        ~{formatBytes(model.bytes)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {state?.bytes ? formatBytes(state.bytes) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <StatusBadge state={state} />
                      </TableCell>
                      <TableCell className="text-right">
                        {model.cacheKey ? (
                          <Button
                            variant="ghost"
                            size="compact"
                            disabled={!state?.files.length || busy !== null}
                            onClick={() => void remove(model.cacheKey!, model.label)}
                            className="gap-1.5"
                          >
                            <Trash2 className="size-3.5" />
                            {busy === model.cacheKey ? "Removing…" : "Remove"}
                          </Button>
                        ) : (
                          <span
                            className="text-[11px] text-muted-foreground whitespace-nowrap"
                            title={model.notRemovableBecause}
                          >
                            not removable
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
            </Table>
          </div>

          {report.aux
            .filter((r) => r.model.notRemovableBecause)
            .map(({ model }) => (
              <p
                key={model.id}
                className="text-[11px] text-muted-foreground leading-relaxed px-1"
              >
                <span className="text-foreground">{model.label}:</span>{" "}
                {model.notRemovableBecause}
              </p>
            ))}
        </section>
      )}

      {/* ─── Anything unaccounted for ─── */}
      {report && report.other.length > 0 && (
        <section className="space-y-3">
          <SectionHeading
            icon={<AlertTriangle className="size-3.5" />}
            title="Unrecognised caches"
            hint="Storage under a name no current model uses — most likely left by an earlier version. Safe to remove."
          />
          <div className="rounded-2xl bg-surface-2 shadow-surface-1 divide-y divide-border/40">
            {report.other.map((state) => (
              <div
                key={state.key}
                className="flex items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <p className="text-xs font-mono text-foreground truncate">
                    {state.key}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {state.files.length}{" "}
                    {state.files.length === 1 ? "file" : "files"} ·{" "}
                    {formatBytes(state.bytes)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="compact"
                  disabled={busy !== null}
                  onClick={() => void remove(state.key, state.key)}
                  className="gap-1.5 shrink-0"
                >
                  <Trash2 className="size-3.5" />
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────

function SectionHeading({
  icon,
  title,
  hint,
}: {
  icon: React.ReactNode
  title: string
  hint: string
}) {
  return (
    <div className="px-1 space-y-0.5">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {title}
      </h2>
      <p className="text-[11px] text-muted-foreground/80 leading-relaxed max-w-2xl">
        {hint}
      </p>
    </div>
  )
}

/**
 * Two numbers that are easy to conflate, so they are drawn as one bar with two
 * fills: what this app's models take, and what the whole origin takes. The
 * second is always the larger — it includes the app shell, the history vault,
 * and anything else the browser is holding for this site.
 */
function StorageBar({
  modelBytes,
  runtimeBytes,
  usage,
  quota,
}: {
  modelBytes: number
  runtimeBytes: number
  usage: number | null
  quota: number | null
}) {
  const pctOfQuota = quota ? Math.min(100, (modelBytes / quota) * 100) : null

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs">
        <span className="text-foreground font-medium">
          {formatBytes(modelBytes)}{" "}
          <span className="text-muted-foreground font-normal">in models</span>
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {usage !== null ? formatBytes(usage) : "—"} total
          {quota !== null && <> · {formatBytes(quota)} available</>}
        </span>
      </div>
      {pctOfQuota !== null && <Progress value={pctOfQuota} />}
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        The browser decides the quota and may evict caches on its own when space
        runs short, so a model shown here can disappear without you removing it.
        {runtimeBytes > 0 && (
          <>
            {" "}
            <span className="text-warn">
              {formatBytes(runtimeBytes)} of the above is duplicated copies of
              the inference runtime
            </span>{" "}
            — it gets stored inside each model's own cache, so every model you
            download brings another copy of the same {formatBytes(RUNTIME_COPY)}{" "}
            file.
          </>
        )}
      </p>
    </div>
  )
}

function ModelCard({
  model,
  rows,
  isActive,
  busy,
  onRemove,
}: {
  model: ModelDef
  rows: ModelCacheRow[]
  isActive: boolean
  busy: string | null
  onRemove: (key: string, label: string) => void | Promise<void>
}) {
  const onDisk = rows.reduce((sum, r) => sum + r.state.bytes, 0)

  return (
    <div className="rounded-2xl bg-surface-2 shadow-surface-1 overflow-hidden">
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {model.label}
              </h3>
              {isActive && (
                <Badge variant="success" dot={true} className="text-[10px]">
                  Active
                </Badge>
              )}
              <LicenseBadge
                id={model.license.id}
                url={model.license.url}
                commercial={model.license.allowsCommercialUse}
              />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              {model.tagline}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="text-xs font-mono text-foreground">
              {onDisk ? formatBytes(onDisk) : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">on disk</p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {model.attribution}
        </p>
      </div>

      <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Backend</TableHead>
              <TableHead>Weights</TableHead>
              <TableHead>Precision</TableHead>
              <TableHead className="text-right whitespace-nowrap">Download</TableHead>
              <TableHead className="text-right whitespace-nowrap">On disk</TableHead>
              <TableHead className="text-right whitespace-nowrap">Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const variant = variantFor(row.model, row.backend)
              return (
                <TableRow key={row.backend}>
                  <TableCell className="font-medium text-foreground whitespace-nowrap">
                    {BACKEND_LABEL[row.backend]}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {variant.file}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground uppercase">
                    {/* `precision` exists because the dtype we must pass is not
                        always the width of the file. Show the truth. */}
                    {variant.precision ?? variant.dtype}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {formatBytes(row.expectedBytes)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.state.modelBytes ? formatBytes(row.state.modelBytes) : "—"}
                    {row.state.runtimeBytes > 0 && (
                      <span
                        className="block text-[10px] text-muted-foreground font-normal"
                        title="Shared inference runtime stored in this model's cache. Removing this model removes this copy; the next model downloads it again."
                      >
                        +{formatBytes(row.state.runtimeBytes)} runtime
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <StatusBadge state={row.state} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="compact"
                      disabled={!row.state.files.length || busy !== null}
                      onClick={() =>
                        void onRemove(
                          row.state.key,
                          `${row.model.label} (${BACKEND_LABEL[row.backend]})`
                        )
                      }
                      className="gap-1.5"
                    >
                      <Trash2 className="size-3.5" />
                      {busy === row.state.key ? "Removing…" : "Remove"}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
      </Table>

      <div className="p-4 pt-3 space-y-2 border-t border-border/40">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <Detail label="Input" value={describeSize(model)} />
          <Detail label="Output" value={model.outputActivation === "sigmoid" ? "0–1 (baked sigmoid)" : "raw logits"} />
          <Detail label="Normalise" value={model.processor.do_normalize ? "yes" : "no"} />
          <Detail
            label="Upstream"
            value={
              <a
                href={`https://huggingface.co/${model.upstream}`}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-foreground hover:underline"
              >
                {model.upstream}
                <ExternalLink className="size-3" />
              </a>
            }
          />
        </dl>

        {model.caveats &&
          Object.entries(model.caveats).map(([backend, text]) => (
            <p
              key={backend}
              className="flex items-start gap-1.5 text-[11px] text-warn leading-relaxed"
            >
              <AlertTriangle className="size-3 shrink-0 mt-0.5" />
              <span>
                <span className="font-medium">
                  {BACKEND_LABEL[backend as Backend]}:
                </span>{" "}
                {text}
              </span>
            </p>
          ))}
      </div>
    </div>
  )
}

function Detail({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground truncate">{value}</dd>
    </div>
  )
}

function StatusBadge({ state }: { state: CacheState | null }) {
  if (!state || state.files.length === 0)
    return (
      <Badge variant="outline" className="text-[10px] whitespace-nowrap">
        not downloaded
      </Badge>
    )
  if (!state.present)
    return (
      // Files but no weights: an interrupted download. Saying "cached" here
      // would promise a model that still has to be fetched in full.
      <Badge variant="warning" className="text-[10px]">
        partial
      </Badge>
    )
  return (
    <Badge variant="success" className="text-[10px]">
      cached
    </Badge>
  )
}

function LicenseBadge({
  id,
  url,
  commercial,
}: {
  id: string
  url: string
  commercial: boolean
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex"
      title={
        commercial
          ? `${id} — commercial use permitted`
          : `${id} — non-commercial use only`
      }
    >
      <Badge
        variant={commercial ? "secondary" : "warning"}
        className="text-[10px] whitespace-nowrap hover:underline"
      >
        {id}
        {!commercial && " · non-commercial"}
      </Badge>
    </a>
  )
}

function describeSize(model: ModelDef): string {
  const size = model.processor.size
  if ("shortest_edge" in size) {
    // Not the same thing as a fixed square, and the difference is visible: a
    // portrait resized into a square is distorted before inference.
    return `shortest edge ${size.shortest_edge}px, aspect kept`
  }
  return `${size.width}×${size.height} fixed`
}

function groupByModel(rows: ModelCacheRow[]): [ModelDef, ModelCacheRow[]][] {
  const out: [ModelDef, ModelCacheRow[]][] = []
  for (const row of rows) {
    const existing = out.find(([m]) => m.id === row.model.id)
    if (existing) existing[1].push(row)
    else out.push([row.model, [row]])
  }
  return out
}
