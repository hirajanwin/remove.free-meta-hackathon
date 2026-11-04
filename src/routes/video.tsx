import { SquareSplitHorizontal, Image as ImageIcon, Columns2, Layers } from "lucide-react"
import * as React from "react"
import { createFileRoute } from "@tanstack/react-router"
import { Film, Download, X, AlertTriangle, FileArchive, Sparkles, Mic, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { Slider } from "@/components/ui/slider"
import {
  encodeFrames,
  framesToPngZip,
  previewFrame,
  processVideo,
  readVideoMeta,
  type VideoBackdrop,
  type VideoMeta,
} from "@/lib/video"
import { getActiveModelId, setActiveModel } from "@/lib/bg-removal"
import { MODELS } from "@/lib/models"
import { RVM_MODEL_ID } from "@/lib/video"
import { getMetaKey, downscaleCanvas } from "@/lib/meta"
import { planCommand } from "@/lib/muse"
import { estimateDepth } from "@/lib/depth"
import { focalDepth } from "@/lib/bokeh"
import { removeBackground } from "@/lib/bg-removal"
import { sliceAroundSubject, isNoopSlice } from "@/lib/depth-slice"
import { depthToCanvas } from "@/lib/depth-image"
import { MetaKeyField } from "@/components/studio/meta-key-field"
import { useVoiceCommand } from "@/hooks/use-voice-command"
import { buildSubjectFilter, FILTER_PRESETS } from "@/lib/filters"
import { useStudio } from "@/components/studio/studio-context"
import { PanelCard, PillTabs, ZoomControl, BottomSlot, PanelTabs, TabPane, FieldLabel, FitBox, FileBar, type PanelTab } from "@/components/studio/chrome"
import { Dock } from "@/components/ui/dock"
import { AuditPanel } from "@/components/studio/audit-panel"
import { recordRun } from "@/lib/run-info"
import {
  MousePointerClick,
  Play,
  Scissors,
  WandSparkles,
} from "lucide-react"
import {
  nearestTrackedFrame,
  trackConceptInVideo,
  trackPointInVideo,
  visibleUnion,
  type TrackResult,
} from "@/lib/sam-video"
import { ModelLoadBar } from "@/components/studio/model-load-bar"
import { RightSidebarPanel } from "@/components/layout/right-sidebar"

/** Still models plus RVM, which is video-specific and not in the registry. */
const VIDEO_MODELS = [
  ...MODELS.map((m) => ({ id: m.id, label: m.label })),
  { id: RVM_MODEL_ID, label: "RVM" },
]

const VIEW_MODES = [["split", "Split", SquareSplitHorizontal], ["cutout", "Cutout", Scissors], ["original", "Original", ImageIcon], ["sidebyside", "Side by side", Columns2], ["depth", "Depth", Layers]] as const

export const Route = createFileRoute("/video")({
  component: VideoPage,
})

type Stage = "idle" | "segmenting" | "encoding" | "zipping" | "done"

function VideoPage() {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const backdropFileRef = React.useRef<HTMLInputElement>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const framesRef = React.useRef<Blob[]>([])
  const metaRef = React.useRef<VideoMeta | null>(null)

  const [file, setFile] = React.useState<File | null>(null)
  const [meta, setMeta] = React.useState<VideoMeta | null>(null)
  const [stage, setStage] = React.useState<Stage>("idle")
  const [done, setDone] = React.useState(0)
  const [total, setTotal] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<{ url: string; bytes: number } | null>(null)
  const [zip, setZip] = React.useState<{ url: string; bytes: number } | null>(null)

  // Backdrop lives in the shared header strip (studio controls), the same
  // state the image studio edits — one choice across all create pages.
  const studio = useStudio()
  const mode = studio.controls.mode
  const bgColor = studio.controls.color
  const gradient = studio.controls.gradient
  const blurAmount = studio.controls.blurRadius
  const backdropImage = studio.controls.backdropImage
  const setMode = (m: typeof mode) => studio.setControls((c) => ({ ...c, mode: m }))
  const setBgColor = (v: string) => studio.setControls((c) => ({ ...c, color: v }))
  const setGradient = (v: typeof gradient) => studio.setControls((c) => ({ ...c, gradient: v }))
  const setBlurAmount = (v: number) => studio.setControls((c) => ({ ...c, blurRadius: v }))
  const setBackdropImage = (v: string | null) => studio.setControls((c) => ({ ...c, backdropImage: v }))
  const [viewMode, setViewMode] = React.useState<"split" | "cutout" | "original" | "sidebyside" | "depth">("sidebyside")
  const [zoom, setZoom] = React.useState(1)
  // Depth view: the depth map of the frame under the scrubber, read on device.
  const [depthUrl, setDepthUrl] = React.useState<string | null>(null)
  const [splitPos, setSplitPos] = React.useState(50)
  const [panelTab, setPanelTab] = React.useState<PanelTab>("edit")
  const [caption, setCaption] = React.useState("")
  const [badge, setBadge] = React.useState("")
  const [filterPreset, setFilterPreset] = React.useState("none")
  const [cropAspect, setCropAspect] = React.useState<
    "none" | "1:1" | "4:5" | "16:9" | "9:16"
  >("none")
  const [fps, setFps] = React.useState(12)
  const [smoothing, setSmoothing] = React.useState(0)
  const [modelId, setModelId] = React.useState(getActiveModelId())

  // Source object URL, so the picked file can be scrubbed before committing.
  const [sourceUrl, setSourceUrl] = React.useState<string | null>(null)
  const sourceRef = React.useRef<HTMLVideoElement>(null)

  // One transport driving both sides of the player.
  const segVideoRef = React.useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [playTime, setPlayTime] = React.useState(0)
  const [trackClickArmed, setTrackClickArmed] = React.useState(false)

  // ─── Settings undo/redo ───
  // Snapshots of the whole control state, taken when settings settle.
  // Applying a snapshot must not record itself as a new edit.
  type VideoSettings = {
    mode: typeof mode
    bgColor: string
    gradient: typeof gradient
    backdropImage: string | null
    caption: string
    badge: string
    filterPreset: string
    cropAspect: typeof cropAspect
    blurAmount: number
    fps: number
    smoothing: number
    modelId: string
  }
  const settingsNow = (): VideoSettings => ({
    mode,
    bgColor,
    gradient,
    backdropImage,
    caption,
    badge,
    filterPreset,
    cropAspect,
    blurAmount,
    fps,
    smoothing,
    modelId,
  })
  const undoStackRef = React.useRef<VideoSettings[]>([])
  const redoStackRef = React.useRef<VideoSettings[]>([])
  const applyingRef = React.useRef(false)
  const lastSettingsRef = React.useRef<string>("")
  const [settingsVersion, setSettingsVersion] = React.useState(0)

  React.useEffect(() => {
    const snap = settingsNow()
    const key = JSON.stringify(snap)
    if (!lastSettingsRef.current) {
      lastSettingsRef.current = key
      return
    }
    if (applyingRef.current) {
      applyingRef.current = false
      lastSettingsRef.current = key
      return
    }
    if (key === lastSettingsRef.current) return
    const timer = setTimeout(() => {
      try {
        undoStackRef.current.push(JSON.parse(lastSettingsRef.current))
        if (undoStackRef.current.length > 40) undoStackRef.current.shift()
        redoStackRef.current = []
      } catch {
        // unparseable snapshot: skip
      }
      lastSettingsRef.current = key
      setSettingsVersion((v) => v + 1)
    }, 450)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, bgColor, gradient, backdropImage, caption, badge, filterPreset, cropAspect, blurAmount, fps, smoothing, modelId])

  const applySettings = (snap: VideoSettings) => {
    applyingRef.current = true
    setMode(snap.mode)
    setBgColor(snap.bgColor)
    setGradient(snap.gradient)
    setBackdropImage(snap.backdropImage)
    setCaption(snap.caption)
    setBadge(snap.badge)
    setFilterPreset(snap.filterPreset)
    setCropAspect(snap.cropAspect)
    setBlurAmount(snap.blurAmount)
    setFps(snap.fps)
    setSmoothing(snap.smoothing)
    setModelId(snap.modelId)
    setSettingsVersion((v) => v + 1)
  }

  const undoSettings = () => {
    const prev = undoStackRef.current.pop()
    if (!prev) return
    redoStackRef.current.push(settingsNow())
    applySettings(prev)
  }

  const redoSettings = () => {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push(settingsNow())
    applySettings(next)
  }

  void settingsVersion

  const togglePlay = () => {
    const src = sourceRef.current
    if (!src) return
    if (playing) {
      src.pause()
      segVideoRef.current?.pause()
      setPlaying(false)
    } else {
      void src.play()
      if (segVideoRef.current) {
        segVideoRef.current.currentTime = src.currentTime
        void segVideoRef.current.play()
      }
      setPlaying(true)
    }
  }

  const runPointTrack = async (point: { x: number; y: number }) => {
    if (!file || !meta || samBusy) return
    const key = getMetaKey()
    if (!key) {
      setSubjectMode("pick")
      setSamStatus("Add your Meta API key first.")
      return
    }
    setSamBusy(true)
    setSamStatus("Uploading clip, then SAM 3.1 tracks your click…")
    try {
      const result = await trackPointInVideo(file, point, key, meta.width, meta.height, () =>
        setSamStatus("Uploaded — tracking the clicked object…")
      )
      setTracked(result)
      setSubjectMode("pick")
      setHiddenIds(new Set())
      recordRun({
        action: "SAM click-to-track",
        model: "SAM 3.1 (point prompt)",
        where: "cloud",
        cost: Math.max(0.01, (result.frames.length / 1000) * 0.2),
        detail: `${result.frames.length} frames`,
      })
      setTrackClickArmed(false)
      setSamStatus(
        result.frames.length
          ? `Tracked the clicked object across ${result.frames.length} frames. Export with SAM masks when ready.`
          : "SAM found nothing to track from that click."
      )
    } catch (err: any) {
      setSamStatus(err?.message || "Click tracking failed.")
    } finally {
      setSamBusy(false)
    }
  }

  // Single-frame preview of the current settings. Regenerated on change so the
  // choice of model and backdrop is verifiable in ~200ms rather than after a
  // run that can take minutes.
  const [preview, setPreview] = React.useState<{ url: string; ms: number } | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [previewTime, setPreviewTime] = React.useState(0)

  // Newest frame emitted during a run, so progress is visible rather than a bar.
  const [liveFrame, setLiveFrame] = React.useState<string | null>(null)

  // Full-length segmented preview: the whole clip processed at preview
  // settings and encoded, so what plays is what the export will produce —
  // not one frame's promise of it.
  const [fullPreview, setFullPreview] = React.useState<{ url: string; bytes: number } | null>(null)
  const [previewBusy, setPreviewBusy] = React.useState(false)

  const generateFullPreview = async () => {
    if (!file || !meta || previewBusy || busy) return
    setPreviewBusy(true)
    setError(null)
    try {
      const previewFps = Math.min(fps, 8)
      const { frames, meta: m } = await processVideo({
        file,
        backdrop,
        fps: previewFps,
        caption,
        filter: subjectFilter || undefined,
        badge,
        cropRatio,
        depthSlice: studio.controls.depthSlice,
        smoothing,
        modelId,
        inferShortEdge: 384,
        onProgress: (d, t) => {
          setDone(d)
          setTotal(t)
        },
      })
      const blob = await encodeFrames(frames, m, previewFps, mode === "transparent")
      recordRun({
        action: "Full segmented preview",
        model: MODELS.find((mm) => mm.id === modelId)?.label ?? modelId,
        where: "device-gpu",
        cost: 0,
        detail: `${frames.length} frames @ ${previewFps}fps`,
      })
      setFullPreview((old) => {
        if (old) URL.revokeObjectURL(old.url)
        return { url: URL.createObjectURL(blob), bytes: blob.size }
      })
    } catch (err: any) {
      setError(err?.message || "Full preview failed")
    } finally {
      setPreviewBusy(false)
    }
  }

  // SAM 3.1 tracking (BYOK): one prompt, stable object ids across frames.
  const [samPrompt, setSamPrompt] = React.useState("")
  // Agent chat (bottom inset): one sentence -> Muse plan -> SAM tracking.
  const [agentCommand, setAgentCommand] = React.useState("")
  const [agentRunning, setAgentRunning] = React.useState(false)
  const [agentTrace, setAgentTrace] = React.useState<string[]>([])
  const agentInputRef = React.useRef<HTMLInputElement>(null)
  /** "remove X, keep the rest" inverts the tracked matte at export time. */
  const [trackInvert, setTrackInvert] = React.useState(false)
  const [subjectMode, setSubjectMode] = React.useState<"auto" | "pick">("auto")
  const [hasKey, setHasKey] = React.useState(() => !!getMetaKey())
  const subjectInputRef = React.useRef<HTMLInputElement>(null)
  const [samBusy, setSamBusy] = React.useState(false)
  const [samStatus, setSamStatus] = React.useState<string | null>(null)
  const [tracked, setTracked] = React.useState<TrackResult | null>(null)
  const [hiddenIds, setHiddenIds] = React.useState<Set<string>>(new Set())
  const [trackedPreview, setTrackedPreview] = React.useState<string | null>(null)

  const busy = stage === "segmenting" || stage === "encoding" || stage === "zipping"

  const backdrop: VideoBackdrop =
    mode === "color"
      ? { type: "color", color: bgColor }
      : mode === "gradient"
        ? { type: "gradient", style: gradient }
        : mode === "blur"
          ? { type: "blur", amount: blurAmount, depth: studio.controls.depthBokeh }
          : mode === "image" && backdropImage
            ? { type: "image", dataUrl: backdropImage }
            : { type: "transparent" }

  const cropRatio =
    cropAspect === "1:1"
      ? 1
      : cropAspect === "4:5"
        ? 4 / 5
        : cropAspect === "16:9"
          ? 16 / 9
          : cropAspect === "9:16"
            ? 9 / 16
            : null

  const subjectFilter = buildSubjectFilter(filterPreset, {
    brightness: 1,
    contrast: 1,
    saturation: 1,
  })

  const pick = async (f: File) => {
    setError(null)
    setResult(null)
    setZip(null)
    setTracked(null)
    setTrackedPreview(null)
    setSamStatus(null)
    setFile(f)
    setMeta(null)
    setPreview(null)
    setLiveFrame(null)

    setSourceUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(f)
    })

    try {
      const m = await readVideoMeta(f)
      setMeta(m)
      // Mid-clip is a better default than frame 0, which is often a fade-in.
      setPreviewTime(Math.min(m.duration / 2, Math.max(0, m.duration - 0.05)))
    } catch (err: any) {
      setError(err?.message || "Could not read that video")
    }
  }

  // Regenerate the settings preview whenever anything affecting output changes.
  // Debounced because dragging the blur or scrub slider would otherwise queue a
  // segmentation per pixel of travel.
  React.useEffect(() => {
    if (!file || !meta || busy) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setPreviewing(true)
      try {
        const { blob, ms } = await previewFrame(file, previewTime, backdrop, modelId, caption, { filter: subjectFilter || undefined, badge, cropRatio, depthSlice: studio.controls.depthSlice })
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old.url)
          return { url, ms }
        })
      } catch {
        // A failed preview should not block the export path.
      } finally {
        if (!cancelled) setPreviewing(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, meta, mode, blurAmount, bgColor, gradient, backdropImage, modelId, previewTime, busy, caption, badge, filterPreset, cropRatio, subjectFilter, studio.controls.depthBokeh, studio.controls.depthSlice])

  React.useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    },
    [sourceUrl]
  )

  const run = async () => {
    if (!file) return
    setError(null)
    setResult(null)
    setZip(null)
    framesRef.current = []

    const controller = new AbortController()
    abortRef.current = controller

    try {
      setStage("segmenting")
      const { frames, meta: m } = await processVideo({
        file,
        backdrop,
        fps,
        modelId,
        caption,
        filter: subjectFilter || undefined,
        badge,
        cropRatio,
        depthSlice: studio.controls.depthSlice,
        smoothing,
        signal: controller.signal,
        onProgress: (d, t) => {
          setDone(d)
          setTotal(t)
        },
        onFrame: (blob) => {
          const url = URL.createObjectURL(blob)
          setLiveFrame((old) => {
            if (old) URL.revokeObjectURL(old)
            return url
          })
        },
      })
      framesRef.current = frames
      metaRef.current = m

      setStage("encoding")
      const blob = await encodeFrames(
        frames,
        m,
        fps,
        mode === "transparent",
        controller.signal
      )
      setResult({ url: URL.createObjectURL(blob), bytes: blob.size })
      setStage("done")
      recordRun({
        action: "Video export",
        model: MODELS.find((mm) => mm.id === modelId)?.label ?? modelId,
        where: "device-gpu",
        cost: 0,
        detail: `${frames.length} frames · ${(blob.size / 1048576).toFixed(1)} MB WebM`,
      })
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStage("idle")
      } else {
        setError(err?.message || "Processing failed")
        setStage("idle")
      }
    } finally {
      abortRef.current = null
    }
  }

  const makeZip = async () => {
    if (!framesRef.current.length) return
    setStage("zipping")
    try {
      const blob = await framesToPngZip(framesRef.current)
      setZip({ url: URL.createObjectURL(blob), bytes: blob.size })
    } catch (err: any) {
      setError(err?.message || "Could not build the frame archive")
    } finally {
      setStage("done")
    }
  }

  const runSamTracking = async () => {
    if (!file || !meta || samBusy) return
    const key = getMetaKey()
    if (!key) {
      setSubjectMode("pick")
      setSamStatus("Add your Meta API key first.")
      return
    }
    if (!samPrompt.trim()) return
    setSamBusy(true)
    setSamStatus("Uploading clip to Meta (this file leaves the device)…")
    setTracked(null)
    setTrackedPreview(null)
    try {
      const result = await trackConceptInVideo(
        file,
        samPrompt.trim(),
        key,
        meta.width,
        meta.height,
        () => setSamStatus("Uploaded — SAM 3.1 is tracking…")
      )
      setTracked(result)
      setSubjectMode("pick")
      setHiddenIds(new Set())
      recordRun({
        action: `SAM track "${samPrompt.trim()}"`,
        model: "SAM 3.1",
        where: "cloud",
        cost: Math.max(0.01, (result.frames.length / 1000) * 0.2),
        detail: `${result.objectIds.length} object(s) · ${result.frames.length} frames`,
      })
      setSamStatus(
        result.frames.length === 0
          ? `SAM 3.1 found no "${samPrompt.trim()}" in this clip.`
          : `Tracked ${result.objectIds.length} object(s) across ${result.frames.length} frames. Scrub, then render a tracked frame.`
      )
    } catch (err: any) {
      setSamStatus(err?.message || "Tracking failed.")
    } finally {
      setSamBusy(false)
    }
  }

  /** Paint the tracked mask nearest the scrub position over the source frame. */
  const renderTrackedFrame = async (download = false) => {
    const video = sourceRef.current
    if (!video || !tracked || !meta) return
    const nearest = nearestTrackedFrame(tracked, previewTime, meta.duration)
    if (!nearest) return

    const canvas = document.createElement("canvas")
    canvas.width = meta.width
    canvas.height = meta.height
    const ctx = canvas.getContext("2d")!
    ctx.drawImage(video, 0, 0, meta.width, meta.height)

    // Same matte the export uses: visible objects, inverted for "remove it".
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0, j = 3; i < nearest.union.length; i++, j += 4) {
      const hit = nearest.objects.some((o) => !hiddenIds.has(o.objectId) && o.mask[i])
      img.data[j] = hit !== trackInvert ? 255 : 0
    }
    ctx.putImageData(img, 0, 0)

    const url = canvas.toDataURL("image/png")
    if (download) {
      const a = document.createElement("a")
      a.href = url
      a.download = `${file?.name.replace(/\.[^/.]+$/, "") || "frame"}-sam-${nearest.frame}.png`
      a.click()
    } else {
      setTrackedPreview(url)
    }
  }

  // The cutout pane follows the scrubber and the object toggles, so tracking
  // shows its result without a "render" button.
  React.useEffect(() => {
    if (!tracked || !meta) return
    const t = window.setTimeout(() => void renderTrackedFrame(false), 160)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracked, hiddenIds, trackInvert, previewTime, meta])

  /**
   * Export the whole clip using SAM's tracked masks as the matte.
   *
   * Same two-pass pipeline as local export — frames are composited first,
   * then replayed into the recorder — but the compositor takes its alpha
   * from SAM per frame instead of running a local model. Hidden objects
   * are excluded. SAM edges are binary, so this trades the local matte's
   * soft hair edge for semantic accuracy about *which* object is kept.
   */
  const exportSam = async () => {
    if (!file || !tracked || !meta || busy) return
    setError(null)
    setResult(null)
    setZip(null)
    framesRef.current = []

    const controller = new AbortController()
    abortRef.current = controller

    try {
      setStage("segmenting")
      const hidden = hiddenIds
      const { frames, meta: m } = await processVideo({
        file,
        backdrop,
        fps,
        smoothing,
        caption,
        filter: subjectFilter || undefined,
        badge,
        cropRatio,
        depthSlice: studio.controls.depthSlice,
        signal: controller.signal,
        alphaAt: (time) => {
          const frame = nearestTrackedFrame(tracked, time, meta.duration)
          if (!frame) return null
          const union = visibleUnion(frame, hidden)
          if (!trackInvert) return union
          const inverted = new Uint8Array(union.length)
          for (let i = 0; i < union.length; i++) inverted[i] = union[i] ? 0 : 255
          return inverted
        },
        onProgress: (d, t) => {
          setDone(d)
          setTotal(t)
        },
        onFrame: (blob) => {
          const url = URL.createObjectURL(blob)
          setLiveFrame((old) => {
            if (old) URL.revokeObjectURL(old)
            return url
          })
        },
      })
      framesRef.current = frames
      metaRef.current = m

      setStage("encoding")
      const blob = await encodeFrames(frames, m, fps, mode === "transparent", controller.signal)
      setResult({ url: URL.createObjectURL(blob), bytes: blob.size })
      setStage("done")
      setSamStatus("Exported with SAM 3.1 masks — download below.")
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setStage("idle")
      } else {
        setError(err?.message || "SAM export failed")
        setStage("idle")
      }
    } finally {
      abortRef.current = null
    }
  }

  /**
   * Chat bar for video, same contract as the studio's: Muse turns a sentence
   * into a validated plan (it sees one 512px frame to name the subject), SAM
   * 3.1 tracks that concept through the clip, and the plan's backdrop is
   * applied. Export stays a deliberate click because it takes a while.
   */
  const runAgentCommand = async (text: string) => {
    const command = text.trim()
    if (!command || agentRunning || !file || !meta) return
    const key = getMetaKey()
    if (!key) {
      setAgentTrace(["Add your Meta API key under Edit → Subject → Pick object. Local tools still work without one."])
      setSubjectMode("pick")
      setPanelTab("edit")
      return
    }
    setAgentRunning(true)
    setAgentTrace(["Asking Muse for a plan (it sees one 512px frame to name the subject)…"])
    const t0 = performance.now()
    try {
      let thumb: string | undefined
      const video = sourceRef.current
      if (video && video.videoWidth) {
        const frame = document.createElement("canvas")
        frame.width = video.videoWidth
        frame.height = video.videoHeight
        frame.getContext("2d")!.drawImage(video, 0, 0)
        thumb = downscaleCanvas(frame, 512).canvas.toDataURL("image/jpeg", 0.85)
      }
      const plan = await planCommand(command, key, "muse-spark-1.3", thumb)
      const trace = [`Plan: ${plan.summary}`]
      setAgentTrace([...trace])

      if (plan.background.type === "color") {
        setMode("color")
        setBgColor(plan.background.color)
        trace.push(`Backdrop set to ${plan.background.color}.`)
      } else {
        setMode("transparent")
        trace.push("Backdrop set to transparent.")
      }

      if (plan.concept) {
        trace.push(`Uploading the clip to Meta and tracking "${plan.concept}" with SAM 3.1…`)
        setAgentTrace([...trace])
        const result = await trackConceptInVideo(file, plan.concept, key, meta.width, meta.height)
        setTracked(result)
        setSubjectMode("pick")
        setTrackedPreview(null)
        setHiddenIds(new Set())
        setTrackInvert(plan.action === "remove")
        setSamPrompt(plan.concept)
        recordRun({
          action: `Agent: ${command}`,
          model: "SAM 3.1",
          where: "cloud",
          ms: performance.now() - t0,
          cost: Math.max(0.01, (result.frames.length / 1000) * 0.2),
          detail: `${result.objectIds.length} object(s) · ${result.frames.length} frames`,
        })
        trace.pop()
        if (result.frames.length === 0) {
          trace.push(`SAM 3.1 found no "${plan.concept}" in this clip.`)
        } else {
          trace.push(
            `Tracked ${result.objectIds.length} "${plan.concept}" across ${result.frames.length} frames (${plan.action === "remove" ? "removing it, keeping the rest" : "keeping it"}).`,
            "Verified. Press Export to render with these masks."
          )
        }
      } else {
        setTracked(null)
        setTrackInvert(false)
        trace.push("No object named, so the local matte is used. Press Export to render.")
      }
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
      return runAgentCommand(text)
    },
    onStatus: (message) => {
      setAgentTrace([message])
    },
  })

  React.useEffect(() => {
    if (viewMode !== "depth" || !sourceUrl) return
    let stale = false
    const t = window.setTimeout(() => {
      const video = sourceRef.current
      if (!video || !video.videoWidth) return
      const frame = document.createElement("canvas")
      frame.width = video.videoWidth
      frame.height = video.videoHeight
      frame.getContext("2d")!.drawImage(video, 0, 0)
      void estimateDepth(frame)
        .then((map) => {
          if (!stale) setDepthUrl(depthToCanvas(map, "turbo").toDataURL("image/png"))
        })
        .catch(() => {})
    }, 250)
    return () => {
      stale = true
      window.clearTimeout(t)
    }
  }, [viewMode, sourceUrl, previewTime])

  const [fitBusy, setFitBusy] = React.useState(false)
  /** Window the slice around the subject's distance in the frame under the scrubber. */
  const fitSliceToSubject = async () => {
    const video = sourceRef.current
    if (!video || !video.videoWidth || fitBusy) return
    setFitBusy(true)
    try {
      const frame = document.createElement("canvas")
      frame.width = video.videoWidth
      frame.height = video.videoHeight
      frame.getContext("2d")!.drawImage(video, 0, 0)
      const blob = await new Promise<Blob>((res) => frame.toBlob((b) => res(b!), "image/png"))
      const [cut, depth] = await Promise.all([removeBackground(blob, modelId), estimateDepth(frame)])
      const focal = focalDepth(depth, cut.alpha, cut.width, cut.height, 1, 0)
      studio.setControls((c) => ({
        ...c,
        depthSlice: { ...c.depthSlice, ...sliceAroundSubject(focal), enabled: true },
      }))
    } catch {
      // Leave the slice as it was.
    } finally {
      setFitBusy(false)
    }
  }

  const estFrames = meta ? Math.max(1, Math.floor(meta.duration * fps)) : 0
  // ~100ms/frame of inference measured for MODNet on WebGPU, plus seek overhead.
  const estSeconds = Math.round((estFrames * 0.13) + estFrames / fps)

  const aspect = meta ? meta.width / meta.height : 16 / 9
  const segSrc = result?.url ?? fullPreview?.url ?? null
  const paneZoom: React.CSSProperties = { transform: `scale(${zoom})` }
  const segContent = tracked && trackedPreview && !result ? (
    <img src={trackedPreview} alt="SAM 3.1 tracked cutout at the scrub position" className="absolute inset-0 size-full object-contain" />
  ) : segSrc ? (
    <video
      ref={segVideoRef}
      src={segSrc}
      muted
      loop
      playsInline
      className="absolute inset-0 size-full object-contain"
    />
  ) : busy && liveFrame ? (
    <img src={liveFrame} alt="Frame being processed" className="absolute inset-0 size-full object-contain" />
  ) : trackedPreview ? (
    <img src={trackedPreview} alt="SAM 3.1 tracked objects at the scrub position" className="absolute inset-0 size-full object-contain" />
  ) : preview ? (
    <img src={preview.url} alt="Preview of current settings" className="absolute inset-0 size-full object-contain" />
  ) : (
    <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground p-6 text-center">
      {previewing ? "Segmenting…" : "Segmented preview will appear here"}
    </span>
  )
  const originalContent = (
    <video
      ref={sourceRef}
      src={sourceUrl ?? undefined}
      muted
      loop
      playsInline
      onTimeUpdate={() => {
        const src = sourceRef.current
        if (!src) return
        setPlayTime(src.currentTime)
        const seg = segVideoRef.current
        if (seg && Math.abs(seg.currentTime - src.currentTime) > 0.25) {
          seg.currentTime = src.currentTime
        }
      }}
      onClick={(e) => {
        if (!trackClickArmed || !meta) return
        const rect = e.currentTarget.getBoundingClientRect()
        void runPointTrack({
          x: ((e.clientX - rect.left) / rect.width) * meta.width,
          y: ((e.clientY - rect.top) / rect.height) * meta.height,
        })
      }}
      className={"absolute inset-0 size-full object-contain " + (trackClickArmed ? "cursor-crosshair" : "")}
    />
  )
  const pill = (label: string) => (
    <span className="absolute top-3 left-3 z-10 px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-md text-foreground text-[11px] font-medium border border-border/50">
      {label}
    </span>
  )

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <ModelLoadBar className="rounded-2xl" />

      {error && (
        <div className="mx-4 mt-2 flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2">
          <AlertTriangle className="size-3.5 text-warn mt-0.5 shrink-0" />
          <p className="text-[11px] leading-snug text-warn">{error}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) pick(f)
        }}
      />

      {!file ? (
        <div className="flex-1 min-h-0 flex items-center justify-center p-6">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full max-w-xl rounded-2xl p-12 bg-surface-2/80 hover:bg-surface-3 shadow-surface-2 transition-colors duration-80 flex flex-col items-center gap-3"
          >
            <div className="size-14 rounded-2xl bg-surface-3 flex items-center justify-center shadow-surface-1">
              <Film className="size-7" />
            </div>
            <span className="text-sm font-semibold">Choose a video</span>
            <span className="text-xs text-muted-foreground">
              MP4, MOV, WebM — anything this browser can play. Every frame is segmented on this device.
            </span>
          </button>
        </div>
      ) : (
        <>
          <FileBar
            name={file.name}
            detail={meta ? `(${meta.width}×${meta.height} · ${meta.duration.toFixed(1)}s)` : "reading…"}
            actions={
              <>
                <Button variant="ghost" size="compact" onClick={undoSettings} disabled={undoStackRef.current.length === 0} className="h-7 text-[11px] text-muted-foreground hover:text-foreground" title="Undo settings change">
                  Undo
                </Button>
                <Button variant="ghost" size="compact" onClick={redoSettings} disabled={redoStackRef.current.length === 0} className="h-7 text-[11px] text-muted-foreground hover:text-foreground" title="Redo settings change">
                  Redo
                </Button>
                {!busy && (
                  <Button
                    variant="ghost"
                    size="compact"
                    className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setFile(null)
                      setMeta(null)
                      setResult(null)
                      setZip(null)
                      setStage("idle")
                    }}
                  >
                    <X className="size-3" /> New Video
                  </Button>
                )}
              </>
            }
          />

          <section aria-label="Video editor" className="flex-1 min-h-0 relative p-4 overflow-hidden">
            {sourceUrl && (
              <div className="absolute inset-4 flex gap-3">
                {viewMode !== "cutout" && viewMode !== "split" && (
                  <div className="flex-1 min-w-0 relative h-full">
                    <FitBox aspect={aspect} className="rounded-xl overflow-hidden shadow-2xl bg-black/40 transition-transform duration-80" style={paneZoom}>
                      {originalContent}
                      {pill("Original")}
                    </FitBox>
                  </div>
                )}
                {viewMode === "split" ? (
                  <div className="flex-1 min-w-0 relative h-full">
                    <FitBox aspect={aspect} className="rounded-xl overflow-hidden shadow-2xl bg-checkered transition-transform duration-80" style={paneZoom}>
                      {segContent}
                      <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${splitPos}%)` }}>
                        {originalContent}
                      </div>
                      <div
                        role="slider"
                        tabIndex={0}
                        aria-label="Before and after split"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(splitPos)}
                        className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize z-20 flex justify-center"
                        style={{ left: `${splitPos}%` }}
                        onPointerDown={(e) => {
                          const box = e.currentTarget.parentElement!.getBoundingClientRect()
                          e.currentTarget.setPointerCapture(e.pointerId)
                          const move = (ev: PointerEvent) =>
                            setSplitPos(Math.min(100, Math.max(0, ((ev.clientX - box.left) / box.width) * 100)))
                          const up = () => {
                            window.removeEventListener("pointermove", move)
                            window.removeEventListener("pointerup", up)
                          }
                          window.addEventListener("pointermove", move)
                          window.addEventListener("pointerup", up)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowLeft") setSplitPos((p) => Math.max(0, p - 2))
                          if (e.key === "ArrowRight") setSplitPos((p) => Math.min(100, p + 2))
                        }}
                      >
                        <div className="w-0.5 h-full bg-white/80 shadow" />
                      </div>
                    </FitBox>
                  </div>
                ) : viewMode !== "original" ? (
                  <div className="flex-1 min-w-0 relative h-full">
                    <FitBox aspect={aspect} className="rounded-xl overflow-hidden shadow-2xl bg-checkered transition-transform duration-80" style={paneZoom}>
                      {viewMode === "depth" ? (
                        depthUrl ? (
                          <img src={depthUrl} alt="Depth map of this frame" className="absolute inset-0 size-full object-contain" />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-muted-foreground">
                            Reading depth…
                          </span>
                        )
                      ) : (
                        segContent
                      )}
                      {pill(viewMode === "depth" ? "Depth" : result ? "Result" : "Cutout")}
                    </FitBox>
                  </div>
                ) : null}
              </div>
            )}

            {/* View mode switcher — the same four modes as the image studio. */}
            

            {busy && (
              <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 w-64 rounded-xl bg-surface-2/95 px-3 py-2 shadow-surface-2 backdrop-blur space-y-1.5">
                <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                  <div
                    className="h-full bg-ok transition-[width] duration-160"
                    style={{ width: stage === "segmenting" && total ? `${(done / total) * 100}%` : "100%" }}
                  />
                </div>
                <p className="text-[11px] font-mono text-muted-foreground">
                  {stage === "segmenting"
                    ? `segmenting frame ${done} / ${total}`
                    : stage === "encoding"
                      ? "encoding video…"
                      : "building frame archive…"}
                </p>
              </div>
            )}

            {/* Tool dock: same compact bottom-centre placement as the studio. */}
            <BottomSlot slot="center"><div data-tour="dock" className="">
              <PillTabs
                ariaLabel="Video tools"
                iconOnlyInactive
                value={trackClickArmed ? 1 : 0}
                onChange={(i) => {
                  if (i === 0) togglePlay()
                  else if (i === 1) setTrackClickArmed((v) => !v)
                  else if (i === 2) {
                    setSubjectMode("pick")
                    setPanelTab("edit")
                    window.setTimeout(() => subjectInputRef.current?.focus(), 0)
                  }
                  else if (i === 3) void generateFullPreview()
                  else if (i === 4) void (tracked ? exportSam() : run())
                }}
                items={[
                  { label: playing ? "Pause" : "Play", title: playing ? "Pause both" : "Play both", icon: Play },
                  { label: "Track", title: "Click-to-track (SAM point)", icon: MousePointerClick },
                  { label: "Text", title: "SAM text tracking — AI tab", icon: WandSparkles },
                  { label: "Preview", title: "Generate full segmented preview", icon: Scissors },
                  { label: "Export", title: "Export video (Remove Background)", icon: Download },
                ]}
              />
            </div></BottomSlot>

            {/* Zoom drives both views, same control as the studio. */}
            <BottomSlot slot="right"><PillTabs ariaLabel="View mode" value={VIEW_MODES.findIndex((m) => m[0] === viewMode)} onChange={(i) => setViewMode(VIEW_MODES[i][0])} iconOnlyInactive items={VIEW_MODES.map((m) => ({ label: m[1], icon: m[2] }))} /><ZoomControl zoom={zoom} onChange={setZoom} /></BottomSlot>
          </section>

          {/* One transport for both players. */}
          {meta && (
            <div className="px-4 pb-3 flex items-center gap-2 shrink-0">
              <Button variant="secondary" size="compact" onClick={togglePlay} className="h-7 text-[11px] shrink-0" aria-label={playing ? "Pause both videos" : "Play both videos"}>
                {playing ? "Pause" : "Play"}
              </Button>
              <Slider
                min={0}
                max={Math.max(0.05, meta.duration)}
                step={0.05}
                value={[previewTime]}
                onValueChange={([v]) => {
                  setPreviewTime(v)
                  if (sourceRef.current) sourceRef.current.currentTime = v
                  if (segVideoRef.current) segVideoRef.current.currentTime = v
                }}
                label=""
                formatValue={() => ""}
                size="compact"
                variant="compact"
              />
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                {playTime.toFixed(1)}s / {meta.duration.toFixed(1)}s
              </span>
            </div>
          )}

          <BottomSlot slot="chat">
            <div data-tour="command">
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 shadow-surface-1 px-2.5 py-1.5">
                <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
                <input
                  ref={agentInputRef}
                  type="text"
                  value={agentCommand}
                  onChange={(e) => setAgentCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runAgentCommand(agentCommand)}
                  placeholder='Tell the agent… "keep the dog on white"'
                  aria-label="Agent command"
                  disabled={agentRunning}
                  className="flex-1 min-w-[10rem] bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
                />
                {!agentCommand && !agentRunning && (
                  <div className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden">
                    {[
                      "keep the person on white",
                      "remove the background, keep everything else",
                      "keep the dog, transparent background",
                    ].map((example) => (
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
                  disabled={agentRunning || !meta}
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
                  disabled={!agentCommand.trim() || agentRunning || !meta}
                  onClick={() => void runAgentCommand(agentCommand)}
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
                            (step.startsWith("Verified")
                              ? "bg-ok"
                              : step.startsWith("Plan")
                                ? "bg-foreground"
                                : "bg-muted-foreground/50")
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
        </>
      )}

      <RightSidebarPanel title="Video Controls">
        <PanelTabs value={panelTab} onChange={setPanelTab} tabs={["edit", "model", "export", "audit"]} />

        <TabPane active={panelTab} tab="edit">
          {/* Subject: the first decision for a clip. Whole subject runs on this
              device; Pick object uses SAM 3.1 and uploads the clip. */}
          <PanelCard
            id="video-subject"
            title="Subject"
            icon={Sparkles}
            defaultOpen
            autoOpen={subjectMode === "pick"}
            summary={subjectMode === "pick" ? (samPrompt.trim() ? `Pick: ${samPrompt.trim()}${trackInvert ? " (removed)" : ""}` : "Pick object") : "Whole subject"}
          >
            <PillTabs
              ariaLabel="Subject mode"
              className="w-full"
              value={subjectMode === "auto" ? 0 : 1}
              onChange={(i) => {
                if (i === 0) {
                  setSubjectMode("auto")
                  setTracked(null)
                  setTrackedPreview(null)
                  setTrackInvert(false)
                  setSamStatus(null)
                } else {
                  setSubjectMode("pick")
                  window.setTimeout(() => subjectInputRef.current?.focus(), 0)
                }
              }}
              items={[{ label: "Whole subject" }, { label: "Pick object", icon: Sparkles }]}
            />
            {subjectMode === "auto" ? (
              <p className="text-[10px] leading-snug text-muted-foreground">
                The main person or object is matted on this device, soft hair edges
                included. Nothing is uploaded. Choose <span className="text-foreground">Pick object</span> to
                keep one specific thing, like the dog.
              </p>
            ) : !hasKey ? (
              <MetaKeyField
                onSaved={() => setHasKey(true)}
                hint="Pick object uses SAM 3.1. Your key stays in this browser and goes only to api.meta.ai."
              />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={subjectInputRef}
                    type="text"
                    value={samPrompt}
                    onChange={(e) => setSamPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void runSamTracking()}
                    placeholder="What should we keep? e.g. dog"
                    aria-label="Object to track in this video"
                    disabled={!file || samBusy}
                    className="flex-1 min-w-0 h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-40"
                  />
                  <Button
                    size="compact"
                    variant="primary"
                    disabled={!file || !samPrompt.trim() || samBusy}
                    onClick={() => void runSamTracking()}
                    className="h-7 text-[11px]"
                  >
                    {samBusy ? "…" : "Track"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1">
                  {["person", "dog", "car", "product"].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSamPrompt(c)}
                      className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors duration-80"
                    >
                      {c}
                    </button>
                  ))}
                  <button
                    type="button"
                    disabled={!file || samBusy}
                    onClick={() => setTrackClickArmed((v) => !v)}
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] transition-colors duration-80 disabled:opacity-40 " +
                      (trackClickArmed ? "bg-selected text-foreground" : "bg-surface-3 text-muted-foreground hover:text-foreground")
                    }
                  >
                    {trackClickArmed ? "Click the object in the video…" : "or click it in the video"}
                  </button>
                </div>
                {samStatus && (
                  <p className="text-[11px] leading-snug text-muted-foreground">{samStatus}</p>
                )}
                {tracked && tracked.frames.length > 0 && (
                  <div className="space-y-2">
                    <PillTabs
                      ariaLabel="Keep or remove the tracked object"
                      value={trackInvert ? 1 : 0}
                      onChange={(i) => setTrackInvert(i === 1)}
                      items={[{ label: "Keep it" }, { label: "Remove it" }]}
                    />
                    <div className="flex flex-wrap gap-1">
                      {tracked.objectIds.map((id) => (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={!hiddenIds.has(id)}
                          onClick={() =>
                            setHiddenIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(id)) next.delete(id)
                              else next.add(id)
                              return next
                            })
                          }
                          className={
                            "rounded-md px-1.5 py-1 text-[10px] transition-colors duration-80 " +
                            (hiddenIds.has(id)
                              ? "bg-surface-3 text-muted-foreground line-through"
                              : "bg-ok/15 text-ok")
                          }
                        >
                          object {id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Uploads this clip to Meta for tracking (about $0.01 for a short clip).
                  SAM edges are hard, trading hair softness for picking the right object.
                </p>
              </div>
            )}
          </PanelCard>

          <PanelCard
            id="video-depth-slice"
            title="Depth slice"
            icon={Layers}
            autoOpen={studio.controls.depthSlice.enabled}
            summary={studio.controls.depthSlice.enabled ? `On · ${studio.controls.depthSlice.near}–${studio.controls.depthSlice.far}` : "Off"}
            toggle={{
              checked: studio.controls.depthSlice.enabled,
              onChange: (enabled) =>
                studio.setControls((c) => ({ ...c, depthSlice: { ...c.depthSlice, enabled } })),
            }}
          >
            {studio.controls.depthSlice.enabled ? (
              <div className="space-y-2">
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[studio.controls.depthSlice.near]}
                  onValueChange={([v]) =>
                    studio.setControls((c) => ({
                      ...c,
                      depthSlice: { ...c.depthSlice, near: Math.min(v, c.depthSlice.far - 1) },
                    }))
                  }
                  label="Nearest"
                  formatValue={(v) => `${v}`}
                  size="compact"
                  variant="compact"
                />
                <Slider
                  min={0}
                  max={100}
                  step={1}
                  value={[studio.controls.depthSlice.far]}
                  onValueChange={([v]) =>
                    studio.setControls((c) => ({
                      ...c,
                      depthSlice: { ...c.depthSlice, far: Math.max(v, c.depthSlice.near + 1) },
                    }))
                  }
                  label="Farthest"
                  formatValue={(v) => `${v}`}
                  size="compact"
                  variant="compact"
                />
                <Slider
                  min={0}
                  max={30}
                  step={1}
                  value={[studio.controls.depthSlice.feather]}
                  onValueChange={([v]) =>
                    studio.setControls((c) => ({ ...c, depthSlice: { ...c.depthSlice, feather: v } }))
                  }
                  label="Soft edge"
                  formatValue={(v) => `${v}`}
                  size="compact"
                  variant="compact"
                />
                <div className="flex gap-1.5">
                  <Button
                    variant="secondary"
                    size="compact"
                    className="flex-1 h-7 text-[11px]"
                    loading={fitBusy}
                    disabled={fitBusy || !file}
                    onClick={() => void fitSliceToSubject()}
                    title="Window around the subject's distance in the current frame"
                  >
                    Fit to subject
                  </Button>
                  <Button
                    variant="outline"
                    size="compact"
                    className="flex-1 h-7 text-[11px]"
                    onClick={() =>
                      studio.setControls((c) => ({ ...c, depthSlice: { ...c.depthSlice, near: 0, far: 100 } }))
                    }
                  >
                    Reset range
                  </Button>
                </div>
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Trims every frame by distance (0 nearest, 100 farthest), read on this
                  device with Depth Anything. Adds about 0.2 s per frame to the export.
                </p>
              </div>
            ) : (
              <p className="text-[10px] leading-snug text-muted-foreground">
                Remove the floor, chairs or a wall the matte caught by keeping only a
                distance range. Runs on this device.
              </p>
            )}
          </PanelCard>

          <PanelCard
            id="video-overlay"
            title="Title & badge"
            summary={[caption.trim() && "Title", badge.trim() && "Badge"].filter(Boolean).join(" · ") || "None"}
            autoOpen={!!(caption.trim() || badge.trim())}
          >
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Text drawn over every frame"
              aria-label="Video caption text"
              className="w-full h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
            />
            <input
              type="text"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              placeholder="Promo badge (SALE, -20%…)"
              aria-label="Video promo badge text"
              maxLength={10}
              className="w-full h-7 rounded-md bg-surface-3 px-2 text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
            />
          </PanelCard>

          <PanelCard
            id="video-look"
            title="Look & crop"
            summary={`${filterPreset === "none" ? "No filter" : filterPreset} · ${cropAspect === "none" ? "Full frame" : cropAspect}`}
          >
            <div className="flex flex-wrap gap-1">
              {FILTER_PRESETS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filterPreset === f.id}
                  onClick={() => setFilterPreset(f.id)}
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] transition-colors duration-80 " +
                    (filterPreset === f.id
                      ? "bg-selected text-foreground"
                      : "bg-surface-3 text-muted-foreground hover:text-foreground")
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
            <TabsSubtle
              selectedIndex={["none", "1:1", "4:5", "16:9", "9:16"].indexOf(cropAspect)}
              onSelect={(i) =>
                setCropAspect((["none", "1:1", "4:5", "16:9", "9:16"] as const)[i])
              }
              size="compact"
              className="w-full flex"
            >
              <TabsSubtleItem index={0} label="Full" />
              <TabsSubtleItem index={1} label="1:1" />
              <TabsSubtleItem index={2} label="4:5" />
              <TabsSubtleItem index={3} label="16:9" />
              <TabsSubtleItem index={4} label="9:16" />
            </TabsSubtle>
          </PanelCard>

          <PanelCard
            id="video-stability"
            title="Stability"
            summary={smoothing === 0 ? "Smoothing off" : `Smoothing ${smoothing.toFixed(2)}`}
          >
            <Slider
              min={0}
              max={0.8}
              step={0.05}
              value={[smoothing]}
              onValueChange={([v]) => setSmoothing(v)}
              label="Temporal smoothing"
              formatValue={(v) => (v === 0 ? "off" : v.toFixed(2))}
              size="compact"
              variant="compact"
            />
            <p className="text-[10px] leading-snug text-muted-foreground">
              These models segment each frame independently. On a clip whose
              frames are identical the mask barely moves (0.00% of pixels shift),
              so smoothing is off by default — it trades flicker for motion lag.
              Raise it only if real footage shimmers. Not shown in the preview,
              which is a single frame.
            </p>
          </PanelCard>

        </TabPane>


        <TabPane active={panelTab} tab="model">
          <div className="space-y-2">
            <FieldLabel>
              Model
            </FieldLabel>
            <TabsSubtle
              selectedIndex={Math.max(
                0,
                VIDEO_MODELS.findIndex((m) => m.id === modelId)
              )}
              onSelect={(i) => {
                const next = VIDEO_MODELS[i]!.id
                setModelId(next)
                // RVM is not a registry model, so it must not be made active
                // for the still-image pipeline.
                if (next !== RVM_MODEL_ID) setActiveModel(next)
              }}
              size="compact"
              className="w-full flex"
            >
              {VIDEO_MODELS.map((m, i) => (
                <TabsSubtleItem key={m.id} index={i} label={m.label} />
              ))}
            </TabsSubtle>
            {modelId === RVM_MODEL_ID && (
              <p className="text-[10px] leading-snug text-warn">
                RobustVideoMatting is recurrent — it carries state between
                frames, which is what the still models cannot do. It runs on the
                CPU backend (~300ms a frame) because ONNX Runtime's WebGPU
                provider computes this graph incorrectly, and it showed no
                measurable steadiness gain on synthetic test clips. Worth trying
                on real footage that shimmers; otherwise MODNet is faster.
              </p>
            )}
          </div>
        </TabPane>

        <TabPane active={panelTab} tab="export">
          <Slider
            min={4}
            max={30}
            step={1}
            value={[fps]}
            onValueChange={([v]) => setFps(v)}
            label="Output FPS"
            formatValue={(v) => `${v} fps`}
            size="compact"
            variant="compact"
          />

          {meta && (
            <div className="space-y-1 pt-1 border-t border-border/40">
              {[
                ["Frames", String(estFrames)],
                ["Est. time", estSeconds > 90 ? `~${Math.round(estSeconds / 60)} min` : `~${estSeconds}s`],
                ["Codec", mode === "transparent" ? "VP8 + alpha" : "VP9"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between items-center">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    {k}
                  </span>
                  <span className="text-[11px] font-mono text-foreground/80">{v}</span>
                </div>
              ))}
            </div>
          )}

          {file && (
            <div className="space-y-2">
              <Button
                variant="secondary"
                size="compact"
                className="w-full"
                loading={previewBusy}
                disabled={previewBusy || busy || !meta}
                onClick={() => void generateFullPreview()}
              >
                {fullPreview ? "Regenerate full preview" : "Preview full video (segmented)"}
              </Button>
              <div className="flex gap-2">
              <Button
                variant="primary"
                size="compact"
                className="flex-1"
                loading={busy}
                disabled={busy || !meta}
                onClick={() => void (tracked ? exportSam() : run())}
              >
                {stage === "done"
                  ? "Process Again"
                  : tracked
                    ? "Export with SAM 3.1 masks"
                    : "Remove Background"}
              </Button>
              {busy && (
                <Button
                  variant="outline"
                  size="compact"
                  onClick={() => abortRef.current?.abort()}
                >
                  Cancel
                </Button>
              )}
              </div>
            </div>
          )}

          {result && file && (
            <div className="space-y-2 pt-1">
              <Button
                variant="primary"
                size="compact"
                className="w-full"
                leadingIcon={Download}
                onClick={() => {
                  const a = document.createElement("a")
                  a.href = result.url
                  a.download = `${file.name.replace(/\.[^/.]+$/, "")}-no-bg.webm`
                  a.click()
                }}
              >
                Download WebM ({(result.bytes / 1048576).toFixed(1)} MB)
              </Button>
              {!zip ? (
                <Button variant="outline" size="compact" className="w-full" leadingIcon={FileArchive} disabled={busy} onClick={makeZip}>
                  PNG frames (true alpha)
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="compact"
                  className="w-full"
                  leadingIcon={Download}
                  onClick={() => {
                    const a = document.createElement("a")
                    a.href = zip.url
                    a.download = `${file.name.replace(/\.[^/.]+$/, "")}-frames.zip`
                    a.click()
                  }}
                >
                  Download ZIP ({(zip.bytes / 1048576).toFixed(1)} MB)
                </Button>
              )}
            </div>
          )}

          <p className="text-[10px] leading-snug text-muted-foreground">
            Long clips are slow: work scales with frames, so halving the output
            FPS halves the wait. For editor round-trips the PNG sequence is
            lossless and keeps full alpha.
          </p>
        </TabPane>

        <TabPane active={panelTab} tab="audit">
          <AuditPanel />
        </TabPane>
      </RightSidebarPanel>
    </div>
  )
}
