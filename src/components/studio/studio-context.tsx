import * as React from "react"
import { DEFAULT_DEPTH_SLICE, type DepthSlice } from "@/lib/depth-slice"
import { type BgMode } from "@/lib/bg-removal"
import type { FormatSize } from "@/lib/export-image"
import type { BrushMode } from "@/lib/brush"
import type { EdgeConfig, EffectConfig } from "@/lib/recipe/schema"

/** Canvas tools, chosen from the dock. Everything except "move" owns the pointer. */
export type StudioTool =
  | "move"
  | "hand"
  | "select"
  | "similar"
  | "marquee"
  | "lasso"
  | "pen"
  | "brush"
  | "heal"
  | "clone"
  | "eyedropper"

export interface StudioControlsState {
  /** Active dock tool. Replaces the old refineActive boolean at the UI level. */
  tool: StudioTool
  mode: "transparent" | "color" | "gradient" | "blur" | "image"
  color: string
  gradient: "dark" | "sunset" | "ocean" | "cyberpunk" | "light"
  blurRadius: number
  /**
   * Vary the blur with scene depth instead of applying one flat radius. Costs
   * an extra 18 MiB model, so it is opt-in rather than the default.
   */
  depthBokeh: boolean
  backdropImage: string | null
  /**
   * One refine mode covering both gestures: a click selects the object under
   * the cursor (SlimSAM), a drag paints. They were separate toggles, which made
   * the user choose a tool before knowing which they wanted.
   */
  refineActive: boolean
  /** Applies to both gestures: keep the region, or remove it. */
  refineMode: BrushMode
  /**
   * What a click means: "object" segments the thing under the cursor
   * (SlimSAM); "similar" finds everything like it (DINOv2 seeds -> SlimSAM).
   */
  selectTool: "object" | "similar"
  /** Cosine similarity a DINOv2 patch must clear to count as "similar". */
  similarThreshold: number
  /** Brush radius in image pixels. */
  brushSize: number
  /** Tint strength for the edit overlay, 0 to 1. */
  overlayStrength: number
  exportFormat: "png" | "webp" | "jpeg"
  exportQuality: number
  /**
   * What the subject is made of, and how hard to lean on that.
   *
   * Drives the guided filter, the alpha snap and background unmixing — see
   * lib/recipe/materials.ts. It is part of the `.remove` recipe, which is why
   * it is shaped as the schema's `EdgeConfig` rather than two loose fields.
   */
  edge: EdgeConfig
  /** Trim the cutout by distance, from the on-device depth map. */
  depthSlice: DepthSlice
  /** Composable post-cut effects, in draw order. Also part of the recipe. */
  effects: EffectConfig[]
  /** Subject-only adjustments (1 = neutral), applied at composite time. */
  adjust: { brightness: number; contrast: number; saturation: number }
  /** Filter preset id (src/lib/filters.ts). */
  filterPreset: string
  /** Directional relighting of the subject. Angle degrees, intensity 0..1. */
  relight: { angle: number; intensity: number }
  /** Mirror the subject horizontally. */
  flipSubject: boolean
  /** Promo badge text ("SALE", "-20%") sealed top-right. Empty = none. */
  badgeText: string
  /** Caption text over the finished image (creator/thumbnail case). */
  captionText: string
  captionPosition: "bottom" | "top"
  /** Subject-centred crop applied to the output canvas. */
  cropAspect: import("@/lib/crop").CropAspect
  /** Eyedropper armed: the next canvas click picks the backdrop colour. */
  pickColor: boolean
  /** Layer stack visibility (Layers panel). */
  subjectVisible: boolean
  subjectOpacity: number
  backdropVisible: boolean
  captionVisible: boolean
  badgeVisible: boolean
}

export type SlotName = "left" | "center" | "right" | "options" | "chat"

interface StudioContextValue {
  controls: StudioControlsState
  setControls: React.Dispatch<React.SetStateAction<StudioControlsState>>
  hasCutout: boolean
  setHasCutout: (val: boolean) => void
  onDownload: () => void
  setOnDownload: (fn: () => void) => void
  onCopy: () => void
  setOnCopy: (fn: () => void) => void
  isStudioActive: boolean
  /** DOM slot at the top of the right sidebar where the page mounts its file card. */
  fileSlotEl: HTMLElement | null
  bottomEls: Record<SlotName, HTMLElement | null>
  setBottomEl: (slot: SlotName, el: HTMLElement | null) => void
  setFileSlotEl: (el: HTMLElement | null) => void
  setIsStudioActive: (val: boolean) => void
  estimatedSize: number | null
  /** Real encoded size of every format, for an informed export choice. */
  formatSizes: FormatSize[] | null
  setEstimatedSize: (val: number | null) => void
  setFormatSizes: (val: FormatSize[] | null) => void
  /** Manual refinement, wired up by the studio route. */
  onUndoEdit: () => void
  setOnUndoEdit: (fn: () => void) => void
  onResetEdits: () => void
  setOnResetEdits: (fn: () => void) => void
  canUndoEdit: boolean
  setCanUndoEdit: (val: boolean) => void
  /** Click-to-select model status, so failures are visible. */
  selectStatus: string | null
  setSelectStatus: (val: string | null) => void
  /** True while a click's selection is awaiting Apply. */
  pendingSelection: boolean
  setPendingSelection: (val: boolean) => void
  onApplyPending: () => void
  setOnApplyPending: (fn: () => void) => void
  onCancelPending: () => void
  setOnCancelPending: (fn: () => void) => void
  /** SAM 3.1 text-prompt selection, implemented by the studio route (it owns the canvas). */
  onTextSelect: (prompt: string) => Promise<{
    count: number
    objects: Array<{ id: string; confidence?: number; coverage: number }>
  }>
  setOnTextSelect: (
    fn: (prompt: string) => Promise<{
      count: number
      objects: Array<{ id: string; confidence?: number; coverage: number }>
    }>
  ) => void
  /** Propose one SAM object (a layer) on its own, by the id onTextSelect returned. */
  onSelectSamObject: (objectId: string) => void
  setOnSelectSamObject: (fn: (objectId: string) => void) => void
  /** Grounding DINO offline text select, implemented by the studio route. */
  onOfflineTextSelect: (prompt: string) => Promise<{ count: number }>
  setOnOfflineTextSelect: (fn: (prompt: string) => Promise<{ count: number }>) => void
  /** Render the current composite at every social size and download a ZIP. */
  onSocialPack: () => void
  setOnSocialPack: (fn: () => void) => void
  /** Animate the current composite into a short social video (WebM). */
  onAnimate: () => void
  setOnAnimate: (fn: () => void) => void
  animateBusy: boolean
  setAnimateBusy: (v: boolean) => void
  /** SAM object layers currently proposed/applied, for the Layers panel. */
  samLayers: Array<{ id: string; color: string; coverage: number; visible: boolean }>
  setSamLayers: (
    v: Array<{ id: string; color: string; coverage: number; visible: boolean }>
  ) => void
  onToggleSamLayer: (id: string) => void
  setOnToggleSamLayer: (fn: (id: string) => void) => void
  /** Execute a validated Muse agent plan; returns human-readable trace steps. */
  onAgentPlan: (plan: import("@/lib/muse").AgentPlan) => Promise<string[]>
  setOnAgentPlan: (fn: (plan: import("@/lib/muse").AgentPlan) => Promise<string[]>) => void
}

const defaultControls: StudioControlsState = {
  tool: "move",
  // Blur is the default backdrop: a cutout floating on its own defocused
  // scene reads as a finished photo, where a checkerboard reads as a
  // work-in-progress. Alpha is one click away in the strip.
  mode: "blur",
  color: "#ffffff",
  gradient: "dark",
  blurRadius: 16,
  depthBokeh: false,
  backdropImage: null,
  refineActive: false,
  refineMode: "restore",
  selectTool: "object",
  similarThreshold: 0.55,
  brushSize: 24,
  overlayStrength: 0.45,
  exportFormat: "png",
  exportQuality: 95,
  edge: { material: "auto", strength: 1 },
  effects: [],
  depthSlice: DEFAULT_DEPTH_SLICE,
  adjust: { brightness: 1, contrast: 1, saturation: 1 },
  filterPreset: "none",
  relight: { angle: 35, intensity: 0 },
  flipSubject: false,
  badgeText: "",
  captionText: "",
  captionPosition: "bottom",
  cropAspect: "none",
  pickColor: false,
  subjectVisible: true,
  subjectOpacity: 1,
  backdropVisible: true,
  captionVisible: true,
  badgeVisible: true,
}

const StudioContext = React.createContext<StudioContextValue | null>(null)

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [controls, setControls] = React.useState<StudioControlsState>(defaultControls)
  const [hasCutout, setHasCutout] = React.useState(false)
  const [fileSlotEl, setFileSlotEl] = React.useState<HTMLElement | null>(null)
  const [bottomEls, setBottomEls] = React.useState<Record<SlotName, HTMLElement | null>>({ left: null, center: null, right: null, options: null, chat: null })
  const setBottomEl = React.useCallback(
    (slot: SlotName, el: HTMLElement | null) =>
      setBottomEls((prev) => (prev[slot] === el ? prev : { ...prev, [slot]: el })),
    []
  )
  const [isStudioActive, setIsStudioActive] = React.useState(true)
  const [estimatedSize, setEstimatedSize] = React.useState<number | null>(null)
  const [formatSizes, setFormatSizes] = React.useState<FormatSize[] | null>(null)
  const [canUndoEdit, setCanUndoEdit] = React.useState(false)
  const [selectStatus, setSelectStatus] = React.useState<string | null>(null)
  const [pendingSelection, setPendingSelection] = React.useState(false)
  const applyPendingRef = React.useRef<() => void>(() => {})
  const cancelPendingRef = React.useRef<() => void>(() => {})
  const undoEditRef = React.useRef<() => void>(() => {})
  const resetEditsRef = React.useRef<() => void>(() => {})
  const downloadRef = React.useRef<() => void>(() => {})
  const copyRef = React.useRef<() => void>(() => {})
  type TextSelectResult = {
    count: number
    objects: Array<{ id: string; confidence?: number; coverage: number }>
  }
  const textSelectRef = React.useRef<(prompt: string) => Promise<TextSelectResult>>(
    async () => ({ count: 0, objects: [] })
  )
  const samObjectRef = React.useRef<(objectId: string) => void>(() => {})
  const offlineTextRef = React.useRef<(prompt: string) => Promise<{ count: number }>>(
    async () => ({ count: 0 })
  )
  const socialPackRef = React.useRef<() => void>(() => {})
  const animateRef = React.useRef<() => void>(() => {})
  const [animateBusy, setAnimateBusy] = React.useState(false)
  const [samLayers, setSamLayers] = React.useState<
    Array<{ id: string; color: string; coverage: number; visible: boolean }>
  >([])
  const samToggleRef = React.useRef<(id: string) => void>(() => {})
  const agentPlanRef = React.useRef<
    (plan: import("@/lib/muse").AgentPlan) => Promise<string[]>
  >(async () => [])

  const setOnDownload = React.useCallback((fn: () => void) => {
    downloadRef.current = fn
  }, [])

  const setOnCopy = React.useCallback((fn: () => void) => {
    copyRef.current = fn
  }, [])

  const handleDownload = React.useCallback(() => {
    downloadRef.current()
  }, [])

  const handleCopy = React.useCallback(() => {
    copyRef.current()
  }, [])

  return (
    <StudioContext.Provider
      value={{
        controls,
        setControls,
        hasCutout,
        setHasCutout,
        onDownload: handleDownload,
        setOnDownload,
        onCopy: handleCopy,
        setOnCopy,
        isStudioActive,
        fileSlotEl,
        bottomEls,
        setBottomEl,
        setFileSlotEl,
        setIsStudioActive,
        estimatedSize,
        formatSizes,
        canUndoEdit,
        setCanUndoEdit,
        selectStatus,
        setSelectStatus,
        pendingSelection,
        setPendingSelection,
        onApplyPending: () => applyPendingRef.current(),
        setOnApplyPending: (fn: () => void) => {
          applyPendingRef.current = fn
        },
        onCancelPending: () => cancelPendingRef.current(),
        setOnCancelPending: (fn: () => void) => {
          cancelPendingRef.current = fn
        },
        onUndoEdit: () => undoEditRef.current(),
        setOnUndoEdit: (fn: () => void) => {
          undoEditRef.current = fn
        },
        onResetEdits: () => resetEditsRef.current(),
        setOnResetEdits: (fn: () => void) => {
          resetEditsRef.current = fn
        },
        onTextSelect: (prompt: string) => textSelectRef.current(prompt),
        setOnTextSelect: (fn: (prompt: string) => Promise<TextSelectResult>) => {
          textSelectRef.current = fn
        },
        onSelectSamObject: (objectId: string) => samObjectRef.current(objectId),
        setOnSelectSamObject: (fn: (objectId: string) => void) => {
          samObjectRef.current = fn
        },
        onOfflineTextSelect: (prompt: string) => offlineTextRef.current(prompt),
        setOnOfflineTextSelect: (fn: (prompt: string) => Promise<{ count: number }>) => {
          offlineTextRef.current = fn
        },
        onSocialPack: () => socialPackRef.current(),
        setOnSocialPack: (fn: () => void) => {
          socialPackRef.current = fn
        },
        onAnimate: () => animateRef.current(),
        setOnAnimate: (fn: () => void) => {
          animateRef.current = fn
        },
        animateBusy,
        setAnimateBusy,
        samLayers,
        setSamLayers,
        onToggleSamLayer: (id: string) => samToggleRef.current(id),
        setOnToggleSamLayer: (fn: (id: string) => void) => {
          samToggleRef.current = fn
        },
        onAgentPlan: (plan: import("@/lib/muse").AgentPlan) => agentPlanRef.current(plan),
        setOnAgentPlan: (
          fn: (plan: import("@/lib/muse").AgentPlan) => Promise<string[]>
        ) => {
          agentPlanRef.current = fn
        },
        setEstimatedSize,
        setFormatSizes,
      }}
    >
      {children}
    </StudioContext.Provider>
  )
}

export function useStudio() {
  const ctx = React.useContext(StudioContext)
  if (!ctx) {
    throw new Error("useStudio must be used within a StudioProvider")
  }
  return ctx
}
