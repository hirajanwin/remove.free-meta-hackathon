import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Gauge, Play, AlertTriangle } from "lucide-react"

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
  runBench,
  BENCH_SAMPLES,
  type BenchResult,
  type BenchProgress,
} from "@/lib/bench"
import { formatBytes } from "@/lib/models"
import { setActiveModel, getActiveModelId } from "@/lib/bg-removal"
import { useBackend } from "@/hooks/use-backend"

export const Route = createFileRoute("/bench")({
  component: BenchPage,
})

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const secs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`)

function BenchPage() {
  const [results, setResults] = React.useState<BenchResult[] | null>(null)
  const [progress, setProgress] = React.useState<BenchProgress | null>(null)
  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [active, setActive] = React.useState(getActiveModelId())

  const backend = useBackend()

  const start = async () => {
    setRunning(true)
    setError(null)
    setResults(null)
    try {
      const out = await runBench(BENCH_SAMPLES, undefined, setProgress)
      setResults(out)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const choose = (modelId: string) => {
    setActiveModel(modelId)
    setActive(modelId)
  }

  // Ranked by warm inference, which is what a user feels on their second image
  // onward. Cold time is dominated by download size and is shown separately.
  const ranked = React.useMemo(
    () =>
      results
        ? [...results].sort((a, b) => {
            if (!!a.error !== !!b.error) return a.error ? 1 : -1
            return a.warmMedianMs - b.warmMedianMs
          })
        : null,
    [results]
  )

  const fastest = ranked?.find((r) => !r.error)

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4.5 rounded-2xl bg-surface-2 shadow-surface-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Gauge className="size-5 text-foreground" />
              Model Bench
            </h1>
            <Badge variant="secondary" dot={true} className="text-[10px]">
              {backend === "webgpu" ? "WebGPU" : "WASM CPU"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
            Every model, over the same four photos, on this machine. The model
            picker's descriptions are claims about someone else's GPU — this is
            what actually happens on yours.
          </p>
        </div>

        <Button onClick={start} disabled={running} size="compact" className="gap-1.5 shrink-0">
          <Play className="size-3.5" />
          {running ? "Running…" : results ? "Run again" : "Run the bench"}
        </Button>
      </div>

      {running && progress && (
        <div className="space-y-2 p-4 rounded-2xl bg-surface-2 shadow-surface-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-foreground font-medium">
              {progress.modelLabel} · {progress.sampleLabel}
            </span>
            <span className="font-mono text-muted-foreground">
              {progress.done} / {progress.total}
            </span>
          </div>
          <Progress value={(progress.done / progress.total) * 100} />
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Each model is downloaded once, then run over all four photos. The
            first run of a model includes fetching it, so expect a long pause at
            the start of each block.
          </p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-4 rounded-2xl bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {ranked && (
        <>
          {/* No overflow-x-auto: Table has its own horizontal ScrollArea, and
              a second one here nested them. */}
          <div className="rounded-2xl bg-surface-2 shadow-surface-1 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Warm</TableHead>
                  <TableHead>Cold</TableHead>
                  <TableHead>Download</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Soft edge</TableHead>
                  <TableHead>Disagreement</TableHead>
                  <TableHead>Licence</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map((r) => {
                  const meanOf = (pick: (x: (typeof r.runs)[number]) => number) =>
                    r.runs.length ? r.runs.reduce((s, x) => s + pick(x), 0) / r.runs.length : 0
                  return (
                    <TableRow key={r.modelId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{r.label}</span>
                          {r === fastest && (
                            <Badge variant="secondary" className="text-[10px]">
                              fastest
                            </Badge>
                          )}
                          {active === r.modelId && (
                            <Badge variant="secondary" className="text-[10px]">
                              active
                            </Badge>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {r.dtype}
                        </span>
                      </TableCell>
                      {r.error ? (
                        <TableCell colSpan={7}>
                          <span className="text-destructive text-xs">
                            Failed on this device — {r.error}
                          </span>
                        </TableCell>
                      ) : (
                        <>
                          <TableCell className="font-mono">{secs(r.warmMedianMs)}</TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {secs(r.coldMs)}
                          </TableCell>
                          <TableCell className="font-mono text-muted-foreground">
                            {formatBytes(r.downloadBytes)}
                          </TableCell>
                          <TableCell className="font-mono">{pct(meanOf((x) => x.coverage))}</TableCell>
                          <TableCell className="font-mono">{pct(meanOf((x) => x.soft))}</TableCell>
                          <TableCell className="font-mono">
                            {r.disagreement ? pct(r.disagreement) : "—"}
                          </TableCell>
                          <TableCell className="text-[11px] text-muted-foreground">
                            {r.licenseId}
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <Button
                          variant="outline"
                          size="compact"
                          disabled={!!r.error || active === r.modelId}
                          onClick={() => choose(r.modelId)}
                        >
                          {active === r.modelId ? "In use" : "Use this"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <div className="p-4.5 rounded-2xl bg-surface-2/60 shadow-surface-1 space-y-2.5">
            <h2 className="text-sm font-semibold text-foreground">Reading the numbers</h2>
            <dl className="space-y-2 text-[11px] text-muted-foreground leading-relaxed">
              <div>
                <dt className="text-foreground font-medium inline">Warm and cold. </dt>
                <dd className="inline">
                  Cold is the first photo and includes downloading the weights;
                  warm is the median of the rest. Warm is what a second image
                  costs, so the table is ranked by it.
                </dd>
              </div>
              <div>
                <dt className="text-foreground font-medium inline">Subject. </dt>
                <dd className="inline">
                  Share of the frame kept at more than half opacity. Two models
                  far apart here disagree about what the subject even is — worth
                  looking at the cutouts rather than trusting either.
                </dd>
              </div>
              <div>
                <dt className="text-foreground font-medium inline">Soft edge. </dt>
                <dd className="inline">
                  Share of pixels left partly transparent. The nearest honest
                  proxy for hair and fur: a model that resolves strands leaves a
                  wide soft band, one that hard-thresholds leaves almost none.
                  Higher is usually better, but a model that is simply unsure
                  everywhere also scores high.
                </dd>
              </div>
              <div>
                <dt className="text-foreground font-medium inline">Disagreement. </dt>
                <dd className="inline">
                  Mean distance from the per-pixel median of all the models.
                  <strong className="text-foreground"> This is not an error rate.</strong>{" "}
                  The consensus is not truth, and if two models are wrong the
                  same way the third scores worst. Read it as "this one is the
                  odd one out", which is a reason to look, not a verdict.
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
              There is no accuracy column because there is no ground truth here.
              These are stock photos, not a matting dataset with reference
              alphas, and inventing a score would be worse than leaving the
              column out.
            </p>
          </div>
        </>
      )}

      {!ranked && !running && (
        <div className="rounded-2xl p-12 text-center flex flex-col items-center justify-center space-y-3 bg-surface-2/60 shadow-surface-1">
          <div className="size-12 rounded-xl bg-surface-3 flex items-center justify-center text-foreground shadow-surface-1">
            <Gauge className="size-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">Nothing measured yet</h2>
          <p className="text-xs text-muted-foreground max-w-md leading-relaxed">
            Running the bench downloads every model — a few hundred megabytes on
            a first visit, then cached. It runs entirely on this device; no photo
            or timing leaves the browser.
          </p>
        </div>
      )}
    </div>
  )
}
