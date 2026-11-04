import { useVoiceCommand } from "@/hooks/use-voice-command"
import { BottomSlot, PillTabs } from "@/components/studio/chrome"
import { LatestRunBar } from "@/components/studio/audit-panel"
import * as React from "react"
import { Mic, Square } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { createPortal } from "react-dom"
import { createFileRoute } from "@tanstack/react-router"
import {
  UploadCloud,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Info,
  FileImage,
  ArrowRight,
  ShieldCheck,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { CardGroup, Card } from "@/components/ui/card"
import { ThinkingIndicator } from "@/components/ui/thinking-indicator"
import {
  encode,
  extensionFor,
  measureAllFormats,
} from "@/lib/export-image"
import {
  applyPatch,
  applySelection,
  capturePatch,
  composeCutout,
  createEditMask,
  hasEdits,
  paintOverlay,
  paintStroke,
  strokeBounds,
  UNDO_LIMIT,
  type UndoPatch,
} from "@/lib/brush"
import {
  addSamStatusListener,
  encodeImage,
  forgetEncodedImage,
  selectAt,
  warmSam,
  type SamPoint,
  type SamStatus,
} from "@/lib/sam"
import { SplitSlider } from "@/components/studio/split-slider"
import { Dock } from "@/components/ui/dock"
import { TourOverlay, useTour } from "@/components/studio/tour"
import {
  Bandage,
  Brush,
  Hand,
  Lasso,
  Redo2,
  Undo2,
  MousePointerClick,
  Move,
  PenTool,
  Pipette,
  SquareDashed,
  Stamp,
  WandSparkles,
} from "lucide-react"
import { polygonMask, rectMask } from "@/lib/selection"
import type { StudioTool } from "@/components/studio/studio-context"
import { useStudio } from "@/components/studio/studio-context"
import { useSidebarLayout } from "@/components/layout/sidebar-layout-context"
import {
  removeBackground,
  removeBackgroundProgressive,
  compositeToCanvas,
  drawCaption,
  updateAgentStatus,
  setupDownloadButton,
  getBgRemovalWorker,
  type BgMode,
} from "@/lib/bg-removal"
import { saveToHistory } from "@/lib/history-store"
import { fromShareLink, clearShareLink } from "@/lib/recipe/share"
import { controlsFromRecipe, recipeFromControls } from "@/lib/recipe/studio-bridge"
import { toJSON } from "@/lib/recipe/schema"
import { estimateDepth, type DepthMap } from "@/lib/depth"
import { depthToCanvas, downloadDepthPng } from "@/lib/depth-image"
import { depthSliceMatte, isNoopSlice, sliceAroundSubject } from "@/lib/depth-slice"
import { focalDepth } from "@/lib/bokeh"
import { useModelLoad } from "@/components/studio/model-load-bar"
import { takeSharedImage, onLaunchWithFiles } from "@/lib/share-target"
import { detectBackend, getModel } from "@/lib/models"
import { LAYER_COLORS, downscaleCanvas, getMetaKey, segmentConcept } from "@/lib/meta"
import { planCommand, simplifyConcept, verifyMask, type AgentPlan } from "@/lib/muse"
import { composeShareCard } from "@/lib/share-card"
import { recordRun } from "@/lib/run-info"
import { CROP_ASPECTS, cropRect } from "@/lib/crop"
import { SOCIAL_SIZES, renderSocialSize } from "@/lib/social"
import { buildSubjectFilter } from "@/lib/filters"
import { animateComposite } from "@/lib/animate"
import { alphaBounds } from "@/lib/pack"
import {
  addDinoStatusListener,
  encodeDinoImage,
  forgetDinoImage,
  similarAt,
  warmDino,
  type DinoStatus,
} from "@/lib/dino"
import { boxCentre, detectObjects } from "@/lib/grounding"
import { getActiveModelId, setActiveModel } from "@/lib/bg-removal"
import { addProgressListener } from "@/lib/bg-removal"
import { motion } from "framer-motion"
import { spring, reveal } from "@/lib/springs"

/**
 * The entrance each block of the empty state uses.
 *
 * 6px is deliberately small. A large travel distance reads as decoration; this
 * is just enough for the eye to catch an order of arrival, and it lands on the
 * same eased curve as everything else.
 */
const RISE = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: spring.moderate.duration, ease: [0.2, 0, 0, 1] as const } },
}

export interface StudioSearch {
  src?: string
  shared?: boolean
  bg?: string
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): StudioSearch => {
    return {
      src: (search.src as string) || (search.test as string) || undefined,
      bg: (search.bg as string) || undefined,
      // Set by the service worker's share-target redirect; see src/lib/share-target.ts.
      shared: search.shared === "1" || undefined,
    }
  },
  component: StudioPage,
})

// Served from our own origin as static assets. These used to be remote Unsplash
// URLs fetched through a server-side proxy, which made the busiest path on the
// site — clicking a sample on the homepage — consume a metered Function request
// per click. As static assets they are free and unlimited, need no CORS
// handling, work offline, and don't depend on someone else's photo IDs.
const SAMPLE_IMAGES = [
  { name: "Portrait", url: "/samples/portrait.jpg" },
  { name: "Sneakers", url: "/samples/sneakers.jpg" },
  { name: "Golden Retriever", url: "/samples/retriever.jpg" },
  { name: "Sports Car", url: "/samples/car.jpg" },
]

type ToolDef = { id: StudioTool; label: string; Icon: React.ComponentType<{ className?: string }> }

// Eleven tools collapse to five dock slots; the family's alternates appear in
// the tool-options bar beside the dock once one of them is active.
const TOOL_GROUPS: Array<{ id: string; tools: ToolDef[] }> = [
  { id: "move", tools: [{ id: "move", label: "Move / compare (V)", Icon: Move }] },
  { id: "hand", tools: [{ id: "hand", label: "Hand — drag to pan (H)", Icon: Hand }] },
  {
    id: "select",
    tools: [
      { id: "select", label: "Object select — click (S)", Icon: MousePointerClick },
      { id: "similar", label: "Select similar — shift-click (D)", Icon: WandSparkles },
      { id: "marquee", label: "Marquee select (M)", Icon: SquareDashed },
      { id: "lasso", label: "Lasso select (L)", Icon: Lasso },
      { id: "pen", label: "Pen select — Enter closes (P)", Icon: PenTool },
    ],
  },
  {
    id: "paint",
    tools: [
      { id: "brush", label: "Refine brush (B)", Icon: Brush },
      { id: "heal", label: "Healing brush — smooth the matte (J)", Icon: Bandage },
      { id: "clone", label: "Clone stamp — Alt-click source (C)", Icon: Stamp },
    ],
  },
  { id: "eyedropper", tools: [{ id: "eyedropper", label: "Eyedropper — pick backdrop colour (I)", Icon: Pipette }] },
]

function StudioPage() {
  const tour = useTour()
  const { src, bg } = Route.useSearch()
  const { setUploadHandler } = useSidebarLayout()

  const [currentFile, setCurrentFile] = React.useState<File | null>(null)
  const [originalCanvas, setOriginalCanvas] = React.useState<HTMLCanvasElement | null>(null)
  const [cutoutCanvas, setCutoutCanvas] = React.useState<HTMLCanvasElement | null>(null)

  // ─── Manual refinement ───
  // Refs rather than state: strokes mutate these on every pointer move, and
  // re-rendering React per sample would make the brush feel laggy. `editCount`
  // is the render trigger, bumped once per completed stroke.
  const baseAlphaRef = React.useRef<Uint8Array | null>(null)
  const editMaskRef = React.useRef<Uint8Array | null>(null)

  // Clone stamp + healing layers. Clone paints RGB into its own canvas
  // (the model's pixels are never touched); healing stores a replacement
  // alpha per painted pixel, computed from the neighbourhood at stroke end.
  const cloneCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const cloneSourceRef = React.useRef<{ x: number; y: number } | null>(null)
  const cloneOffsetRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const healMaskRef = React.useRef<Uint8Array | null>(null)
  const healAlphaRef = React.useRef<Uint8Array | null>(null)
  const healStrokeRef = React.useRef<Uint8Array | null>(null)
  const [penPoints, setPenPoints] = React.useState<Array<{ x: number; y: number }>>([])
  const undoRef = React.useRef<UndoPatch[][]>([])
  const strokePatchesRef = React.useRef<UndoPatch[]>([])
  const lastPointRef = React.useRef<{ x: number; y: number } | null>(null)
  const lastInGroup = React.useRef<Record<string, string>>({}).current
  const [editCount, setEditCount] = React.useState(0)

  // ─── Click-to-select ───
  const [samStatus, setSamStatus] = React.useState<SamStatus>({ kind: "idle" })
  const [samBusy, setSamBusy] = React.useState(false)

  // A click proposes a selection rather than applying it, so the region is
  // visible before it changes anything.
  const [pending, setPending] = React.useState<{
    mask: Uint8Array
    width: number
    height: number
    score: number
  } | null>(null)
  /** Per-object SAM layer tints, keyed to the panel's coloured chips. */
  const [pendingLayers, setPendingLayers] = React.useState<
    Array<{ mask: Uint8Array; width: number; height: number; color: string }> | null
  >(null)
  const overlayCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  // Prompt points accumulate, so a selection can be grown and corrected rather
  // than restarted: clicking a face gives the head, adding a point on the torso
  // grows it to the person, and an exclude point trims what crept in.
  const [selectPoints, setSelectPoints] = React.useState<SamPoint[]>([])
  const [isProcessing, setIsProcessing] = React.useState(false)
  const [statusType, setStatusType] = React.useState<"ready" | "loading" | "done" | "error">("ready")
  const [statusText, setStatusText] = React.useState<string>("ready")
  const modelLoad = useModelLoad()
  const [errorMsg, setErrorMsg] = React.useState<string>("")

  const targetCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const ghostCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  /** The cutout the reveal last ran for, so a slider drag does not re-trigger it. */
  const revealedForRef = React.useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const dropZoneRef = React.useRef<HTMLDivElement>(null)

  const {
    controls,
    fileSlotEl,
    setControls,
    setHasCutout,
    setOnDownload,
    setOnCopy, setEstimatedSize, setFormatSizes,
    setOnUndoEdit, setOnResetEdits, setCanUndoEdit, canUndoEdit, setSelectStatus,
    setPendingSelection, setOnApplyPending, setOnCancelPending, setOnTextSelect,
    setOnAgentPlan, setOnSelectSamObject, setOnOfflineTextSelect, setOnSocialPack,
    setOnAnimate, setAnimateBusy, setSamLayers, setOnToggleSamLayer,
  } = useStudio()

  const selectTool = React.useCallback(
    (tool: StudioTool) => {
      const group = TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === tool))
      if (group) lastInGroup[group.id] = tool
      setControls((c) => ({
        ...c,
        tool,
        refineActive: tool !== "move",
        pickColor: tool === "eyedropper" ? true : c.pickColor,
      }))
      if (tool !== "pen") setPenPoints([])
    },
    [lastInGroup, setControls]
  )

  React.useEffect(() => {
    if (bg) {
      if (bg === "white") {
        setControls((c) => ({ ...c, mode: "color", color: "#ffffff" }))
      } else if (bg === "black") {
        setControls((c) => ({ ...c, mode: "color", color: "#09090b" }))
      } else if (bg !== "transparent") {
        const hex = bg.startsWith("#") ? bg : `#${bg}`
        setControls((c) => ({ ...c, mode: "color", color: hex }))
      }
    }
  }, [bg, setControls])

  React.useEffect(() => {
    setUploadHandler(() => {
      fileInputRef.current?.click()
    })
  }, [setUploadHandler])

  // Constructed early so the weights start downloading before a file is
  // dropped. Progress is reported by useModelLoad above.
  React.useEffect(() => {
    getBgRemovalWorker()
  }, [])

  React.useEffect(() => {
    if (!src) return

    let canceled = false
    async function loadFromUrl() {
      setIsProcessing(true)
      setStatusType("loading")
      setStatusText("loading model...")
      updateAgentStatus("loading model...")

      try {
        // Fetched straight from the browser — there is no server-side proxy, so
        // nothing about this app is metered no matter how many people use it.
        // The cost is that the source host must allow cross-origin reads; most
        // image CDNs do, but a host with no CORS headers cannot be read here.
        let res: Response
        try {
          res = await fetch(src!, { mode: "cors" })
        } catch {
          throw new Error(
            `Could not read ${new URL(src!).host} from the browser — it does not allow ` +
              `cross-origin requests. Use a CORS-enabled image URL, or open the image ` +
              `with the file picker or clipboard paste instead.`
          )
        }
        if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`)

        const type = res.headers.get("Content-Type") || ""
        if (type && !type.startsWith("image/")) {
          throw new Error(`That URL returned "${type}", not an image`)
        }

        const blob = await res.blob()
        if (canceled) return

        const file = new File([blob], "image.png", { type: blob.type || "image/png" })
        processImageFile(file)
      } catch (err: any) {
        if (!canceled) {
          setErrorMsg(err.message || "Failed to load image from URL")
          setStatusType("error")
          setStatusText(`failed: ${err.message}`)
          updateAgentStatus(`failed: ${err.message}`)
          setIsProcessing(false)
        }
      }
    }

    loadFromUrl()
    return () => {
      canceled = true
    }
  }, [src])

  /** True between the preview matte landing and the real one replacing it. */
  const [isRefining, setIsRefining] = React.useState(false)

  /**
   * The source image, painted while the model works.
   *
   * The viewer mounts as soon as processing starts, but #cv has nothing in it
   * until a matte arrives — so clicking a sample showed an empty checkerboard
   * for as long as the model took, which on a cold load is thirty seconds of
   * looking at nothing. Showing the photo immediately makes the wait legible:
   * you can see what you picked, and the background falls away in place.
   */
  const [pendingSource, setPendingSource] = React.useState<Blob | null>(null)

  /**
   * Set when the worker caps an oversized image. Silently returning a smaller
   * cutout than the file handed over would look like a bug, so it is stated.
   */
  const [downscaleNote, setDownscaleNote] = React.useState<string | null>(null)

  React.useEffect(
    () =>
      addProgressListener((p) => {
        if (p.type === "downscaled" && p.from && p.to) {
          const mp = (s: { width: number; height: number }) =>
            ((s.width * s.height) / 1_000_000).toFixed(1)
          setDownscaleNote(
            `That photo is ${p.from.width}×${p.from.height} (${mp(p.from)} MP). ` +
              `It was resized to ${p.to.width}×${p.to.height} to stay inside the ` +
              `browser's canvas limits — anything larger runs out of memory rather ` +
              `than running slowly.`
          )
        }
      }),
    []
  )
  const modelLabel = React.useMemo(() => {
    try {
      return getModel(getActiveModelId()).label
    } catch {
      return "the full model"
    }
  }, [])

  const processImageFileRef = React.useRef<(f: File) => void>(() => {})

  // The live controls, readable from inside a long-running async run without
  // making that run depend on them. `processImageFile` is called from event
  // handlers registered once, so a closed-over `controls` there would be
  // whatever it was when the handler was created.
  const controlsRef = React.useRef(controls)
  controlsRef.current = controls

  // The file currently loaded, for the re-cut below. Same reasoning as
  // controlsRef: the listener is registered once.
  const currentFileRef = React.useRef<File | null>(null)
  currentFileRef.current = currentFile

  /**
   * A recipe arriving in the address bar.
   *
   * Read once, applied, and then cleared out of the URL — a link that stays in
   * the bar after it has been consumed will be re-applied on every reload,
   * quietly undoing whatever the person changed since. Clearing it makes the
   * link a delivery rather than a setting.
   */
  React.useEffect(() => {
    const incoming = fromShareLink(window.location.href)
    if (!incoming) return
    setControls((prev) => ({ ...prev, ...controlsFromRecipe(incoming) }))
    if (incoming.model) setActiveModel(incoming.model)
    clearShareLink()
  }, [setControls])

  /**
   * Re-run the matte on the image already loaded.
   *
   * The material changes how the edge is FOUND, which happens inside the worker
   * during matting — so unlike the background or the export format it cannot be
   * applied to a finished cutout. The panel says so and offers this.
   */
  React.useEffect(() => {
    const recut = () => {
      const file = currentFileRef.current
      if (file) void processImageFileRef.current(file)
    }
    window.addEventListener("recut", recut)
    return () => window.removeEventListener("recut", recut)
  }, [])

  const processImageFile = async (file: File) => {
    setCurrentFile(file)
    setPendingSource(file)
    setErrorMsg("")
    setDownscaleNote(null)
    setIsProcessing(true)
    setStatusType("loading")
    setStatusText("processing...")
    updateAgentStatus("processing...")

    try {
      const startTime = performance.now()

      const { cutoutCanvas: cut, originalCanvas: orig, width, height, duration, alpha } =
        await removeBackgroundProgressive(file, {
          /**
           * A rough matte, seconds before the real one. On this machine that is
           * ~166 ms against ~1.98 s, and on a first visit the gap is far wider:
           * the preview model is 6 MiB where BiRefNet is 109 MiB plus an eight
           * second GPU compile.
           *
           * Deliberately the same state path as the final result, so the
           * preview is a working cutout — pannable, zoomable, exportable — not
           * a placeholder image.
           */
          onPreview: ({ cutoutCanvas, originalCanvas, width: w, height: h, alpha: a }) => {
            setPendingSource(null)
            baseAlphaRef.current = a
            editMaskRef.current = createEditMask(w, h)
            forgetEncodedImage()
            forgetDinoImage()
            setPending(null)
            setPendingLayers(null)
            setSelectPoints([])
            undoRef.current = []
            setEditCount(0)

            setCutoutCanvas(cutoutCanvas)
            setOriginalCanvas(originalCanvas)
            setIsRefining(true)
            setStatusType("loading")
            setStatusText(`${w}×${h} · preview, refining...`)
            updateAgentStatus(`${w}×${h} · preview, refining...`)
          },
          // What is being cut out. Applied to the final pass only — the
          // preview's job is to be on screen in 150 ms.
          edge: controlsRef.current.edge,
        })
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)

      // Base for manual refinement. The model's alpha stays immutable; user
      // strokes live in a separate edit mask.
      baseAlphaRef.current = alpha
      // Someone can start brushing on the preview before the real matte lands.
      // Throwing their strokes away because a better base arrived would be the
      // worst possible reward for being quick, so an edited mask survives the
      // swap — it is indexed the same way and both models report the source
      // image's own dimensions.
      const existingMask = editMaskRef.current
      const carriedEdits =
        !!existingMask && existingMask.length === width * height && hasEdits(existingMask)
      if (!carriedEdits) {
        editMaskRef.current = createEditMask(width, height)
        // The encoded embeddings belong to the previous image.
        forgetEncodedImage()
        forgetDinoImage()
        setPending(null)
        setPendingLayers(null)
        setSelectPoints([])
        undoRef.current = []
        setEditCount(0)
      }

      setPendingSource(null)
      setIsRefining(false)
      setCutoutCanvas(cut)
      setOriginalCanvas(orig)

      const statusString = `${width}×${height} · ${elapsed}s`
      recordRun({
        action: "Background removal",
        model: modelLabel,
        where: detectBackend() === "webgpu" ? "device-gpu" : "device-cpu",
        ms: performance.now() - startTime,
        cost: 0,
        detail: `${width}×${height}`,
      })
      setStatusType("done")
      setStatusText(statusString)
      updateAgentStatus(statusString)

      saveToHistory({
        id: String(Date.now()),
        name: file.name.replace(/\.[^/.]+$/, ""),
        timestamp: Date.now(),
        dataUrl: cut.toDataURL("image/png"),
        width,
        height,
        duration: `${elapsed}s`,
        // What produced it, so the entry is something you can go back to
        // rather than a flat picture.
        recipe: toJSON(
          recipeFromControls(
            controlsRef.current,
            getActiveModelId(),
            file.name.replace(/\.[^/.]+$/, "")
          )
        ),
      }).catch(console.error)
    } catch (err: any) {
      setIsRefining(false)
      console.error("Removal error:", err)
      setErrorMsg(err.message || "Background removal failed")
      setStatusType("error")
      setStatusText(`failed: ${err.message}`)
      updateAgentStatus(`failed: ${err.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  // Depth is cached against the loaded image, not recomputed per slider tick:
  // estimating costs a few hundred milliseconds, while the layered composite
  // that consumes it is cheap enough to redo on every drag.
  const [depthMap, setDepthMap] = React.useState<DepthMap | null>(null)
  const [depthFocal, setDepthFocal] = React.useState(1)
  // The Depth view and the depth PNG export also need the map, not just blur.
  const [wantDepth, setWantDepth] = React.useState(false)
  const depthMapRef = React.useRef<DepthMap | null>(null)
  depthMapRef.current = depthMap
  const depthCanvas = React.useMemo(() => (depthMap ? depthToCanvas(depthMap, "turbo") : null), [depthMap])

  React.useEffect(() => {
    setDepthMap(null)
  }, [originalCanvas])

  React.useEffect(() => {
    const blurNeeds = controls.depthBokeh && controls.mode === "blur"
    if (!blurNeeds && !wantDepth && !controls.depthSlice.enabled) return
    if (!originalCanvas || depthMap) return

    let stale = false
    void estimateDepth(originalCanvas)
      .then((map) => {
        if (!stale) setDepthMap(map)
      })
      // Reported through the status listener the sidebar already renders; the
      // compositor falls back to a flat blur on its own.
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [controls.depthBokeh, controls.mode, originalCanvas, depthMap, wantDepth, controls.depthSlice.enabled])

  // The focal plane is the subject's own distance, so it has to be re-read when
  // a brush edit changes which pixels count as the subject.
  React.useEffect(() => {
    if (!depthMap || !cutoutCanvas) return
    const ctx = cutoutCanvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return
    const { width, height } = cutoutCanvas
    const alpha = ctx.getImageData(0, 0, width, height).data
    setDepthFocal(focalDepth(depthMap, alpha, width, height))
  }, [depthMap, cutoutCanvas, editCount])

  // Export tab asks for the depth map as a PNG; read it first if needed.
  React.useEffect(() => {
    const onExport = () => {
      if (depthMap) {
        downloadDepthPng(depthMap, currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : "image")
      } else {
        setWantDepth(true)
        pendingDepthExport.current = true
      }
    }
    window.addEventListener("export-depth", onExport)
    return () => window.removeEventListener("export-depth", onExport)
  }, [depthMap, currentFile])
  const pendingDepthExport = React.useRef(false)
  React.useEffect(() => {
    if (depthMap && pendingDepthExport.current) {
      pendingDepthExport.current = false
      downloadDepthPng(depthMap, currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : "image")
    }
  }, [depthMap, currentFile])

  processImageFileRef.current = processImageFile

  /**
   * Photos arriving from outside the browser: the Android share sheet, and
   * "Open with" on desktop. Both are handled the same way once the file is in
   * hand — the point of supporting them is that a shared photo reaches the
   * editor without ever leaving the device.
   */
  React.useEffect(() => {
    let cancelled = false
    void takeSharedImage().then((file) => {
      if (cancelled || !file) return
      // Drop the marker so a reload does not look like a fresh share.
      window.history.replaceState({}, "", window.location.pathname)
      processImageFileRef.current(file)
    })
    const detach = onLaunchWithFiles((file) => processImageFileRef.current(file))
    return () => {
      cancelled = true
      detach()
    }
  }, [])

  React.useEffect(() => {
    if (!pendingSource) return
    const canvas = targetCanvasRef.current
    if (!canvas) return

    let cancelled = false
    void (async () => {
      try {
        const bitmap = await createImageBitmap(pendingSource)
        if (cancelled) {
          bitmap.close()
          return
        }
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext("2d")
        ctx?.drawImage(bitmap, 0, 0)
        bitmap.close()
      } catch {
        // An undecodable file will fail again in the worker with a real error;
        // there is nothing useful to show here.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pendingSource])

  // A generated/uploaded backdrop is drawn from an <img> that loads
  // asynchronously; compositing happens on controls change, which is before
  // the image arrives. Recomposite once it has actually loaded, or the
  // canvas keeps the checkerboard while the UI claims a backdrop is on.
  const [backdropLoaded, setBackdropLoaded] = React.useState(0)
  React.useEffect(() => {
    if (controls.mode !== "image" || !controls.backdropImage) return
    const img = new Image()
    img.src = controls.backdropImage
    if (img.complete && img.naturalWidth > 0) {
      setBackdropLoaded((n) => n + 1)
      return
    }
    let live = true
    img.onload = () => {
      if (live) setBackdropLoaded((n) => n + 1)
    }
    return () => {
      live = false
    }
  }, [controls.mode, controls.backdropImage])

  const currentBgMode = React.useCallback((): BgMode => {
    if (controls.mode === "color") return { type: "color", color: controls.color }
    if (controls.mode === "gradient") return { type: "gradient", style: controls.gradient }
    if (controls.mode === "blur") {
      return {
        type: "blur",
        amount: controls.blurRadius,
        depth: controls.depthBokeh ? (depthMap ?? undefined) : undefined,
        focal: depthFocal,
      }
    }
    if (controls.mode === "image" && controls.backdropImage) {
      return { type: "image", dataUrl: controls.backdropImage }
    }
    return { type: "transparent" }
  }, [
    controls.mode,
    controls.color,
    controls.gradient,
    controls.blurRadius,
    controls.depthBokeh,
    controls.backdropImage,
    depthMap,
    depthFocal,
  ])

  React.useEffect(() => {
    if (!cutoutCanvas || !targetCanvasRef.current) return

    const bgParam = currentBgMode()

    // A new matte is arriving. Copy what is currently on screen into the reveal
    // layer first, so it can fade out over the new composite.
    //
    // Guarded on identity rather than firing whenever this effect runs: it also
    // runs on every background change and every slider tick, and cross-fading a
    // blur radius would turn a direct manipulation into a laggy one.
    const isNewCutout = revealedForRef.current !== cutoutCanvas
    const ghost = ghostCanvasRef.current
    const target = targetCanvasRef.current
    if (isNewCutout && ghost && target && target.width > 0) {
      ghost.width = target.width
      ghost.height = target.height
      const gctx = ghost.getContext("2d")
      if (gctx) {
        gctx.clearRect(0, 0, ghost.width, ghost.height)
        gctx.drawImage(target, 0, 0)
        ghost.style.transition = "none"
        ghost.style.opacity = "1"
      }
    }

    compositeToCanvas({
      targetCanvas: targetCanvasRef.current,
      cutoutCanvas,
      originalCanvas: originalCanvas || undefined,
      bgMode: controls.backdropVisible ? bgParam : { type: "transparent" },
      effects: controls.effects,
      finish: {
        adjust: controls.adjust,
        flip: controls.flipSubject,
        caption: controls.captionVisible
          ? { text: controls.captionText, position: controls.captionPosition }
          : { text: "", position: controls.captionPosition },
        badge: controls.badgeVisible ? controls.badgeText : "",
        hideSubject: !controls.subjectVisible,
        subjectOpacity: controls.subjectOpacity,
        filter: buildSubjectFilter(controls.filterPreset, controls.adjust),
        relight: controls.relight,
      },
    })

    // Subject-centred crop, applied to the output canvas only. Brush
    // coordinates are in uncropped image space, so the crop lives here at
    // composite level rather than in the cutout itself.
    if (controls.cropAspect !== "none" && cutoutCanvas) {
      const target = targetCanvasRef.current
      const spec = CROP_ASPECTS.find((a) => a.id === controls.cropAspect)
      if (target && spec?.ratio) {
        const cctx = cutoutCanvas.getContext("2d", { willReadFrequently: true })
        if (cctx) {
          const px = cctx.getImageData(0, 0, cutoutCanvas.width, cutoutCanvas.height).data
          const alpha = new Uint8Array(cutoutCanvas.width * cutoutCanvas.height)
          for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = px[j]
          const bounds = alphaBounds(alpha, cutoutCanvas.width, cutoutCanvas.height)
          const rect = cropRect(target.width, target.height, spec.ratio, bounds)
          if (rect.w > 0 && rect.h > 0 && (rect.w !== target.width || rect.h !== target.height)) {
            const tmp = document.createElement("canvas")
            tmp.width = rect.w
            tmp.height = rect.h
            tmp.getContext("2d")!.drawImage(target, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h)
            target.width = rect.w
            target.height = rect.h
            const tctx = target.getContext("2d")!
            tctx.drawImage(tmp, 0, 0)
            // The caption was painted at the full frame's edge, which the
            // crop may have removed. Re-apply it on the cropped frame.
            if (controls.captionText.trim()) {
              drawCaption(tctx, rect.w, rect.h, controls.captionText.trim(), controls.captionPosition)
            }
          }
        }
      }
    }

    if (isNewCutout) {
      revealedForRef.current = cutoutCanvas
      if (ghost) {
        // Two frames, so the browser paints opacity 1 before the transition is
        // attached — set them in the same frame and there is nothing to animate
        // from and the layer simply disappears.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            ghost.style.transition = reveal.css
            ghost.style.opacity = "0"
          })
        })
      }
    }

    const fileName = currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : "image"
    setupDownloadButton(
      targetCanvasRef.current,
      `${fileName}-no-bg.${extensionFor(controls.exportFormat)}`
    )

    // Real encoded sizes for every format, not an estimate — so the export
    // panel can show the actual trade rather than one number in isolation.
    const canvas = targetCanvasRef.current
    let stale = false
    void (async () => {
      const sizes = await measureAllFormats(canvas, controls.exportQuality)
      if (stale) return
      setFormatSizes(sizes)
      setEstimatedSize(
        sizes.find((s) => s.format === controls.exportFormat)?.bytes ?? null
      )
    })()
    return () => {
      stale = true
    }
    // editCount is a dependency so a finished brush stroke re-encodes the size
    // readouts. Stroke *samples* deliberately do not land here — measuring three
    // formats per pointer move would stall the brush.
  }, [
    cutoutCanvas,
    originalCanvas,
    controls,
    currentFile,
    editCount,
    currentBgMode,
    backdropLoaded,
    setEstimatedSize,
    setFormatSizes,
  ])


  // ─── Brush handlers ───
  // Coordinates arrive already in image pixels: SplitSlider maps them through
  // getBoundingClientRect(), which absorbs the viewer's zoom/pan transform.

  const rebuildCutout = React.useCallback(() => {
    const source = originalCanvas
    const base = baseAlphaRef.current
    if (!source || !base || !cutoutCanvas) return

    // Healing replaces alpha where painted; everything else reads base.
    let effectiveBase = base
    if (healMaskRef.current && healAlphaRef.current) {
      effectiveBase = new Uint8Array(base)
      const mask = healMaskRef.current
      const values = healAlphaRef.current
      const edit = editMaskRef.current
      for (let i = 0; i < effectiveBase.length; i++) {
        if (!mask[i]) continue
        // User edits still win over healing.
        if (edit && edit[i] !== 0) continue
        effectiveBase[i] = values[i]
      }
    }

    // Depth slice trims the base matte by distance; brush edits still win.
    const slice = controlsRef.current.depthSlice
    const depthForSlice = depthMapRef.current
    if (depthForSlice && !isNoopSlice(slice)) {
      const matte = depthSliceMatte(depthForSlice, slice, source.width, source.height)
      if (matte.length === effectiveBase.length) {
        const trimmed = new Uint8Array(effectiveBase.length)
        for (let i = 0; i < trimmed.length; i++) trimmed[i] = (effectiveBase[i] * matte[i] + 127) / 255
        effectiveBase = trimmed
      }
    }

    composeCutout(cutoutCanvas, source, effectiveBase, editMaskRef.current)

    // Clone stamp layer, over the composed subject.
    if (cloneCanvasRef.current) {
      const ctx = cutoutCanvas.getContext("2d")
      ctx?.drawImage(cloneCanvasRef.current, 0, 0)
    }

    // #cv shows the composite, not the cutout, and cutoutCanvas is mutated in
    // place — so nothing re-renders unless the composite is redone here.
    if (targetCanvasRef.current) {
      compositeToCanvas({
        targetCanvas: targetCanvasRef.current,
        cutoutCanvas,
        originalCanvas: source,
        bgMode: currentBgMode(),
        finish: {
          adjust: controlsRef.current.adjust,
          flip: controlsRef.current.flipSubject,
          caption: {
            text: controlsRef.current.captionVisible ? controlsRef.current.captionText : "",
            position: controlsRef.current.captionPosition,
          },
          badge: controlsRef.current.badgeVisible ? controlsRef.current.badgeText : "",
          hideSubject: !controlsRef.current.subjectVisible,
          subjectOpacity: controlsRef.current.subjectOpacity,
          filter: buildSubjectFilter(controlsRef.current.filterPreset, controlsRef.current.adjust),
          relight: controlsRef.current.relight,
        },
      })
    }
  }, [originalCanvas, cutoutCanvas, currentBgMode])

  // Slice settings or a fresh depth map: redo the composite (debounced for the slider).
  React.useEffect(() => {
    if (!cutoutCanvas) return
    const t = window.setTimeout(() => rebuildCutout(), 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controls.depthSlice, depthMap])

  // "Fit to subject": window around the subject's own distance, read from the
  // untrimmed matte so a slice already applied cannot skew it.
  React.useEffect(() => {
    const onFit = () => {
      const map = depthMapRef.current
      const base = baseAlphaRef.current
      if (!map || !base || !originalCanvas) return
      const focal = focalDepth(map, base, originalCanvas.width, originalCanvas.height, 1, 0)
      setControls((c) => ({ ...c, depthSlice: { ...c.depthSlice, ...sliceAroundSubject(focal), enabled: true } }))
    }
    window.addEventListener("depth-slice-fit", onFit)
    return () => window.removeEventListener("depth-slice-fit", onFit)
  }, [originalCanvas, setControls])

  const handleStrokeStart = React.useCallback(
    (x: number, y: number) => {
      lastPointRef.current = { x, y }
      strokePatchesRef.current = []

      const tool = controlsRef.current.tool
      const source = originalCanvas
      if (tool === "clone" && source) {
        if (!cloneSourceRef.current) {
          cloneSourceRef.current = { x, y }
          setSelectStatus("clone source set — Alt-click to move it, drag to stamp")
        }
        cloneOffsetRef.current = {
          x: cloneSourceRef.current.x - x,
          y: cloneSourceRef.current.y - y,
        }
        if (
          !cloneCanvasRef.current ||
          cloneCanvasRef.current.width !== source.width ||
          cloneCanvasRef.current.height !== source.height
        ) {
          const c = document.createElement("canvas")
          c.width = source.width
          c.height = source.height
          cloneCanvasRef.current = c
        }
      }
      if (tool === "heal" && source) {
        healStrokeRef.current = new Uint8Array(source.width * source.height)
      }
    },
    [originalCanvas]
  )

  const handleStrokeMove = React.useCallback(
    (x: number, y: number) => {
      const editMask = editMaskRef.current
      const source = originalCanvas
      if (!editMask || !source) return

      const from = lastPointRef.current ?? { x, y }
      const to = { x, y }
      const { width: w, height: h } = source
      const tool = controlsRef.current.tool
      const radius = controlsRef.current.brushSize

      if (tool === "heal") {
        if (healStrokeRef.current) {
          paintStroke(healStrokeRef.current, w, h, from, to, {
            mode: "restore",
            radius,
            softness: 0,
          })
        }
        lastPointRef.current = to
        return
      }

      if (tool === "clone") {
        const cloneCanvas = cloneCanvasRef.current
        if (cloneCanvas) {
          const ctx = cloneCanvas.getContext("2d")!
          const srcX = to.x + cloneOffsetRef.current.x
          const srcY = to.y + cloneOffsetRef.current.y
          ctx.save()
          ctx.beginPath()
          ctx.arc(to.x, to.y, radius, 0, Math.PI * 2)
          ctx.clip()
          ctx.drawImage(source, to.x - srcX, to.y - srcY)
          ctx.restore()
        }
        lastPointRef.current = to
        rebuildCutout()
        return
      }

      // Capture before mutating, or the undo entry records the result rather
      // than the previous state.
      const rect = strokeBounds(w, h, from, to, controls.brushSize)
      if (rect) strokePatchesRef.current.push(capturePatch(editMask, w, rect))

      paintStroke(editMask, w, h, from, to, {
        mode: controls.refineMode,
        radius: controls.brushSize,
        softness: 0,
      })
      lastPointRef.current = to

      // Repaint live so the stroke is visible while it is drawn.
      rebuildCutout()
    },
    [controls.refineMode, controls.brushSize, originalCanvas, rebuildCutout]
  )

  const handleStrokeEnd = React.useCallback(() => {
    lastPointRef.current = null

    // Healing resolves at stroke end: each painted pixel takes the local
    // average alpha, which erases spots and stray hairs in the matte.
    if (controlsRef.current.tool === "heal" && healStrokeRef.current && originalCanvas) {
      const source = originalCanvas
      const { width: w, height: h } = source
      if (!healMaskRef.current) {
        healMaskRef.current = new Uint8Array(w * h)
        healAlphaRef.current = new Uint8Array(w * h)
      }
      const base = baseAlphaRef.current
      const edit = editMaskRef.current
      const stroke = healStrokeRef.current
      if (base && edit) {
        const radius = 6
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = y * w + x
            if (!stroke[i]) continue
            let sum = 0
            let n = 0
            for (let dy = -radius; dy <= radius; dy += 2) {
              for (let dx = -radius; dx <= radius; dx += 2) {
                const sx = x + dx
                const sy = y + dy
                if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
                const si = sy * w + sx
                sum += edit[si] === 1 ? 0 : edit[si] === 2 ? 255 : base[si]
                n++
              }
            }
            healMaskRef.current[i] = 1
            healAlphaRef.current![i] = n ? Math.round(sum / n) : base[i]
          }
        }
      }
      healStrokeRef.current = null
      rebuildCutout()
      setEditCount((n) => n + 1)
      return
    }

    if (controlsRef.current.tool === "clone") {
      setEditCount((n) => n + 1)
      return
    }

    const patches = strokePatchesRef.current
    strokePatchesRef.current = []
    if (!patches.length) return

    // One undo entry per drag, however many samples it contained.
    clearRedo()
    undoRef.current.push(patches)
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
    setEditCount((n) => n + 1)
  }, [originalCanvas, rebuildCutout])

  // ─── Shape selections (marquee / lasso / pen) ───
  // Their masks land in the same proposal flow as SAM's: tint, then Apply.
  const proposeMask = React.useCallback(
    (mask: Uint8Array, width: number, height: number) => {
      setPendingLayers(null)
      setSelectPoints([])
      setPending({ mask, width, height, score: 1 })
    },
    []
  )

  const handleMarquee = React.useCallback(
    (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const source = originalCanvas
      if (!source) return
      setControls((c) => ({ ...c, refineActive: true }))
      proposeMask(rectMask(source.width, source.height, a, b), source.width, source.height)
    },
    [originalCanvas, proposeMask, setControls]
  )

  const handleLasso = React.useCallback(
    (points: Array<{ x: number; y: number }>) => {
      const source = originalCanvas
      if (!source) return
      setControls((c) => ({ ...c, refineActive: true }))
      proposeMask(polygonMask(source.width, source.height, points), source.width, source.height)
    },
    [originalCanvas, proposeMask, setControls]
  )

  const handlePenClick = React.useCallback((x: number, y: number) => {
    setPenPoints((prev) => [...prev, { x, y }])
  }, [])

  const handlePenFinish = React.useCallback(() => {
    const source = originalCanvas
    if (!source) return
    setPenPoints((prev) => {
      if (prev.length >= 3) {
        setControls((c) => ({ ...c, refineActive: true }))
        proposeMask(polygonMask(source.width, source.height, prev), source.width, source.height)
      }
      return []
    })
  }, [originalCanvas, proposeMask, setControls])

  // Enter closes the pen polygon, Escape abandons it.
  React.useEffect(() => {
    if (controls.tool !== "pen" || penPoints.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") handlePenFinish()
      else if (e.key === "Escape") setPenPoints([])
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [controls.tool, penPoints, handlePenFinish])

  React.useEffect(() => addSamStatusListener(setSamStatus), [])

  // Mirror it into the studio context so the sidebar can show it.
  React.useEffect(() => {
    const text =
      samStatus.kind === "loading"
        ? `downloading ${samStatus.percent}%`
        : samStatus.kind === "encoding"
          ? "analysing image"
          : samStatus.kind === "error"
            ? samStatus.message
            : samBusy
              ? "selecting"
              : samStatus.kind === "ready"
                ? "ready"
                : null
    setSelectStatus(text)
  }, [samStatus, samBusy, setSelectStatus])

  // Download the selection model as soon as the mode is switched on, so the
  // first click is not also the first download.
  React.useEffect(() => {
    if (controls.tool !== "move") warmSam()
  }, [controls.tool])

  /**
   * One click selects a whole object.
   *
   * The result is written into the same edit mask the brush uses, so it is
   * undoable and can be painted over — a click gets the region roughly right
   * and the brush cleans up, rather than the two being separate systems.
   */
  const [dinoStatus, setDinoStatus] = React.useState<DinoStatus>({ kind: "idle" })
  React.useEffect(() => addDinoStatusListener(setDinoStatus), [])

  React.useEffect(() => {
    if (dinoStatus.kind === "error") setSelectStatus(`similar: ${dinoStatus.message}`)
    else if (dinoStatus.kind === "loading")
      setSelectStatus(`similar model ${dinoStatus.percent}%`)
    else if (dinoStatus.kind === "encoding") setSelectStatus("analysing similarity")
  }, [dinoStatus, setSelectStatus])

  // Warm DINOv2 when the Similar tool is chosen, so the first shift-click is
  // not also a 12 MiB download.
  React.useEffect(() => {
    if (controls.tool === "similar" || controls.selectTool === "similar") warmDino()
  }, [controls.tool, controls.selectTool])

  /**
   * Propose a selection from seed points: SlimSAM per seed, unioned, with
   * each seed's mask kept as a coloured layer. Shared by DINOv2 similarity
   * and Grounding DINO offline text detection — both only ever propose
   * seeds; this is where masks actually come from.
   */
  const proposeFromSeeds = React.useCallback(
    async (seeds: Array<{ x: number; y: number }>) => {
      const source = originalCanvas
      if (!source) throw new Error("Load an image first.")
      await encodeImage(source)
      let union: Uint8Array | null = null
      let w = source.width
      let h = source.height
      let score = 0
      const layers: Array<{ mask: Uint8Array; width: number; height: number; color: string }> = []
      for (const [i, seed] of seeds.slice(0, 4).entries()) {
        const sel = await selectAt([{ x: seed.x, y: seed.y, label: 1 }])
        if (!union) {
          union = new Uint8Array(sel.mask.length)
          w = sel.width
          h = sel.height
        }
        if (sel.width === w && sel.height === h) {
          for (let p = 0; p < union.length; p++) {
            if (sel.mask[p]) union[p] = 255
          }
          score = Math.max(score, sel.score)
          layers.push({
            mask: sel.mask,
            width: sel.width,
            height: sel.height,
            color: LAYER_COLORS[i % LAYER_COLORS.length],
          })
        }
      }
      if (!union) throw new Error("Nothing to select from those seeds")
      setSelectPoints(seeds.map((s) => ({ x: s.x, y: s.y, label: 1 as const })))
      setPendingLayers(layers.length > 1 ? layers : null)
      setPending({ mask: union, width: w, height: h, score })
    },
    [originalCanvas]
  )

  /**
   * "Everything like this": DINOv2 proposes, SlimSAM disposes.
   *
   * DINOv2's 16x16 patch grid cannot be a matte, so its clusters become seed
   * points and each seed runs the same prompt decoder a normal click uses.
   * The union is proposed through the same Apply/Discard flow.
   */
  const handleSelectSimilar = React.useCallback(
    async (x: number, y: number) => {
      const source = originalCanvas
      if (!source || samBusy) return
      setSamBusy(true)
      try {
        const simT0 = performance.now()
        await encodeDinoImage(source)
        const similar = await similarAt(x, y, controlsRef.current.similarThreshold)
        recordRun({
          action: "Select similar (shift-click)",
          model: "DINOv2 + SlimSAM",
          where: detectBackend() === "webgpu" ? "device-gpu" : "device-cpu",
          ms: performance.now() - simT0,
          cost: 0,
          detail: `${similar.seeds.length} cluster(s)`,
        })
        const seeds = similar.seeds.length
          ? similar.seeds
          : [{ x, y, area: 1 }]
        await proposeFromSeeds(seeds)
      } catch (err: any) {
        setSelectStatus(err?.message || "Similarity selection failed")
      } finally {
        setSamBusy(false)
      }
    },
    [originalCanvas, samBusy, proposeFromSeeds]
  )

  /** Offline text select: Grounding DINO boxes -> centres -> SlimSAM masks. */
  const handleOfflineTextSelect = React.useCallback(
    async (prompt: string) => {
      const source = originalCanvas
      if (!source) throw new Error("Load an image first.")
      const { boxes } = await detectObjects(source, prompt)
      if (boxes.length === 0) return { count: 0 }
      setControls((c) => ({ ...c, refineActive: true }))
      await proposeFromSeeds(boxes.map(boxCentre))
      return { count: boxes.length }
    },
    [originalCanvas, proposeFromSeeds, setControls]
  )

  React.useEffect(() => {
    setOnOfflineTextSelect(handleOfflineTextSelect)
  }, [setOnOfflineTextSelect, handleOfflineTextSelect])

  const handleSelectAt = React.useCallback(
    async (x: number, y: number, exclude = false, similar = false) => {
      if (
        similar ||
        controlsRef.current.tool === "similar" ||
        (controlsRef.current.tool === "select" && controlsRef.current.selectTool === "similar")
      ) {
        if (!exclude) return handleSelectSimilar(x, y)
      }
      const editMask = editMaskRef.current
      const source = originalCanvas
      if (!editMask || !source || samBusy) return

      const next: SamPoint[] = [
        ...selectPoints,
        { x, y, label: exclude ? 0 : 1 },
      ]
      setSelectPoints(next)

      setSamBusy(true)
      try {
        // Encode lazily: the first click on an image pays for the encoder, the
        // rest only run the prompt decoder.
        await encodeImage(source)

        const selection = await selectAt(next)
        // Propose, do not apply. The overlay shows it and Apply commits it.
        setPendingLayers(null)
        setPending({
          mask: selection.mask,
          width: selection.width,
          height: selection.height,
          score: selection.score,
        })
      } catch (err: any) {
        // Never swallow this silently: an invisible failure here looks exactly
        // like a click that did nothing, which is how a shape bug in the mask
        // tensor went unnoticed.
        setSelectStatus(err?.message || "Selection failed")
      } finally {
        setSamBusy(false)
      }
    },
    [originalCanvas, samBusy, selectPoints, handleSelectSimilar]
  )

  /**
   * SAM 3.1 text selection (BYOK Meta key).
   *
   * The result lands in the same proposal flow as a SlimSAM click — tinted,
   * then Apply commits it into the edit mask — so cloud and local selection
   * are one interaction, not two tools.
   */
  /** Last SAM 3.1 result, so individual objects can be re-proposed as layers. */
  const lastSamRef = React.useRef<Awaited<ReturnType<typeof segmentConcept>> | null>(null)

  const handleTextSelect = React.useCallback(
    async (prompt: string) => {
      const source = originalCanvas
      if (!source) throw new Error("Load an image first.")
      const key = getMetaKey()
      if (!key) throw new Error("Add your Meta API key first.")
      const result = await segmentConcept(source, prompt, key)
      lastSamRef.current = result
      if (result.objects.length === 0) {
        setSamLayers([])
        return { count: 0, objects: [] }
      }
      {
        const totalPx = result.width * result.height || 1
        const layers = result.parts.map((p, i) => {
          let kept = 0
          for (let px = 0; px < p.mask.length; px++) if (p.mask[px]) kept++
          return {
            id: p.object.objectId,
            color: LAYER_COLORS[i % LAYER_COLORS.length],
            coverage: Math.round((kept / totalPx) * 1000) / 10,
            visible: true,
          }
        })
        samLayersRef.current = layers
        setSamLayers(layers)
      }
      setControls((c) => ({ ...c, refineActive: true }))
      setSelectPoints([])
      setPending({
        mask: result.mask,
        width: result.width,
        height: result.height,
        score: result.objects[0]?.confidence ?? 1,
      })
      setPendingLayers(
        result.parts.length > 1
          ? result.parts.map((p, i) => ({
              mask: p.mask,
              width: result.width,
              height: result.height,
              color: LAYER_COLORS[i % LAYER_COLORS.length],
            }))
          : null
      )
      const total = result.width * result.height || 1
      return {
        count: result.objects.length,
        objects: result.parts.map((p) => {
          let kept = 0
          for (let i = 0; i < p.mask.length; i++) if (p.mask[i]) kept++
          return {
            id: p.object.objectId,
            confidence: p.object.confidence,
            coverage: Math.round((kept / total) * 1000) / 10,
          }
        }),
      }
    },
    [originalCanvas, setControls]
  )

  const handleSelectSamObject = React.useCallback((objectId: string) => {
    const result = lastSamRef.current
    if (!result) return
    const idx = result.parts.findIndex((p) => p.object.objectId === objectId)
    if (idx < 0) return
    const part = result.parts[idx]
    setControls((c) => ({ ...c, refineActive: true }))
    setSelectPoints([])
    setPending({
      mask: part.mask,
      width: result.width,
      height: result.height,
      score: part.object.confidence ?? 1,
    })
    setPendingLayers([
      {
        mask: part.mask,
        width: result.width,
        height: result.height,
        color: LAYER_COLORS[idx % LAYER_COLORS.length],
      },
    ])
  }, [setControls])

  React.useEffect(() => {
    setOnSelectSamObject(handleSelectSamObject)
  }, [setOnSelectSamObject, handleSelectSamObject])

  // Toggling a SAM layer re-proposes the union of the visible objects.
  const samLayersRef = React.useRef<
    Array<{ id: string; color: string; coverage: number; visible: boolean }>
  >([])
  const handleToggleSamLayer = React.useCallback(
    (objectId: string) => {
      const result = lastSamRef.current
      if (!result) return
      const next = samLayersRef.current.map((l) =>
        l.id === objectId ? { ...l, visible: !l.visible } : l
      )
      samLayersRef.current = next
      setSamLayers(next)

      const visibleParts = result.parts.filter(
        (p) => next.find((l) => l.id === p.object.objectId)?.visible
      )
      if (visibleParts.length === 0) {
        setPending(null)
        setPendingLayers(null)
        return
      }
      const union = new Uint8Array(result.width * result.height)
      for (const part of visibleParts) {
        for (let i = 0; i < union.length; i++) if (part.mask[i]) union[i] = 255
      }
      setControls((c) => ({ ...c, refineActive: true, tool: "select" }))
      setPending({
        mask: union,
        width: result.width,
        height: result.height,
        score: visibleParts[0].object.confidence ?? 1,
      })
      setPendingLayers(
        visibleParts.map((p) => ({
          mask: p.mask,
          width: result.width,
          height: result.height,
          color: next.find((l) => l.id === p.object.objectId)?.color ?? "#34d399",
        }))
      )
    },
    [setControls, setSamLayers]
  )

  React.useEffect(() => {
    setOnToggleSamLayer(handleToggleSamLayer)
  }, [setOnToggleSamLayer, handleToggleSamLayer])

  React.useEffect(() => {
    setOnTextSelect(handleTextSelect)
  }, [setOnTextSelect, handleTextSelect])

  /**
   * Execute a Muse agent plan with local tools, then verify it.
   *
   * SAM's coarse mask gates the local matte: inside the concept we keep
   * BiRefNet's hair-level alpha, outside it we keep nothing (keep) or
   * everything (remove). The agent never touches pixels itself.
   */
  const handleAgentPlan = React.useCallback(
    async (plan: AgentPlan): Promise<string[]> => {
      const source = originalCanvas
      const base = baseAlphaRef.current
      if (!source || !base) throw new Error("Load an image first.")
      const steps: string[] = [`Plan: ${plan.summary}`]
      let alpha = base

      if (plan.concept) {
        const key = getMetaKey()
        if (!key) throw new Error("Add your Meta API key first.")
        let result = await segmentConcept(source, plan.concept, key)

        // Self-correction: a weak or empty first attempt is retried once
        // with a bare noun phrase, which is what SAM concept prompts
        // respond to best. The trace says so — a silent retry would hide
        // the model's uncertainty instead of surfacing it.
        const weak =
          result.objects.length === 0 ||
          (result.objects[0]?.confidence ?? 1) < 0.6
        const simpler = simplifyConcept(plan.concept)
        if (weak && simpler !== plan.concept) {
          steps.push(
            `First attempt weak (${result.objects.length} object(s)) — retrying as "${simpler}".`
          )
          const retry = await segmentConcept(source, simpler, key)
          if (retry.objects.length > 0) result = retry
        }

        if (result.objects.length === 0) {
          steps.push(`SAM 3.1 found no "${plan.concept}" — matte unchanged.`)
          return steps
        }
        const conf = result.objects[0]?.confidence
        steps.push(
          `SAM 3.1: ${result.objects.length} object(s) for "${plan.concept}"` +
            (conf !== undefined ? ` · confidence ${conf.toFixed(2)}` : "")
        )

        // Scale SAM's sent-size mask to full resolution, nearest-neighbour,
        // and gate a matte through it. Factored out because the
        // verification step below may re-gate a second model's matte.
        const { width: iw, height: ih } = source
        const gate = (matte: Uint8Array): Uint8Array => {
          const next = new Uint8Array(iw * ih)
          for (let y = 0; y < ih; y++) {
            const sy = Math.min(result.height - 1, ((y * result.height) / ih) | 0)
            const sRow = sy * result.width
            const dRow = y * iw
            for (let x = 0; x < iw; x++) {
              const sx = Math.min(result.width - 1, ((x * result.width) / iw) | 0)
              const inside = result.mask[sRow + sx] > 0
              next[dRow + x] =
                plan.action === "keep"
                  ? inside
                    ? matte[dRow + x]
                    : 0
                  : inside
                    ? 0
                    : matte[dRow + x]
            }
          }
          return next
        }

        alpha = gate(base)
        baseAlphaRef.current = alpha
        editMaskRef.current = createEditMask(iw, ih)
        undoRef.current = []
        setEditCount((n) => n + 1)
        rebuildCutout()
        steps.push(
          plan.action === "keep"
            ? "Local matte gated to the concept (edge detail kept)."
            : "Concept removed from the matte."
        )

        // Verification that acts: a very soft edge usually means the fast
        // matte is unsure everywhere. If a stronger model is not already
        // in use, re-cut with it, re-gate, and keep whichever edge is
        // measurably cleaner. The comparison is reported either way.
        const firstCheck = verifyMask(alpha)
        const file = currentFileRef.current
        if (firstCheck.softEdge > 20 && getActiveModelId() !== "birefnet-lite" && file) {
          steps.push(
            `Soft edge ${firstCheck.softEdge}% is high — re-cutting with BiRefNet Lite to compare…`
          )
          try {
            const recut = await removeBackground(file, "birefnet-lite")
            const alt = gate(recut.alpha)
            const altCheck = verifyMask(alt)
            if (altCheck.softEdge < firstCheck.softEdge) {
              alpha = alt
              baseAlphaRef.current = alt
              rebuildCutout()
              steps.push(
                `BiRefNet edge is cleaner (${altCheck.softEdge}% vs ${firstCheck.softEdge}%) — kept it.`
              )
            } else {
              steps.push(
                `Original edge was cleaner (${firstCheck.softEdge}% vs ${altCheck.softEdge}%) — kept it.`
              )
            }
          } catch {
            steps.push("BiRefNet re-cut failed — keeping the original edge.")
          }
        }
      }

      const bg = plan.background
      if (bg.type === "color") {
        setControls((c) => ({ ...c, mode: "color", color: bg.color }))
        steps.push(`Backdrop set to ${bg.color}.`)
      } else {
        setControls((c) => ({ ...c, mode: "transparent" }))
        steps.push("Backdrop: transparent.")
      }

      const v = verifyMask(alpha)
      steps.push(`Verified: subject covers ${v.coverage}% of frame · soft edge ${v.softEdge}%.`)
      return steps
    },
    [originalCanvas, rebuildCutout, setControls]
  )

  React.useEffect(() => {
    setOnAgentPlan(handleAgentPlan)
  }, [setOnAgentPlan, handleAgentPlan])

  // ─── Command bar ───
  // The agent in the sidebar is powerful but invisible. This bar puts one
  // sentence between the user and the whole Meta stack, right under the
  // canvas toolbar, with examples for people who do not know what to ask.
  const [agentCommand, setAgentCommand] = React.useState("")
  // The prompt lives in the bottom inset; "/" or the Ask agent button focuses it.
  const agentInputRef = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return
      e.preventDefault()
      agentInputRef.current?.focus()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])
  const [agentRunning, setAgentRunning] = React.useState(false)
  const [agentTrace, setAgentTrace] = React.useState<string[]>([])
  const [agentElapsed, setAgentElapsed] = React.useState(0)

  React.useEffect(() => {
    if (!agentRunning) return
    setAgentElapsed(0)
    const t = setInterval(() => setAgentElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [agentRunning])

  const [demoRunning, setDemoRunning] = React.useState(false)

  const runCommandBar = React.useCallback(
    async (spoken?: string) => {
      const text = (spoken ?? agentCommand).trim()
      if (!text || agentRunning) return
      const key = getMetaKey()
      if (!key) {
        setAgentTrace(["Add your Meta API key in Studio Controls → Select by text first. Local tools still work without one."])
        return
      }
      setAgentRunning(true)
      setAgentTrace(["Asking Muse for a plan (it sees a 512px copy to name the subject)…"])
      try {
        // Muse is multimodal: a small copy lets it turn "the main
        // subject" into the concrete noun SAM 3.1 needs ("dog").
        let thumb: string | undefined
        if (originalCanvas) {
          const { canvas } = downscaleCanvas(originalCanvas, 512)
          thumb = canvas.toDataURL("image/jpeg", 0.85)
        }
        const plan = await planCommand(text, key, "muse-spark-1.3", thumb)
        const steps = await handleAgentPlan(plan)
        setAgentTrace(steps)
      } catch (err: any) {
        setAgentTrace([err?.message || "Agent failed."])
      } finally {
        setAgentRunning(false)
      }
    },
    [agentCommand, agentRunning, handleAgentPlan, originalCanvas]
  )

  const runCommandBarRef = React.useRef(runCommandBar)
  runCommandBarRef.current = runCommandBar
  const voice = useVoiceCommand({
    onTranscript: (text) => {
      setAgentCommand(text)
      return runCommandBarRef.current(text)
    },
    onStatus: (message) => setAgentTrace([message]),
  })

  /** One-click demo: sample in, agent runs, verified trace out. */
  const runDemoFlow = React.useCallback(async () => {
    if (demoRunning) return
    if (!getMetaKey()) {
      setAgentTrace(["Add your Meta API key in Studio Controls → Select by text first — the demo needs SAM 3.1 and Muse."])
      return
    }
    setDemoRunning(true)
    try {
      const res = await fetch("/samples/retriever.jpg")
      const blob = await res.blob()
      const file = new File([blob], "golden retriever.jpg", { type: "image/jpeg" })
      await processImageFileRef.current(file)
      await runCommandBarRef.current("keep the dog on white")
    } catch (err: any) {
      setAgentTrace([err?.message || "Demo flow failed."])
    } finally {
      setDemoRunning(false)
    }
  }, [demoRunning])

  /** Commit the proposed selection into the edit mask. */
  const handleApplyPending = React.useCallback(() => {
    const editMask = editMaskRef.current
    const source = originalCanvas
    if (!editMask || !source || !pending) return

    const rect = applySelection(
      editMask,
      source.width,
      source.height,
      pending,
      controls.refineMode
    )
    setPending(null)
    setPendingLayers(null)
    setSelectPoints([])
    if (!rect) return

    clearRedo()
    undoRef.current.push([capturePatch(editMask, source.width, rect)])
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()

    rebuildCutout()
    setEditCount((n) => n + 1)
  }, [originalCanvas, pending, controls.refineMode, rebuildCutout])

  const handleCancelPending = React.useCallback(() => {
    setPending(null)
    setPendingLayers(null)
    setSelectPoints([])
  }, [])

  // Repaint the overlay whenever the edit state, proposal or settings change.
  React.useEffect(() => {
    const canvas = overlayCanvasRef.current
    const source = originalCanvas
    if (!canvas || !source || controls.tool === "move" || controls.tool === "hand") return
    paintOverlay(
      canvas,
      source.width,
      source.height,
      editMaskRef.current,
      pending,
      controls.refineMode,
      controls.overlayStrength,
      controls.tool === "pen"
        ? penPoints.map((p) => ({ ...p, label: 1 as const }))
        : selectPoints,
      pendingLayers ?? undefined
    )

    // Pen: draw the open polygon so the next click has something to aim at.
    if (controls.tool === "pen" && penPoints.length > 1) {
      const ctx = canvas.getContext("2d")
      if (ctx) {
        ctx.beginPath()
        ctx.moveTo(penPoints[0].x, penPoints[0].y)
        for (const p of penPoints.slice(1)) ctx.lineTo(p.x, p.y)
        ctx.strokeStyle = "rgba(255,255,255,0.9)"
        ctx.lineWidth = Math.max(2, source.width / 400)
        ctx.stroke()
      }
    }
  }, [
    originalCanvas,
    pending,
    pendingLayers,
    selectPoints,
    penPoints,
    editCount,
    controls.tool,
    controls.refineMode,
    controls.overlayStrength,
  ])

  // ─── Tool shortcuts ───
  // One letter per tool (shown in the dock labels), [ ] for brush size.
  // Ignored while typing — a prompt box owns its keys.
  React.useEffect(() => {
    const TOOL_KEYS: Record<string, StudioTool> = {
      v: "move",
      h: "hand",
      s: "select",
      d: "similar",
      m: "marquee",
      l: "lasso",
      p: "pen",
      b: "brush",
      j: "heal",
      c: "clone",
      i: "eyedropper",
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tool = TOOL_KEYS[e.key.toLowerCase()]
      if (tool) {
        setControls((c) => ({
          ...c,
          tool,
          refineActive: tool !== "move",
          pickColor: tool === "eyedropper" ? true : c.pickColor,
        }))
        if (tool !== "pen") setPenPoints([])
        return
      }
      // { } (shifted brackets): plain [ ] already toggle the sidebars here.
      if (e.key === "{") {
        setControls((c) => ({ ...c, brushSize: Math.max(2, c.brushSize - 4) }))
      } else if (e.key === "}") {
        setControls((c) => ({ ...c, brushSize: Math.min(200, c.brushSize + 4) }))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setControls])

  // Enter applies the proposal, Escape discards it.
  React.useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault()
        handleApplyPending()
      } else if (e.key === "Escape") {
        e.preventDefault()
        handleCancelPending()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pending, handleApplyPending, handleCancelPending])

  const redoRef = React.useRef<UndoPatch[][]>([])
  const [canRedo, setCanRedo] = React.useState(false)

  const handleUndo = React.useCallback(() => {
    const editMask = editMaskRef.current
    const source = originalCanvas
    const entry = undoRef.current.pop()
    if (!editMask || !source || !entry) return
    // Capture the current (post-edit) state first: that is what redo
    // will re-apply. Same patch rectangles, opposite direction.
    const redoEntry = entry.map((patch) => capturePatch(editMask, source.width, patch))
    redoRef.current.push(redoEntry)
    setCanRedo(true)
    // Reverse order: later patches overwrote earlier ones.
    for (let i = entry.length - 1; i >= 0; i--) {
      applyPatch(editMask, source.width, entry[i])
    }
    rebuildCutout()
    setEditCount((n) => n + 1)
  }, [originalCanvas, rebuildCutout])

  const handleRedo = React.useCallback(() => {
    const editMask = editMaskRef.current
    const source = originalCanvas
    const entry = redoRef.current.pop()
    if (!editMask || !source || !entry) return
    const undoEntry = entry.map((patch) => capturePatch(editMask, source.width, patch))
    undoRef.current.push(undoEntry)
    if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift()
    for (let i = entry.length - 1; i >= 0; i--) {
      applyPatch(editMask, source.width, entry[i])
    }
    setCanRedo(redoRef.current.length > 0)
    rebuildCutout()
    setEditCount((n) => n + 1)
  }, [originalCanvas, rebuildCutout])

  const clearRedo = React.useCallback(() => {
    if (redoRef.current.length > 0) {
      redoRef.current = []
      setCanRedo(false)
    }
  }, [])

  const handleResetEdits = React.useCallback(() => {
    const source = originalCanvas
    if (!source) return
    editMaskRef.current = createEditMask(source.width, source.height)
    undoRef.current = []
    // Clone and heal layers reset with the rest of the edits.
    cloneCanvasRef.current = null
    cloneSourceRef.current = null
    healMaskRef.current = null
    healAlphaRef.current = null
    setPenPoints([])
    rebuildCutout()
    setEditCount((n) => n + 1)
  }, [originalCanvas, rebuildCutout])

  // Undo / redo shortcuts (inputs keep their native text undo).
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== "z") return
      e.preventDefault()
      if (e.shiftKey) handleRedo()
      else handleUndo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handleUndo, handleRedo])

  React.useEffect(() => {
    setOnUndoEdit(handleUndo)
    setOnResetEdits(handleResetEdits)
  }, [setOnUndoEdit, setOnResetEdits, handleUndo, handleResetEdits])

  React.useEffect(() => {
    setCanUndoEdit(undoRef.current.length > 0)
  }, [editCount, setCanUndoEdit])

  React.useEffect(() => {
    setPendingSelection(!!pending)
  }, [pending, setPendingSelection])

  React.useEffect(() => {
    setOnApplyPending(handleApplyPending)
    setOnCancelPending(handleCancelPending)
  }, [setOnApplyPending, setOnCancelPending, handleApplyPending, handleCancelPending])

  /** Smart Resize: the finished composite at every social size, in one ZIP. */
  const handleSocialPack = React.useCallback(async () => {
    const source = targetCanvasRef.current
    if (!source) return
    const { default: JSZip } = await import("jszip")
    const zip = new JSZip()
    const ground =
      controlsRef.current.mode === "color" ? controlsRef.current.color : "#ffffff"
    for (const size of SOCIAL_SIZES) {
      const rendered = renderSocialSize(source, size, ground)
      const blob = await new Promise<Blob | null>((res) =>
        rendered.toBlob(res, "image/jpeg", 0.92)
      )
      if (blob) zip.file(`${size.id}-${size.width}x${size.height}.jpg`, blob)
    }
    const zipBlob = await zip.generateAsync({ type: "blob" })
    const url = URL.createObjectURL(zipBlob)
    const a = document.createElement("a")
    a.href = url
    a.download = "remove-free-social-pack.zip"
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }, [])

  React.useEffect(() => {
    setOnSocialPack(handleSocialPack)
  }, [setOnSocialPack, handleSocialPack])

  /** Image -> video: 3s Ken Burns over the finished composite. */
  const handleAnimate = React.useCallback(async () => {
    const source = targetCanvasRef.current
    if (!source) return
    setAnimateBusy(true)
    try {
      const blob = await animateComposite(source, { seconds: 3 })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "remove-free-animated.webm"
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch {
      // Recorder unsupported: leave the still exports as the path.
    } finally {
      setAnimateBusy(false)
    }
  }, [setAnimateBusy])

  React.useEffect(() => {
    setOnAnimate(handleAnimate)
  }, [setOnAnimate, handleAnimate])

  const handleDownload = async () => {
    const canvas = targetCanvasRef.current || cutoutCanvas
    if (!canvas) return
    const fileName = currentFile ? currentFile.name.replace(/\.[^/.]+$/, "") : "cutout"

    // encode() flattens onto white for JPEG and clamps the WebP quality cliff.
    const blob = await encode(canvas, controls.exportFormat, controls.exportQuality)
    if (!blob) return

    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${fileName}-no-bg.${extensionFor(controls.exportFormat)}`
    a.click()
    // Revoking in the same tick can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    recordRun({
      action: `Export ${controls.exportFormat.toUpperCase()}`,
      model: "Local encoder",
      where: detectBackend() === "webgpu" ? "device-gpu" : "device-cpu",
      cost: 0,
      detail: `${(blob.size / 1024).toFixed(0)} KB`,
    })
  }

  const handleCopy = async () => {
    const canvas = targetCanvasRef.current || cutoutCanvas
    if (!canvas) return
    // Always PNG on the clipboard: it is the only format every OS and app
    // reliably pastes with transparency intact.
    const blob = await encode(canvas, "png", 100)
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } catch {
      // Clipboard permission denied or unsupported; nothing useful to fall back to.
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith("image/")) {
      processImageFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  React.useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const file = items[i].getAsFile()
          if (file) {
            processImageFile(file)
            break
          }
        }
      }
    }

    window.addEventListener("paste", handlePaste)
    return () => window.removeEventListener("paste", handlePaste)
  }, [])

  const handleReset = () => {
    setCurrentFile(null)
    setOriginalCanvas(null)
    setCutoutCanvas(null)
    setStatusType("ready")
    setStatusText("ready")
    updateAgentStatus("ready")
  }

  const aspectRatio =
    originalCanvas && originalCanvas.width && originalCanvas.height
      ? originalCanvas.width / originalCanvas.height
      : 0

  React.useEffect(() => {
    setOnDownload(handleDownload)
  }, [setOnDownload, handleDownload])

  React.useEffect(() => {
    setOnCopy(handleCopy)
  }, [setOnCopy, setEstimatedSize, handleCopy])

  React.useEffect(() => {
    setHasCutout(!!cutoutCanvas)
  }, [setHasCutout, cutoutCanvas])

  return (
    // Definite height, not h-full: the shell's ScrollArea lets content grow,
    // so a percentage height made the studio as tall as the canvas's
    // intrinsic size and the middle panel scrolled. 100svh minus the app
    // header (~52px with the backdrop strip) and the inset margins
    // (16px) is the real budget.
    <div className="flex flex-col h-[calc(100svh-68px)] overflow-hidden select-none">
      {tour.step !== null && (
        <TourOverlay
          step={tour.step}
          rect={tour.rect}
          onStep={tour.setStep}
          onClose={tour.close}
        />
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) processImageFile(f)
        }}
      />

      {/* ─── Model Download / Inference Progress ─── */}
      {modelLoad.phase !== "idle" && (
        <div className="px-4 py-2 bg-surface-2 shrink-0 flex items-center justify-between text-xs text-foreground font-medium shadow-surface-1">
          <ThinkingIndicator words={[modelLoad.message]} size="compact" />
          <span className="font-mono text-[11px] text-muted-foreground">
            {modelLoad.phase === "compiling" ? `${modelLoad.elapsed}s` : `${modelLoad.percent}%`}
          </span>
        </div>
      )}

      {/* ─── Oversized-input Notice ─── */}
      {downscaleNote && (
        <div className="p-3 bg-surface-2 text-muted-foreground text-xs flex items-start gap-2 shrink-0 shadow-surface-1">
          <Info className="size-4 shrink-0 mt-px" />
          <span className="flex-1">{downscaleNote}</span>
          <button
            type="button"
            onClick={() => setDownscaleNote(null)}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-hover hover:text-foreground transition-colors duration-80"
            aria-label="Dismiss notice"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ─── Error Alert ─── */}
      {errorMsg && (
        <div className="p-3 bg-destructive/10 text-destructive text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="size-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ─── Main Inset Canvas Area ─── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
        {!originalCanvas && !isProcessing ? (
          /* Empty State: Modern Fluid Functionalism Dropzone */
          /* The first thing anyone sees, so it assembles rather than appears.
             A 40ms stagger down the three blocks — headline, dropzone, samples
             — is enough to give the page an order to read it in without anyone
             consciously noticing a delay. `once` so it does not replay every
             time you clear an image. */
          <motion.div
            initial="hidden"
            animate="shown"
            variants={{
              hidden: {},
              shown: { transition: { staggerChildren: 0.04, delayChildren: 0.02 } },
            }}
            className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col items-center justify-center max-w-4xl mx-auto w-full space-y-6"
          >
            <motion.div variants={RISE} className="text-center space-y-1.5">
              <Badge variant="secondary" dot={true} className="mb-2 text-[11px]">
                100% Private On-Device AI · Zero Cloud Retries
              </Badge>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Studio-grade background removal. Instant & Free.
              </h1>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed">
                Ultra-high precision neural matting running completely inside your browser. Zero server uploads, zero subscriptions, unlimited exports.
              </p>
              <div data-tour="start" className="flex items-center justify-center gap-2 mt-3">
                <Button
                  size="compact"
                  variant="primary"
                  disabled={demoRunning}
                  onClick={() => void runDemoFlow()}
                  className="gap-1.5"
                >
                  <Sparkles className="size-3.5" />
                  {demoRunning ? "Running the demo…" : "Run the 60-second demo"}
                </Button>
                <Button
                  size="compact"
                  variant="secondary"
                  onClick={() => window.dispatchEvent(new Event("start-tour"))}
                  className="gap-1.5"
                >
                  Take the tour
                </Button>
              </div>

              {/* Getting started: the value chain in three steps. */}
              <ol className="grid sm:grid-cols-3 gap-2 text-left mt-2">
                {[
                  ["1 · Add a photo", "Drop, paste, or pick a sample. The matte runs on your GPU — nothing is uploaded."],
                  ["2 · Tell it what to keep", "Type it (SAM 3.1), click it, shift-click for similar, or draw with marquee, lasso and pen on the right-edge dock."],
                  ["3 · Finish & ship", "Backdrop, crop, caption, badge — then Download, Social Pack, or Seller Pack from Batch."],
                ].map(([title, body]) => (
                  <li key={title} className="rounded-xl bg-surface-2 shadow-surface-1 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-foreground">{title}</p>
                    <p className="text-[10px] leading-relaxed text-muted-foreground mt-0.5">{body}</p>
                  </li>
                ))}
              </ol>
              <p className="text-[10px] text-muted-foreground">
                Loads the retriever sample and runs the Muse agent on it. Needs
                your Meta key in Studio Controls.
              </p>
              {agentTrace.length > 0 && !originalCanvas && (
                <p className="text-[11px] text-warn">{agentTrace[0]}</p>
              )}
            </motion.div>

            {/* Dropzone Box */}
            <motion.div variants={RISE}
              ref={dropZoneRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="w-full rounded-2xl p-10 md:p-12 transition-colors duration-80 cursor-pointer flex flex-col items-center justify-center text-center group bg-surface-2 hover:bg-surface-3 shadow-surface-2 hover:shadow-surface-3"
            >
              <div className="size-14 rounded-2xl bg-surface-3 flex items-center justify-center text-foreground mb-3 group-hover:scale-105 transition-transform duration-80 shadow-surface-1">
                <UploadCloud className="size-7" />
              </div>

              <h2 className="text-sm sm:text-base font-semibold text-foreground mb-1">
                Drop your image here, or click to browse
              </h2>
              <p className="text-xs text-muted-foreground mb-4 max-w-md">
                Supports JPG, PNG, WEBP, AVIF. Or paste directly from your clipboard (
                <kbd className="px-1.5 py-0.5 rounded bg-surface-3 font-mono text-[10px]">
                  Cmd+V
                </kbd>
                ).
              </p>

              <Button size="compact" variant="primary">
                <FileImage className="size-3.5" /> Select from Computer
              </Button>
            </motion.div>

            {/* 1-Click Samples with Fluid Functionalism CardGroup */}
            <motion.div variants={RISE} className="w-full space-y-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                <Sparkles className="size-3.5 text-foreground/80" />
                <span>Or test with a sample photo:</span>
              </div>

              <CardGroup axis="xy" className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {SAMPLE_IMAGES.map((s, idx) => (
                  <Card
                    key={s.name}
                    index={idx}
                    asButton
                    aria-label={`Try the ${s.name} sample photo`}
                    onClick={async () => {
                      setIsProcessing(true)
                      setStatusType("loading")
                      setStatusText("fetching sample...")
                      updateAgentStatus("fetching sample...")
                      try {
                        const res = await fetch(s.url)
                        if (!res.ok) {
                          throw new Error(`Failed to load sample: HTTP ${res.status}`)
                        }
                        const blob = await res.blob()
                        const file = new File([blob], `${s.name.toLowerCase()}.jpg`, {
                          type: "image/jpeg",
                        })
                        processImageFile(file)
                      } catch (e: any) {
                        setErrorMsg(e.message || "Failed to load sample")
                        setStatusType("error")
                        setIsProcessing(false)
                      }
                    }}
                    className="p-0 overflow-hidden cursor-pointer aspect-[16/10] relative group shadow-surface-1"
                  >
                    {/* Decorative: the button carries the name, and the
                        caption below repeats it. An alt here made the tile
                        announce "Portrait" three times over. */}
                    <img
                      src={s.url}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-160"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="relative p-2.5 flex items-end justify-between w-full h-full">
                      <span className="text-[11px] font-medium text-white drop-shadow-xs">
                        {s.name}
                      </span>
                      <ArrowRight className="size-3 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity duration-80" />
                    </div>
                  </Card>
                ))}
              </CardGroup>
            </motion.div>
          </motion.div>
        ) : (
          /* Active Hero Canvas with Split Slider */
          <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            {/* File card: lives at the top of the right sidebar. */}
            {fileSlotEl &&
              createPortal(
                <div className="rounded-xl bg-surface-2 p-3 space-y-2.5">
              <div className="space-y-1 text-[12px] min-w-0">
                <span className="font-medium text-foreground truncate">
                  {currentFile ? currentFile.name : "Image Cutout"}
                </span>
                {originalCanvas && (
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    ({originalCanvas.width}×{originalCanvas.height})
                  </span>
                )}
                {isProcessing && (
                  <div className="ml-2">
                    <ThinkingIndicator size="compact" />
                  </div>
                )}
                <span className="flex min-w-0">
                  <LatestRunBar />
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => agentInputRef.current?.focus()}
                  className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  title="Ask the agent (/)"
                >
                  <Sparkles className="size-3" /> Ask agent
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={handleUndo}
                  disabled={!canUndoEdit}
                  className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  title="Undo edit (Ctrl+Z)"
                >
                  <Undo2 className="size-3" /> Undo
                </Button>
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={handleRedo}
                  disabled={!canRedo}
                  className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                  title="Redo edit (Ctrl+Shift+Z)"
                >
                  <Redo2 className="size-3" /> Redo
                </Button>
                {cutoutCanvas && originalCanvas && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => {
                      const verified = agentTrace.find((s) => s.startsWith("Verified"))
                      const card = composeShareCard({
                        original: originalCanvas,
                        cutout: cutoutCanvas,
                        title: "Cut out privately, on my own GPU",
                        stats:
                          verified?.replace("Verified: ", "") ?? statusText,
                      })
                      card.toBlob((blob) => {
                        if (!blob) return
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement("a")
                        a.href = url
                        a.download = "remove-free-card.png"
                        a.click()
                        setTimeout(() => URL.revokeObjectURL(url), 5000)
                      }, "image/png")
                    }}
                    className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    Share card
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={handleReset}
                  className="h-7 text-[11px] gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="size-3" />
                  New Image
                </Button>
              </div>
            </div>,
                fileSlotEl
              )}

            {/* Agent command bar: one sentence runs the Meta stack. */}
            <BottomSlot slot="chat">
            <div data-tour="command">
              <div className="flex items-center gap-2 rounded-xl bg-surface-2 shadow-surface-1 px-2.5 py-1.5">
                <Sparkles className="size-3.5 text-muted-foreground shrink-0" />
                <input
                  type="text"
                  value={agentCommand}
                  onChange={(e) => setAgentCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void runCommandBar()}
                  ref={agentInputRef}
                  placeholder='Tell the agent… "keep the dog on white"'
                  aria-label="Agent command"
                  disabled={agentRunning}
                  className="flex-1 min-w-[10rem] bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground outline-none disabled:opacity-50"
                />
                {!agentCommand && !agentRunning && (
                  <div className="hidden md:flex items-center gap-1 min-w-0 overflow-hidden">
                    {[
                      "keep the main subject on white",
                      "remove the background, keep everything else",
                      "keep the person, transparent background",
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
                {agentRunning && (
                  <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                    {agentElapsed}s
                  </span>
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
                  onClick={() => void runCommandBar()}
                  className="h-6 text-[11px]"
                >
                  {agentRunning ? "Running…" : "Run"}
                </Button>
              </div>
              {agentTrace.length > 0 && (
                <div className="flex justify-end mt-1.5 px-0.5">
                  <button
                    type="button"
                    onClick={() => setAgentTrace([])}
                    className="text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    clear trace
                  </button>
                </div>
              )}
              {agentTrace.length > 0 && (
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
                      <span className={step.startsWith("Verified") ? "text-ok" : undefined}>
                        {step}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            </BottomSlot>

            {/* Split Comparison Canvas */}
            <section
              aria-label="Cutout editor"
              className="flex-1 min-h-0 relative p-4 flex items-center justify-center overflow-hidden"
            >
              <h1 className="sr-only">
                {currentFile ? `Editing ${currentFile.name}` : "Cutout editor"}
              </h1>
              <SplitSlider
                depthCanvas={depthCanvas}
                onViewMode={(m) => { if (m === "depth") setWantDepth(true) }}
                targetCanvasRef={targetCanvasRef}
                originalCanvas={originalCanvas}
                cutoutCanvas={cutoutCanvas}
                aspectRatio={aspectRatio}
                isProcessing={isProcessing}
                statusType={statusType}
                refineActive={controls.tool !== "move" && controls.tool !== "hand"}
                refineMode={controls.refineMode}
                selectBusy={samBusy}
                overlayCanvasRef={overlayCanvasRef}
                ghostCanvasRef={ghostCanvasRef}
                tool={controls.tool}
                onMarquee={handleMarquee}
                onLasso={handleLasso}
                onPenClick={handlePenClick}
                onPenFinish={handlePenFinish}
                onCloneSource={(x, y) => {
                  cloneSourceRef.current = { x, y }
                  setSelectStatus("clone source set — drag to stamp")
                }}
                onSelectAt={handleSelectAt}
                pickColorActive={controls.pickColor}
                onPickColor={(x, y) => {
                  const source = originalCanvas
                  if (!source) return
                  const ctx = source.getContext("2d", { willReadFrequently: true })
                  if (!ctx) return
                  const px = Math.min(source.width - 1, Math.max(0, Math.round(x)))
                  const py = Math.min(source.height - 1, Math.max(0, Math.round(y)))
                  const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
                  const hex =
                    "#" +
                    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")
                  setControls((c) => ({ ...c, mode: "color", color: hex, pickColor: false }))
                }}
                brushSize={controls.brushSize}
                onStrokeStart={handleStrokeStart}
                onStrokeMove={handleStrokeMove}
                onStrokeEnd={handleStrokeEnd}
              />


              {/* Tool dock
                  (Photoshop placement); view controls stay bottom-right,
                  layers and settings stay in the right sidebar. */}
              <BottomSlot slot="center"><div data-tour="dock" className="flex items-center gap-2">
                {(() => {
                  const gi = Math.max(0, TOOL_GROUPS.findIndex((g) => g.tools.some((t) => t.id === controls.tool)))
                  const group = TOOL_GROUPS[gi]
                  const paints = controls.tool === "brush" || controls.tool === "heal" || controls.tool === "clone"
                  return (
                    <>
                      <PillTabs
                        ariaLabel="Tools"
                        iconOnlyInactive
                        value={gi}
                        onChange={(i) => {
                          const g = TOOL_GROUPS[i]
                          if (g) selectTool((lastInGroup[g.id] as StudioTool | undefined) ?? g.tools[0].id)
                        }}
                        items={TOOL_GROUPS.map((g) => {
                          const current = g.tools.find((t) => t.id === controls.tool) ?? g.tools[0]
                          return {
                            label: current.label.replace(/\s*[—(\/].*$/, ""),
                            title: current.label,
                            icon: current.Icon,
                          }
                        })}
                      />
                      {group.tools.length > 1 && (
                        <PillTabs
                          ariaLabel="Tool options"
                          iconOnlyInactive
                          value={Math.max(0, group.tools.findIndex((t) => t.id === controls.tool))}
                          onChange={(i) => selectTool(group.tools[i].id)}
                          items={group.tools.map((t) => ({
                            label: t.label.replace(/\s*[—(\/].*$/, ""),
                            title: t.label,
                            icon: t.Icon,
                          }))}
                        />
                      )}
                    </>
                  )
                })()}
              </div></BottomSlot>
              <BottomSlot slot="options">
                {(() => {
                  const paints = controls.tool === "brush" || controls.tool === "heal" || controls.tool === "clone"
                  return (
                    <>
                      {controls.tool === "brush" && (
                        <PillTabs
                          ariaLabel="Brush mode"
                          value={controls.refineMode === "restore" ? 0 : 1}
                          onChange={(i) =>
                            setControls((c) => ({ ...c, refineMode: i === 0 ? "restore" : "erase" }))
                          }
                          items={[{ label: "Keep" }, { label: "Remove" }]}
                        />
                      )}
                      {paints && (
                        <div className="flex h-7 items-center gap-2 rounded-full bg-surface-2/95 px-3 shadow-surface-2">
                          <span className="text-[12px] text-muted-foreground">Size</span>
                          <div className="w-24 [&>div>div:first-child]:hidden">
                            <Slider
                              min={2}
                              max={200}
                              step={1}
                              value={[controls.brushSize]}
                              onValueChange={([v]) => setControls((c) => ({ ...c, brushSize: v }))}
                              label=""
                              formatValue={() => ""}
                              size="compact"
                              variant="compact"
                            />
                          </div>
                          <span className="text-[12px] font-mono tabular-nums text-muted-foreground w-9 text-right">
                            {controls.brushSize}px
                          </span>
                        </div>
                      )}
                    </>
                  )
                })()}
              </BottomSlot>

              {/* The preview is a real cutout, so it needs to say it is not the
                  final one — otherwise a user exports the fast matte believing
                  it is the good one. */}
              {isRefining && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-surface-2/95 px-3 py-1.5 shadow-surface-1 backdrop-blur">
                  <span className="size-1.5 rounded-full bg-warn animate-pulse" />
                  <span className="text-[11px] font-medium text-foreground">
                    Quick preview — refining with {modelLabel}
                  </span>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
