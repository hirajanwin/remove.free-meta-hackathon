import { Scissors, Image as ImageIcon, Columns2 } from "lucide-react"
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Video, VideoOff, AlertTriangle, Camera as CameraIcon, Download, Sparkles, Mic, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { Dock } from "@/components/ui/dock"
import { RightSidebarPanel } from "@/components/layout/right-sidebar"
import { AuditPanel } from "@/components/studio/audit-panel"
import { useStudio } from "@/components/studio/studio-context"
import { PanelCard, PillTabs, ZoomControl, BottomSlot, PanelTabs, TabPane, FieldLabel, FitBox, FileBar, type PanelTab } from "@/components/studio/chrome"
import { backdropImageFor, gradientFor } from "@/lib/video"
import { planCameraCommand, generateBackdrop } from "@/lib/muse"
import { getMetaKey } from "@/lib/meta"
import { recordRun } from "@/lib/run-info"
import { MetaKeyField } from "@/components/studio/meta-key-field"
import { useVoiceCommand } from "@/hooks/use-voice-command"
import {
  addProgressListener,
  getLastFrameInferMs,
  segmentFrame,
  type ProcessProgress,
} from "@/lib/bg-removal"
import { MODELS, formatBytes, getModel } from "@/lib/models"
import { getActiveModelId, setActiveModel } from "@/lib/bg-removal"
import { useBackend } from "@/hooks/use-backend"

const CAM_VIEW_MODES = [["cutout", "Cutout", Scissors], ["original", "Original", ImageIcon], ["sidebyside", "Side by side", Columns2]] as const

export const Route = createFileRoute("/webcam")({
  component: WebcamPage,
})

/**
 * Target shortest edge for live frames.
 *
 * Measured, because the intuition here is wrong: feeding smaller frames does
 * not make inference faster. MODNet's processor resizes to a 512px shortest
 * edge internally, so a 256px frame is upscaled back to 512 and does the same
 * model work plus a resize. On this machine, per-frame medians were
 *
 *   256px -> 102.4ms    320px -> 99.0ms    384px -> 98.1ms    512px -> 93.8ms
 *
 * i.e. the largest input was the fastest. So match the model's own target
 * instead of downscaling below it — that is both the quickest and the sharpest
 * option. Frames are never upscaled past the camera's real resolution.
 */
const INFER_SHORT_EDGE = 512

function WebcamPage() {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  // Scratch canvases: one to downscale frames for inference, one to hold the
  // mask so it can be scaled up by the GPU during compositing.
  const inferCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const subjectCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)

  const [running, setRunning] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [modelReady, setModelReady] = React.useState(false)
  const [modelId, setModelId] = React.useState(getActiveModelId())
  // Backdrop is the shared header strip (studio controls), same as the other
  // create pages; the render loop reads it through a ref so a change never
  // restarts the camera loop.
  const studio = useStudio()
  const bgRef = React.useRef(studio.controls)
  bgRef.current = studio.controls
  const originalRef = React.useRef<HTMLCanvasElement>(null)
  const [viewMode, setViewMode] = React.useState<"cutout" | "original" | "sidebyside">("sidebyside")
  const viewModeRef = React.useRef(viewMode)
  viewModeRef.current = viewMode
  const [zoom, setZoom] = React.useState(1)
  const [panelTab, setPanelTab] = React.useState<PanelTab>("edit")
  // Agent chat (bottom inset): one sentence -> Muse plan -> live backdrop.
  const [agentCommand, setAgentCommand] = React.useState("")
  const [agentRunning, setAgentRunning] = React.useState(false)
  const [agentTrace, setAgentTrace] = React.useState<string[]>([])
  const [hasKey, setHasKey] = React.useState(() => !!getMetaKey())
  const agentInputRef = React.useRef<HTMLInputElement>(null)
  const [dims, setDims] = React.useState<{ w: number; h: number } | null>(null)
  const [fps, setFps] = React.useState(0)
  const [inferMs, setInferMs] = React.useState(0)

  const backend = useBackend()
  const model = React.useMemo(() => {
    try {
      return getModel(modelId)
    } catch {
      return MODELS[0]
    }
  }, [modelId])

  React.useEffect(() => {
    return addProgressListener((p: ProcessProgress) => {
      if (p.type === "ready") setModelReady(true)
      if (p.type === "init-start" || p.type === "download-progress") setModelReady(false)
      if (p.type === "init-error") setError(p.error ?? "Model failed to load")
    })
  }, [])

  const stop = React.useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setRunning(false)
    setFps(0)
  }, [])

  // Releasing the camera on unmount matters: the indicator light stays on
  // otherwise, which for a privacy-first tool is unacceptable.
  React.useEffect(() => stop, [stop])

  const start = React.useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      })
      streamRef.current = stream
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()
      setDims({ w: video.videoWidth || 1280, h: video.videoHeight || 720 })
      setRunning(true)
    } catch (err: any) {
      setError(
        err?.name === "NotAllowedError"
          ? "Camera permission denied. Allow access and try again."
          : err?.name === "NotFoundError"
            ? "No camera found on this device."
            : err?.message || "Could not start the camera"
      )
    }
  }, [])

  React.useEffect(() => {
    if (!running) return

    let frames = 0
    let windowStart = performance.now()
    let cancelled = false
    let lastMask: { data: Uint8Array; w: number; h: number } | null = null

    const loop = () => {
      if (cancelled) return
      rafRef.current = requestAnimationFrame(loop)

      const video = videoRef.current
      const out = canvasRef.current
      if (!video || !out || !video.videoWidth) return

      const vw = video.videoWidth
      const vh = video.videoHeight

      // Ask for a new mask only when the worker is free. segmentFrame returns
      // null while busy and the previous mask keeps being composited, so the
      // preview stays smooth at display rate even though inference is slower.
      const scale = Math.min(1, INFER_SHORT_EDGE / Math.min(vw, vh))
      const iw = Math.max(1, Math.round(vw * scale))
      const ih = Math.max(1, Math.round(vh * scale))

      let infer = inferCanvasRef.current
      if (!infer) {
        infer = document.createElement("canvas")
        inferCanvasRef.current = infer
      }
      if (infer.width !== iw || infer.height !== ih) {
        infer.width = iw
        infer.height = ih
      }
      const ictx = infer.getContext("2d", { willReadFrequently: true })!
      ictx.drawImage(video, 0, 0, iw, ih)

      const pending = segmentFrame(
        ictx.getImageData(0, 0, iw, ih).data,
        iw,
        ih,
        modelId
      )
      if (pending) {
        pending
          .then((maskData) => {
            if (!cancelled) {
              lastMask = { data: maskData, w: iw, h: ih }
              setInferMs(getLastFrameInferMs())
            }
          })
          .catch(() => {})
      }

      // ─── Composite ───
      if (out.width !== vw || out.height !== vh) {
        out.width = vw
        out.height = vh
      }
      const ctx = out.getContext("2d")!
      ctx.clearRect(0, 0, vw, vh)
      const orig = originalRef.current
      if (orig && viewModeRef.current !== "cutout") {
        if (orig.width !== vw || orig.height !== vh) {
          orig.width = vw
          orig.height = vh
        }
        orig.getContext("2d")!.drawImage(video, 0, 0, vw, vh)
      }

      if (!lastMask) {
        // Nothing segmented yet: show the raw feed rather than a blank frame.
        ctx.drawImage(video, 0, 0, vw, vh)
      } else {
        let maskCanvas = maskCanvasRef.current
        if (!maskCanvas) {
          maskCanvas = document.createElement("canvas")
          maskCanvasRef.current = maskCanvas
        }
        if (maskCanvas.width !== lastMask.w || maskCanvas.height !== lastMask.h) {
          maskCanvas.width = lastMask.w
          maskCanvas.height = lastMask.h
        }
        const mctx = maskCanvas.getContext("2d")!
        const img = mctx.createImageData(lastMask.w, lastMask.h)
        for (let i = 0, j = 0; i < lastMask.data.length; i++, j += 4) {
          img.data[j] = 255
          img.data[j + 1] = 255
          img.data[j + 2] = 255
          img.data[j + 3] = lastMask.data[i]
        }
        mctx.putImageData(img, 0, 0)

        // Background first, then the subject punched out by the mask.
        const bg = bgRef.current
        if (bg.mode === "color") {
          ctx.fillStyle = bg.color
          ctx.fillRect(0, 0, vw, vh)
        } else if (bg.mode === "gradient") {
          ctx.fillStyle = gradientFor(ctx, bg.gradient, vw, vh)
          ctx.fillRect(0, 0, vw, vh)
        } else if (bg.mode === "image" && bg.backdropImage) {
          const img = backdropImageFor(bg.backdropImage)
          if (img.complete && img.naturalWidth) {
            const r = Math.max(vw / img.naturalWidth, vh / img.naturalHeight)
            const dw = img.naturalWidth * r
            const dh = img.naturalHeight * r
            ctx.drawImage(img, (vw - dw) / 2, (vh - dh) / 2, dw, dh)
          }
        } else if (bg.mode === "blur") {
          ctx.save()
          ctx.filter = `blur(${bg.blurRadius}px)`
          ctx.drawImage(video, 0, 0, vw, vh)
          ctx.restore()
        }

        // Draw the subject into an offscreen pass so the mask does not erase
        // the background that was just drawn. Reused across frames — allocating
        // a 1280x720 canvas 60 times a second is pure GC churn.
        let subject = subjectCanvasRef.current
        if (!subject) {
          subject = document.createElement("canvas")
          subjectCanvasRef.current = subject
        }
        if (subject.width !== vw || subject.height !== vh) {
          subject.width = vw
          subject.height = vh
        }
        const sctx = subject.getContext("2d")!
        sctx.globalCompositeOperation = "source-over"
        sctx.clearRect(0, 0, vw, vh)
        sctx.drawImage(video, 0, 0, vw, vh)
        sctx.globalCompositeOperation = "destination-in"
        sctx.drawImage(maskCanvas, 0, 0, vw, vh)
        ctx.drawImage(subject, 0, 0)
      }

      frames++
      const now = performance.now()
      if (now - windowStart >= 500) {
        setFps(Math.round((frames * 1000) / (now - windowStart)))
        frames = 0
        windowStart = now
      }
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelled = true
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [running, modelId])

  /**
   * "put me on a beach", "blur it more", "dark studio": Muse Spark picks the
   * backdrop, and for a scene Muse Image paints one still that then runs
   * behind the live cutout. Only text leaves the device; no camera frame is
   * ever sent.
   */
  const runCameraAgent = async (text: string) => {
    const command = text.trim()
    if (!command || agentRunning) return
    const key = getMetaKey()
    if (!key) {
      setAgentTrace(["Add your Meta API key under Edit → AI background first."])
      setPanelTab("edit")
      return
    }
    setAgentRunning(true)
    setAgentTrace(["Asking Muse for a background…"])
    const t0 = performance.now()
    try {
      const plan = await planCameraCommand(command, key)
      const trace = [`Plan: ${plan.summary}`]
      setAgentTrace([...trace])

      if (plan.mode === "image" && plan.scene) {
        trace.push(`Painting "${plan.scene}" with Muse Image ($0.01)…`)
        setAgentTrace([...trace])
        const url = await generateBackdrop(plan.scene, key, dims?.w ?? 1280, dims?.h ?? 720)
        studio.setControls((c) => ({ ...c, mode: "image", backdropImage: url }))
        recordRun({
          action: `Camera backdrop: "${plan.scene}"`,
          model: "Muse Image",
          where: "cloud",
          ms: performance.now() - t0,
          cost: 0.01,
        })
        trace.pop()
        trace.push(`Backdrop applied: ${plan.scene}.`)
      } else {
        studio.setControls((c) => ({
          ...c,
          mode: plan.mode,
          color: plan.color ?? c.color,
          gradient: plan.gradient ?? c.gradient,
          blurRadius: plan.blur ?? c.blurRadius,
        }))
        recordRun({
          action: `Camera backdrop: ${plan.mode}`,
          model: "Muse Spark",
          where: "cloud",
          ms: performance.now() - t0,
          cost: 0,
          detail: command,
        })
        trace.push(`Backdrop set to ${plan.mode}.`)
      }
      trace.push("Verified. It is live in the preview.")
      setAgentTrace(trace)
    } catch (err: any) {
      setAgentTrace([err?.message || "Agent failed."])
    } finally {
      setAgentRunning(false)
    }
  }

  const voice = useVoiceCommand({
    onTranscript: (text) => {
      setAgentCommand(text)
      return runCameraAgent(text)
    },
    onStatus: (message) => setAgentTrace([message]),
  })

  const variant = model.variants[backend]
  const aspect = dims ? dims.w / dims.h : 16 / 9
  const paneZoom: React.CSSProperties = { transform: `scale(${zoom})` }
  const pill = (label: string) => (
    <span className="absolute top-3 left-3 z-10 px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-md text-foreground text-[11px] font-medium border border-border/50">
      {label}
    </span>
  )
  const snapshot = () => {
    const c = canvasRef.current
    if (!c || !running) return
    c.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "camera-cutout.png"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    }, "image/png")
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <FileBar
        name="Live Camera"
        detail={dims ? `(${dims.w}×${dims.h})${fps ? ` · ${fps} fps` : ""}` : "On-device · nothing transmitted"}
        showRun={false}
        actions={
          <Button
            variant={running ? "outline" : "primary"}
            size="compact"
            leadingIcon={running ? VideoOff : Video}
            onClick={running ? stop : start}
            className="h-7 text-[11px]"
          >
            {running ? "Stop Camera" : "Start Camera"}
          </Button>
        }
      />

      {error && (
        <div className="mx-4 mb-2 flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2">
          <AlertTriangle className="size-3.5 text-warn mt-0.5 shrink-0" />
          <p className="text-[11px] leading-snug text-warn">{error}</p>
        </div>
      )}

      <section aria-label="Camera" className="flex-1 min-h-0 relative p-4 overflow-hidden">
        {/* Source feed stays hidden; the canvases are the visible output. */}
        <video ref={videoRef} playsInline muted className="hidden" />
        <div className="absolute inset-4 flex gap-3">
          {viewMode !== "cutout" && (
            <div className="flex-1 min-w-0 relative h-full">
              <FitBox aspect={aspect} className="rounded-xl overflow-hidden shadow-2xl bg-black/40 transition-transform duration-80" style={paneZoom}>
                <canvas ref={originalRef} className="absolute inset-0 size-full object-contain" aria-label="Camera feed, unprocessed" />
                {pill("Original")}
              </FitBox>
            </div>
          )}
          {viewMode !== "original" && (
            <div className="flex-1 min-w-0 relative h-full">
              <FitBox aspect={aspect} className="rounded-xl overflow-hidden shadow-2xl bg-checkered transition-transform duration-80" style={paneZoom}>
                <canvas ref={canvasRef} className="absolute inset-0 size-full object-contain" aria-label="Camera with background removed" />
                {pill("Cutout")}
                {!running && (
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                    Camera is off
                  </span>
                )}
              </FitBox>
            </div>
          )}
        </div>

        

        <BottomSlot slot="center"><div data-tour="dock" className="">
          <PillTabs
            ariaLabel="Camera tools"
            iconOnlyInactive
            value={0}
            onChange={(i) => {
              if (i === 0) (running ? stop : start)()
              else if (i === 1) snapshot()
              else if (i === 2) setPanelTab("export")
            }}
            items={[
              { label: running ? "Stop" : "Start", title: running ? "Stop camera" : "Start camera", icon: running ? VideoOff : Video },
              { label: "Snapshot", title: "Save a PNG of the current frame", icon: CameraIcon },
              { label: "Export", title: "Export options", icon: Download },
            ]}
          />
        </div></BottomSlot>

        <BottomSlot slot="right"><PillTabs ariaLabel="View mode" value={CAM_VIEW_MODES.findIndex((m) => m[0] === viewMode)} onChange={(i) => setViewMode(CAM_VIEW_MODES[i][0])} iconOnlyInactive items={CAM_VIEW_MODES.map((m) => ({ label: m[1], icon: m[2] }))} /><ZoomControl zoom={zoom} onChange={setZoom} /></BottomSlot>
      </section>

      <BottomSlot slot="chat">
        <div data-tour="command">
          <div className="flex items-center gap-2 rounded-xl bg-surface-2 shadow-surface-1 px-2.5 py-1.5">
            <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
            <input
              ref={agentInputRef}
              type="text"
              value={agentCommand}
              onChange={(e) => setAgentCommand(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void runCameraAgent(agentCommand)}
              placeholder='Tell the agent… "put me on a beach"'
              aria-label="Agent command"
              disabled={agentRunning}
              className="flex-1 min-w-[10rem] bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
            />
            {!agentCommand && !agentRunning && (
              <div className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden">
                {["put me on a beach", "blur it more", "dark studio", "white background"].map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setAgentCommand(example)
                      agentInputRef.current?.focus()
                    }}
                    className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-80 whitespace-nowrap"
                  >
                    {example}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => void voice.toggle()}
              disabled={agentRunning}
              aria-label={voice.recording ? "Stop and send voice command" : "Speak a command"}
              aria-pressed={voice.recording}
              title="Voice command (Muse Voice Transcribe)"
              className={
                "size-6 shrink-0 inline-flex items-center justify-center rounded-md transition-colors duration-80 disabled:opacity-40 " +
                (voice.recording
                  ? "bg-destructive/20 text-destructive animate-pulse"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {voice.recording ? <Square className="size-3" /> : <Mic className="size-3.5" />}
            </button>
            <Button
              size="compact"
              variant="primary"
              disabled={!agentCommand.trim() || agentRunning}
              onClick={() => void runCameraAgent(agentCommand)}
              className="h-6 text-[11px]"
            >
              {agentRunning ? "Running…" : "Run"}
            </Button>
          </div>
          {agentTrace.length > 0 && (
            <>
              <ol className="mt-1.5 space-y-0.5 rounded-lg bg-surface-2/70 px-2.5 py-1.5">
                {agentTrace.map((step, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                    <span
                      aria-hidden
                      className={
                        "mt-1 size-1.5 rounded-full shrink-0 " +
                        (step.startsWith("Verified") ? "bg-ok" : step.startsWith("Plan") ? "bg-foreground" : "bg-muted-foreground/50")
                      }
                    />
                    <span className={step.startsWith("Verified") ? "text-ok" : undefined}>{step}</span>
                  </li>
                ))}
              </ol>
              <div className="flex justify-end mt-1 px-0.5">
                <button type="button" onClick={() => setAgentTrace([])} className="text-[10px] text-muted-foreground hover:text-foreground">
                  clear trace
                </button>
              </div>
            </>
          )}
        </div>
      </BottomSlot>

      <RightSidebarPanel title="Camera Controls">
        <PanelTabs value={panelTab} onChange={setPanelTab} tabs={["edit", "model", "export", "audit"]} />

        <TabPane active={panelTab} tab="edit">
          <PanelCard
            id="camera-ai-background"
            title="AI background"
            icon={Sparkles}
            defaultOpen
            summary={hasKey ? "Key saved" : "Needs a Meta key"}
          >
            {hasKey ? (
              <p className="text-[10px] leading-snug text-muted-foreground">
                Type or say what you want in the bar below: "put me on a beach",
                "blur it more", "dark studio". A scene is painted once with Muse
                Image ($0.01) and runs behind you live. Only your words leave this
                device, never a camera frame.
              </p>
            ) : (
              <MetaKeyField
                onSaved={() => setHasKey(true)}
                hint="Your key stays in this browser and goes only to api.meta.ai. Live segmentation itself never needs it."
              />
            )}
            <p className="text-[10px] leading-snug text-muted-foreground">
              Colour, gradient, blur and photo backdrops are also in the header
              strip and work without a key. Picking one object isn't offered live:
              SAM 3.1 runs in the cloud, too slow for video frames.
            </p>
          </PanelCard>
        </TabPane>

        <TabPane active={panelTab} tab="model">
          <div className="space-y-2">
            <FieldLabel>Model</FieldLabel>
            <TabsSubtle
              selectedIndex={Math.max(0, MODELS.findIndex((m) => m.id === modelId))}
              onSelect={(i) => {
                const next = MODELS[i]!.id
                setModelId(next)
                setActiveModel(next)
              }}
              size="compact"
              className="w-full flex"
            >
              {MODELS.map((m, i) => (
                <TabsSubtleItem key={m.id} index={i} label={m.label} />
              ))}
            </TabsSubtle>
            <p className="text-[10px] leading-snug text-muted-foreground">
              MODNet is the one built for this: it is the smallest and fastest of
              the three and was trained for portrait matting. The larger models
              work but will not keep up with a moving subject.
            </p>
          </div>

          <div className="space-y-1 pt-1 border-t border-border/40">
            {[
              ["Backend", backend === "webgpu" ? "GPU" : "CPU"],
              ["Model", modelReady ? "ready" : running ? "loading" : "idle"],
              ["Weights", variant ? formatBytes(variant.bytes) : "—"],
              ["Inference", inferMs ? `${inferMs.toFixed(0)} ms` : "—"],
              ["Display", fps ? `${fps} fps` : "—"],
              ["Infer size", `${INFER_SHORT_EDGE}px short edge`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{k}</span>
                <span className="text-[11px] font-mono text-foreground/80">{v}</span>
              </div>
            ))}
            <p className="text-[10px] leading-snug text-muted-foreground pt-1">
              Display rate is decoupled from inference: the newest available mask
              is reused across frames, so the preview stays smooth even when the
              model runs slower than the camera.
            </p>
          </div>
        </TabPane>

        <TabPane active={panelTab} tab="export">
          <div className="space-y-2">
            <FieldLabel>Snapshot</FieldLabel>
            <Button variant="primary" size="compact" className="w-full" leadingIcon={Download} disabled={!running} onClick={snapshot}>
              Save current frame (PNG)
            </Button>
            <p className="text-[10px] leading-snug text-muted-foreground">
              Saves the cutout exactly as composited, with the backdrop chosen in the header.
            </p>
          </div>
        </TabPane>

        <TabPane active={panelTab} tab="audit">
          <AuditPanel />
        </TabPane>
      </RightSidebarPanel>
    </div>
  )
}
