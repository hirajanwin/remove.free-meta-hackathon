import { SquareSplitHorizontal, Scissors, Image as ImageIcon, Columns2, Layers } from "lucide-react"
import { PillTabs, ZoomControl, BottomSlot } from "@/components/studio/chrome"
import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import confetti from "canvas-confetti"
import {
  ZoomIn,
  ZoomOut,
  Sparkles,
  Eye,
  Sliders,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { Tooltip } from "@/components/ui/tooltip"
import { spring } from "@/lib/springs"
import { cn } from "@/lib/utils"

interface SplitSliderProps {
  /** Depth map rendered as colour, for the Depth view. Null while it is being read. */
  depthCanvas?: HTMLCanvasElement | null
  /** Lets the page start the depth read only when the Depth view is opened. */
  onViewMode?: (mode: string) => void
  targetCanvasRef: React.RefObject<HTMLCanvasElement | null>
  originalCanvas: HTMLCanvasElement | null
  cutoutCanvas: HTMLCanvasElement | null
  aspectRatio: number
  isProcessing: boolean
  statusType: "ready" | "loading" | "done" | "error"
  /** When true the canvas refines instead of panning. */
  refineActive?: boolean
  /** Radius in image pixels, used to size the cursor ring. */
  brushSize?: number
  refineMode?: "erase" | "restore"
  /** True while a selection is being computed. */
  selectBusy?: boolean
  /** Canvas the parent paints the edit overlay into. */
  overlayCanvasRef?: React.RefObject<HTMLCanvasElement | null>
  /** Canvas holding the outgoing frame during a reveal. */
  ghostCanvasRef?: React.RefObject<HTMLCanvasElement | null>
  onSelectAt?: (x: number, y: number, exclude?: boolean, similar?: boolean) => void
  /** Eyedropper armed: canvas clicks report a colour pick instead. */
  pickColorActive?: boolean
  onPickColor?: (x: number, y: number) => void
  onStrokeStart?: (x: number, y: number) => void
  onStrokeMove?: (x: number, y: number) => void
  onStrokeEnd?: () => void
  /** Active dock tool; decides what a drag means. */
  tool?: import("@/components/studio/studio-context").StudioTool
  onMarquee?: (a: { x: number; y: number }, b: { x: number; y: number }) => void
  onLasso?: (points: Array<{ x: number; y: number }>) => void
  onPenClick?: (x: number, y: number) => void
  onPenFinish?: () => void
  /** Alt-click in clone mode sets the stamp source. */
  onCloneSource?: (x: number, y: number) => void
}

const VIEW_MODES = [["split", "Split", SquareSplitHorizontal], ["cutout", "Cutout", Scissors], ["original", "Original", ImageIcon], ["sidebyside", "Side by side", Columns2], ["depth", "Depth", Layers]] as const

export function SplitSlider({
  depthCanvas = null,
  onViewMode,
  targetCanvasRef,
  originalCanvas,
  cutoutCanvas,
  aspectRatio,
  isProcessing,
  statusType,
  refineActive = false,
  brushSize = 24,
  refineMode = "restore",
  selectBusy = false,
  overlayCanvasRef,
  ghostCanvasRef,
  onSelectAt,
  pickColorActive = false,
  onPickColor,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
  tool = "select",
  onMarquee,
  onLasso,
  onPenClick,
  onPenFinish,
  onCloneSource,
}: SplitSliderProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const previewOriginalCanvasRef = React.useRef<HTMLCanvasElement>(null)

  // Viewing mode: split comparison, cutout only, original only, or both
  // side by side. Local to the viewer — it changes nothing about output.
  const [viewMode, setViewMode] = React.useState<"split" | "cutout" | "original" | "sidebyside" | "depth">("sidebyside")
  const twoUp = viewMode === "sidebyside" || viewMode === "depth"
  React.useEffect(() => onViewMode?.(viewMode), [viewMode, onViewMode])
  const mirrorCanvasRef = React.useRef<HTMLCanvasElement>(null)

  // Side-by-side needs a second copy of the finished canvas (one canvas
  // element can only live in one place). Mirror it on an interval while
  // the mode is active; 250ms is plenty for a comparison view.
  React.useEffect(() => {
    if (viewMode !== "depth") return
    const mirror = mirrorCanvasRef.current
    if (!mirror) return
    if (!depthCanvas) {
      mirror.getContext("2d")?.clearRect(0, 0, mirror.width, mirror.height)
      return
    }
    mirror.width = depthCanvas.width
    mirror.height = depthCanvas.height
    mirror.getContext("2d")?.drawImage(depthCanvas, 0, 0)
  }, [viewMode, depthCanvas])

  React.useEffect(() => {
    if (viewMode !== "sidebyside") return
    const draw = () => {
      const src = targetCanvasRef.current
      const mirror = mirrorCanvasRef.current
      if (!src || !mirror || !src.width) return
      if (mirror.width !== src.width) mirror.width = src.width
      if (mirror.height !== src.height) mirror.height = src.height
      mirror.getContext("2d")?.drawImage(src, 0, 0)
    }
    draw()
    const t = setInterval(draw, 250)
    return () => clearInterval(t)
  }, [viewMode, targetCanvasRef, cutoutCanvas])

  // Split position (0 to 100)
  const [splitPos, setSplitPos] = React.useState(50)
  const [isDragging, setIsDragging] = React.useState(false)
  const [showOriginalFull, setShowOriginalFull] = React.useState(false)

  // Zoom & Pan state
  const [zoom, setZoom] = React.useState(1)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = React.useState(false)
  const panStartRef = React.useRef({ x: 0, y: 0 })

  // Trigger celebration confetti on done
  const hasCelebratedRef = React.useRef(false)
  React.useEffect(() => {
    if (statusType === "done" && !hasCelebratedRef.current) {
      hasCelebratedRef.current = true
      try {
        confetti({
          particleCount: 40,
          spread: 60,
          origin: { y: 0.75 },
          colors: ["#8b5cf6", "#6366f1", "#3b82f6", "#10b981"],
          // The library appends its own fixed-position canvas to <body>, which
          // lands outside every landmark and is the one thing axe still flags.
          // It is decoration with no content, so hide it from the tree.
          disableForReducedMotion: true,
        })
        document
          .querySelectorAll<HTMLCanvasElement>("body > canvas")
          .forEach((c) => c.setAttribute("aria-hidden", "true"))
      } catch {
        // ignore
      }
    } else if (statusType === "loading") {
      hasCelebratedRef.current = false
    }
  }, [statusType])

  // Reset zoom & pan when image changes
  React.useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSplitPos(50)
  }, [originalCanvas])

  // Spacebar toggle to peek original
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault()
        setShowOriginalFull(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setShowOriginalFull(false)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])

  // Sync previewOriginalCanvasRef with originalCanvas.
  // This must re-run when the layer mounts: the canvas only renders once
  // processing finishes, so a sync keyed on originalCanvas alone ran
  // while the ref was still null and the "Original" side stayed blank —
  // both halves then showed the cutout, which reads as a broken split.
  React.useEffect(() => {
    const prevNode = previewOriginalCanvasRef.current
    if (prevNode && originalCanvas) {
      prevNode.width = originalCanvas.width
      prevNode.height = originalCanvas.height
      const ctx = prevNode.getContext("2d")
      if (ctx) ctx.drawImage(originalCanvas, 0, 0)
    }
  }, [originalCanvas, isProcessing, viewMode])

  // Handle Dragging Split Handle
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100))
    setSplitPos(percent)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }
    }
  }

  // ─── Brush input ───
  // getBoundingClientRect() reflects the element's on-screen box after every
  // CSS transform, so this single mapping handles zoom, pan and object-contain
  // letterboxing without reimplementing any of them.
  const isStrokingRef = React.useRef(false)
  const [cursor, setCursor] = React.useState<{ x: number; y: number } | null>(null)

  const toImagePoint = (e: { clientX: number; clientY: number }) => {
    const canvas = targetCanvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      // On-screen radius, for the cursor ring.
      screenScale: rect.width / canvas.width,
    }
  }

  /** Movement in screen px past which the gesture counts as a drag. */
  const DRAG_THRESHOLD = 5

  const downRef = React.useRef<{
    sx: number
    sy: number
    ix: number
    iy: number
    exclude: boolean
    similar: boolean
  } | null>(null)
  const draggedRef = React.useRef(false)

  // Marquee / lasso gestures, tracked separately from brush strokes.
  const shapeRef = React.useRef<{
    kind: "marquee" | "lasso" | "pen"
    sx: number
    sy: number
    ix: number
    iy: number
    points: Array<{ x: number; y: number }>
  } | null>(null)
  const [marqueeBox, setMarqueeBox] = React.useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)

  // Hand tool: drag pans the view at any zoom.
  const handRef = React.useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  const handleBrushDown = (e: React.PointerEvent) => {
    // The hand pans even outside refine mode, so it is handled first.
    if (tool !== "hand" && !refineActive) return
    const p = toImagePoint(e)
    if (!p) return
    e.preventDefault()

    if (tool === "hand") {
      try {
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      } catch {
        // synthetic pointers
      }
      isStrokingRef.current = true
      handRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y }
      return
    }

    // Shape tools own the gesture before brush logic sees it.
    if (tool === "marquee" || tool === "lasso" || tool === "pen") {
      try {
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      } catch {
        // synthetic pointers: nothing to capture
      }
      isStrokingRef.current = true
      shapeRef.current = {
        kind: tool,
        sx: e.clientX,
        sy: e.clientY,
        ix: p.x,
        iy: p.y,
        points: [{ x: p.x, y: p.y }],
      }
      if (tool === "marquee") {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          setMarqueeBox({
            left: e.clientX - rect.left,
            top: e.clientY - rect.top,
            width: 0,
            height: 0,
          })
        }
      }
      return
    }

    // Clone stamp: Alt-click chooses what to copy from.
    if (tool === "clone" && e.altKey) {
      onCloneSource?.(p.x, p.y)
      return
    }
    // Capture so a gesture that leaves the canvas still ends cleanly.
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      // Synthetic or already-released pointers have nothing to capture.
    }
    // Right-click or Alt marks an exclude point, matching the convention in
    // the reference transformers.js SAM demo.
    downRef.current = {
      sx: e.clientX,
      sy: e.clientY,
      ix: p.x,
      iy: p.y,
      exclude: e.button === 2 || e.altKey,
      // Shift-click always means "everything like this", whatever tool is on.
      similar: e.shiftKey,
    }
    draggedRef.current = false
    isStrokingRef.current = true
  }

  const handleBrushMove = (e: React.PointerEvent) => {
    if (tool !== "hand" && !refineActive) return
    const p = toImagePoint(e)
    if (!p) return
    setCursor({ x: e.clientX, y: e.clientY })

    if (tool === "hand" && handRef.current && isStrokingRef.current) {
      setPan({
        x: handRef.current.px + (e.clientX - handRef.current.sx),
        y: handRef.current.py + (e.clientY - handRef.current.sy),
      })
      return
    }

    const shape = shapeRef.current
    if (shape && isStrokingRef.current) {
      if (shape.kind === "marquee") {
        const rect = containerRef.current?.getBoundingClientRect()
        if (rect) {
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          const sx = shape.sx - rect.left
          const sy = shape.sy - rect.top
          setMarqueeBox({
            left: Math.min(sx, x),
            top: Math.min(sy, y),
            width: Math.abs(x - sx),
            height: Math.abs(y - sy),
          })
        }
      } else if (shape.kind === "lasso") {
        const last = shape.points[shape.points.length - 1]
        if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 3) {
          shape.points.push({ x: p.x, y: p.y })
        }
      }
      return
    }

    const down = downRef.current
    if (!isStrokingRef.current || !down) return

    if (!draggedRef.current) {
      const moved =
        Math.abs(e.clientX - down.sx) + Math.abs(e.clientY - down.sy)
      if (moved < DRAG_THRESHOLD) return
      // Promote to a drag, starting from where the pointer went down so the
      // first few pixels of the stroke are not lost to the threshold.
      draggedRef.current = true
      onStrokeStart?.(down.ix, down.iy)
      onStrokeMove?.(down.ix, down.iy)
    }
    onStrokeMove?.(p.x, p.y)
  }

  const handleBrushUp = (e: React.PointerEvent) => {
    if ((tool !== "hand" && !refineActive) || !isStrokingRef.current) return
    try {
      ;(e.target as Element).releasePointerCapture?.(e.pointerId)
    } catch {
      // Nothing was captured (see handleBrushDown).
    }
    isStrokingRef.current = false

    if (tool === "hand") {
      handRef.current = null
      return
    }

    const shape = shapeRef.current
    if (shape) {
      shapeRef.current = null
      setMarqueeBox(null)
      const p = toImagePoint(e)
      if (shape.kind === "marquee" && p) {
        if (Math.abs(p.x - shape.ix) > 4 && Math.abs(p.y - shape.iy) > 4) {
          onMarquee?.({ x: shape.ix, y: shape.iy }, { x: p.x, y: p.y })
        }
      } else if (shape.kind === "lasso") {
        if (shape.points.length >= 3) onLasso?.(shape.points)
      } else if (shape.kind === "pen") {
        onPenClick?.(shape.ix, shape.iy)
      }
      return
    }

    const down = downRef.current
    downRef.current = null

    if (draggedRef.current) {
      onStrokeEnd?.()
    } else if (down && !selectBusy) {
      if (tool === "brush" || tool === "heal" || tool === "clone") {
        // A click with a paint tool paints one dot. It must NOT fall
        // through to object selection — that made clone/heal clicks
        // select things instead of doing their own job.
        onStrokeStart?.(down.ix, down.iy)
        onStrokeMove?.(down.ix, down.iy)
        onStrokeEnd?.()
      } else {
        // Never moved: treat it as a click and select the object under it.
        onSelectAt?.(down.ix, down.iy, down.exclude, down.similar)
      }
    }
    draggedRef.current = false
  }

  const brushScreenRadius = (() => {
    const canvas = targetCanvasRef.current
    if (!canvas) return brushSize
    const rect = canvas.getBoundingClientRect()
    if (!canvas.width || !rect.width) return brushSize
    return brushSize * (rect.width / canvas.width)
  })()

  // Handle Pan when zoomed
  const handlePanStart = (e: React.MouseEvent) => {
    if (refineActive) return
    if (zoom <= 1) return
    setIsPanning(true)
    panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
  }

  const handlePanMove = (e: React.MouseEvent) => {
    if (!isPanning || zoom <= 1) return
    setPan({
      x: e.clientX - panStartRef.current.x,
      y: e.clientY - panStartRef.current.y,
    })
  }

  const handlePanEnd = () => setIsPanning(false)

  // The keyboard half of the split control. Lives on the handle rather than on
  // the viewport: the handle is the thing that moves, it is the thing that can
  // carry `role="slider"` without making the canvases inside the viewport
  // inaccessible, and it is the thing a focus ring can actually be seen on.
  //
  // Keys follow the ARIA slider pattern rather than arrows alone — Home/End and
  // Page keys are what someone who uses a slider by keyboard reaches for.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const clamp = (v: number) => Math.min(100, Math.max(0, v))
    const step = e.shiftKey ? 1 : 5
    const next = {
      ArrowLeft: (p: number) => clamp(p - step),
      ArrowRight: (p: number) => clamp(p + step),
      ArrowDown: (p: number) => clamp(p - step),
      ArrowUp: (p: number) => clamp(p + step),
      PageDown: (p: number) => clamp(p - 20),
      PageUp: (p: number) => clamp(p + 20),
      Home: () => 0,
      End: () => 100,
    }[e.key]
    if (!next) return
    e.preventDefault()
    setSplitPos(next)
  }

  return (
    <div
      ref={containerRef}
      onMouseDown={handlePanStart}
      onMouseMove={handlePanMove}
      onMouseUp={handlePanEnd}
      className={cn(
        "relative w-full h-full flex items-center justify-center overflow-hidden select-none outline-none",
        zoom > 1 ? (isPanning ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
      )}
    >
      {/* ─── Canvas Viewport Layer ───
          h-full with min-h-0 gives the canvas a definite height to fit:
          max-h-full alone was circular (the parent sized to the canvas,
          so nothing ever constrained it) and tall images overflowed. */}
      <div
        data-pane="original"
        className={cn(
          "h-full flex items-center justify-center overflow-hidden [container-type:size]",
          twoUp ? "flex-1 min-w-0 pr-1.5" : "w-full"
        )}
      >
      <div
        className="relative transition-transform duration-80 flex items-center justify-center"
        style={{
          width: `min(100cqw, calc(100cqh * ${aspectRatio > 0 ? aspectRatio : 1}))`,
          aspectRatio: String(aspectRatio > 0 ? aspectRatio : 1),
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
        }}
      >
        {/* Layer 1: Left / Background (Cutout with selected background or checkerboard) */}
        <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl bg-checkered">
          {/* Target Canvas #cv (Preserves Agent DOM Contract) */}
          <canvas
            ref={targetCanvasRef}
            id="cv"
            className="block w-full h-full"
            style={{
              cursor: pickColorActive
                ? "crosshair"
                : tool === "hand"
                  ? "grab"
                  : tool === "marquee" || tool === "lasso" || tool === "pen"
                    ? "crosshair"
                    : refineActive
                      ? selectBusy
                        ? "progress"
                        : "none"
                      : undefined,
              touchAction: refineActive ? "none" : undefined,
            }}
            onContextMenu={(e) => {
              // Right-click is an exclude point, so suppress the menu.
              if (refineActive) e.preventDefault()
            }}
            onClick={(e) => {
              if (!pickColorActive) return
              const p = toImagePoint(e)
              if (p) onPickColor?.(p.x, p.y)
            }}
            onDoubleClick={() => {
              if (tool === "pen") onPenFinish?.()
            }}
            onPointerDown={handleBrushDown}
            onPointerMove={handleBrushMove}
            onPointerUp={handleBrushUp}
            onPointerCancel={handleBrushUp}
            onPointerLeave={() => setCursor(null)}
          />

          {/* Reveal layer.
              Holds the frame that was on screen a moment ago — the source
              photo, or the rough preview matte — and fades out once the new one
              is painted underneath. The removal is the whole product, and it
              used to happen between two frames with nothing to see. Fading the
              old image away means you watch the background go, instead of being
              handed a different picture. */}
          <canvas
            ref={ghostCanvasRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 block w-full h-full object-contain"
            style={{ opacity: 0 }}
          />

          {/* Edit overlay. Absolutely positioned over #cv and pointer-inert, so
              the tint shows what is marked without intercepting gestures. */}
          <canvas
            ref={overlayCanvasRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 block w-full h-full object-contain"
            style={{ display: refineActive ? "block" : "none" }}
          />
        </div>

        {/* Layer 2: Right / Foreground (Original Image) Clipped by Split Position */}
        {/* Side by side: the left pane is the original, always — even while
            processing or editing. Other modes only show it when idle. */}
        {originalCanvas && viewMode !== "cutout" && (twoUp || (!isProcessing && !refineActive)) && (
          <div
            className="absolute inset-0 overflow-hidden pointer-events-none rounded-xl"
            style={{
              clipPath:
                showOriginalFull || viewMode === "original" || twoUp
                  ? "inset(0 0 0 0)"
                  : `inset(0 0 0 ${splitPos}%)`,
            }}
          >
            <canvas
              ref={previewOriginalCanvasRef}
              className="size-full object-contain pointer-events-none"
            />
          </div>
        )}

        {/* ─── Layer 3: Interactive Split Handle Divider ─── */}
        {originalCanvas && !isProcessing && !showOriginalFull && !refineActive && viewMode === "split" && (
          <div
            role="slider"
            tabIndex={0}
            aria-label="Before and after split"
            aria-orientation="horizontal"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(splitPos)}
            // splitPos is the divider's position, and the cutout is the side to
            // its left — so a higher value shows MORE cutout, not less. Worth
            // stating, because the obvious reading of the name is backwards.
            aria-valuetext={`${Math.round(splitPos)}% cutout, ${100 - Math.round(splitPos)}% original`}
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute inset-y-0 w-8 -ml-4 z-20 cursor-ew-resize flex items-center justify-center group touch-none outline-none"
            style={{ left: `${splitPos}%` }}
          >
            {/* Divider Line */}
            <div
              className={cn(
                "w-0.5 h-full bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.5)] transition-colors",
                isDragging ? "bg-primary w-1" : "group-hover:bg-white"
              )}
            />

            {/* Center Drag Handle Knob */}
            <div
              className={cn(
                "absolute size-8 rounded-full bg-white/95 text-neutral-900 shadow-xl border border-white/80 flex items-center justify-center transition-transform",
                // The wrapper is the focusable element but it is an invisible
                // 32px strip; the knob is what the eye tracks, so the ring goes
                // here.
                "group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[color:var(--focus-ring,#6B97FF)]",
                isDragging ? "scale-110 shadow-2xl bg-primary text-white" : "group-hover:scale-105"
              )}
            >
              <div className="flex items-center gap-0.5">
                <span className="text-[10px] font-bold">‹</span>
                <span className="text-[10px] font-bold">›</span>
              </div>
            </div>

            {/* Floating Percentage Tag while dragging */}
            <AnimatePresence>
              {isDragging && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.9 }}
                  transition={spring.fast}
                  className="absolute -top-9 px-2 py-0.5 rounded-md bg-foreground text-background text-[11px] font-mono shadow-surface-2 pointer-events-none"
                >
                  {Math.round(splitPos)}%
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Floating Comparison Labels */}
        {originalCanvas && !isProcessing && !refineActive && viewMode === "split" && (
          <div className="absolute top-3 inset-x-3 flex items-center justify-between pointer-events-none z-10">
            <span className="px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-md text-foreground text-[11px] font-medium border border-border/50 shadow-surface-1">
              Cutout
            </span>
            <span className="px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-md text-foreground text-[11px] font-medium border border-border/50 shadow-surface-1">
              Original
            </span>
          </div>
        )}
      </div>
      </div>

      {/* Side-by-side: finished cutout mirrored next to the original.
          Same zoom/pan transform as the main viewport, so the slider
          moves both halves together. */}
      {twoUp && originalCanvas && (
        <div className="h-full flex-1 min-w-0 pl-1.5 flex items-center justify-center overflow-hidden [container-type:size]">
        <div
          className="relative flex items-center justify-center transition-transform duration-80"
          style={{
            width: `min(100cqw, calc(100cqh * ${aspectRatio > 0 ? aspectRatio : 1}))`,
          aspectRatio: String(aspectRatio > 0 ? aspectRatio : 1),
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          }}
        >
          <div className="relative w-full h-full rounded-xl overflow-hidden shadow-2xl bg-checkered">
            <canvas
              ref={mirrorCanvasRef}
              className="block w-full h-full"
              aria-label="Cutout, side by side with the original"
            />
          </div>
          <span className="absolute top-3 left-3 px-2 py-0.5 rounded-md bg-background/80 backdrop-blur-md text-foreground text-[11px] font-medium border border-border/50">
            {viewMode === "depth" ? "Depth" : "Cutout"}
          </span>
          {viewMode === "depth" && !depthCanvas && (
            <span className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">
              Reading depth…
            </span>
          )}
        </div>
        </div>
      )}

      {/* Marquee drag preview. */}
      {marqueeBox && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-40 border border-dashed border-white/90 bg-white/10"
          style={{
            left: marqueeBox.left,
            top: marqueeBox.top,
            width: marqueeBox.width,
            height: marqueeBox.height,
          }}
        />
      )}

      {/* Brush cursor ring, sized to the real brush footprint. Rendered fixed
          and outside the transformed container so the viewer's CSS scale is not
          applied to it twice. */}
      {refineActive &&
        cursor &&
        (tool === "brush" || tool === "heal" || tool === "clone" || tool === "select" || tool === "similar") && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-full border-2"
          style={{
            left: cursor.x - brushScreenRadius,
            top: cursor.y - brushScreenRadius,
            width: brushScreenRadius * 2,
            height: brushScreenRadius * 2,
            borderColor:
              refineMode === "erase" ? "rgba(248,113,113,0.95)" : "rgba(52,211,153,0.95)",
            boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.35)",
          }}
        />
      )}

      {/* ─── Floating Canvas Micro-Toolbar (Zoom, Fit, Peek) ─── */}
      <BottomSlot slot="right"><PillTabs ariaLabel="View mode" value={VIEW_MODES.findIndex((m) => m[0] === viewMode)} onChange={(i) => setViewMode(VIEW_MODES[i][0])} iconOnlyInactive items={VIEW_MODES.map((m) => ({ label: m[1], icon: m[2] }))} /><ZoomControl zoom={zoom} onChange={setZoom} /></BottomSlot>
    </div>
  )
}
