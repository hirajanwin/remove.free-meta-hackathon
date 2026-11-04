import * as React from "react"
import { Link } from "@tanstack/react-router"
import { useReducedMotion } from "framer-motion"
import { Orbit, AlertTriangle, Sparkles, ImageIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle"
import { RightSidebarPanel } from "@/components/layout/right-sidebar"
import { getHistory, type HistoryItem } from "@/lib/history-store"
import { buildAtlas, type Atlas } from "@/lib/wormhole/atlas"
import {
  createVirtualScroll,
  KEY_IMPULSE,
  type VirtualScroll,
} from "@/lib/wormhole/virtual-scroll"
import {
  PRESETS,
  DEFAULT_PRESET_ID,
  LAYOUT,
  instanceCountFor,
  presetById,
} from "@/lib/wormhole/presets"
import { WormholeControls, type Overrides } from "@/components/wormhole/controls"
import { useBackend } from "@/hooks/use-backend"

/**
 * three, @react-three/fiber and the postprocessing chain are a large
 * dependency — far larger than the rest of this app put together. Loaded
 * lazily so that cost lands only on someone who opens this page, and never on
 * the studio's first paint.
 */
const Scene = React.lazy(() => import("@/components/wormhole/scene"))

/** Fallback ring when the vault is empty, so the page is never a dead end. */
const SAMPLE_SOURCES = [
  "/samples/portrait.jpg",
  "/samples/sneakers.jpg",
  "/samples/retriever.jpg",
  "/samples/car.jpg",
]

type Source = "vault" | "samples"

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas")
    return !!(
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl")
    )
  } catch {
    return false
  }
}

export function WormholeView() {
  const backend = useBackend()
  const reducedMotion = useReducedMotion() ?? false

  const [items, setItems] = React.useState<HistoryItem[] | null>(null)
  const [atlas, setAtlas] = React.useState<Atlas | null>(null)
  const [source, setSource] = React.useState<Source>("vault")
  const [presetId, setPresetId] = React.useState(DEFAULT_PRESET_ID)
  const [speed, setSpeed] = React.useState(1)
  const [imageScale, setImageScale] = React.useState(LAYOUT.imageScale)
  const [bloom, setBloom] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [webgl] = React.useState(hasWebGL)
  const [debugMode, setDebugMode] = React.useState(0)
  const [overrides, setOverrides] = React.useState<Overrides>({})

  // A preset is the starting point, not a cage: every parameter the reference
  // exposed through Leva is adjustable, layered over whichever preset is
  // selected. Picking a different preset drops the overrides, because half of
  // them would be meaningless against a different base.
  const preset = React.useMemo(() => {
    const base = presetById(presetId)
    return {
      ...base,
      ...overrides.preset,
      shape: { ...base.shape, ...overrides.shape },
      grid: { ...base.grid, ...overrides.grid },
    }
  }, [presetId, overrides])

  const choosePreset = (id: string) => {
    setPresetId(id)
    setOverrides({})
  }

  const instanceCount = instanceCountFor(backend)

  // One physics object for the page's lifetime. It is mutable refs read inside
  // the render loop, so it must not be recreated on a state change or the ring
  // jumps back to a standstill every time a slider moves.
  const scrollRef = React.useRef<VirtualScroll | null>(null)
  if (!scrollRef.current) scrollRef.current = createVirtualScroll()
  const scroll = scrollRef.current

  const stageRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let stale = false
    getHistory()
      .then((h) => {
        if (!stale) setItems(h)
      })
      .catch(() => {
        if (!stale) setItems([])
      })
    return () => {
      stale = true
    }
  }, [])

  // Pick the vault when it has anything in it, samples otherwise — but only on
  // the first read, so a deliberate switch to samples is not undone.
  const decidedRef = React.useRef(false)
  React.useEffect(() => {
    if (!items || decidedRef.current) return
    decidedRef.current = true
    setSource(items.length > 0 ? "vault" : "samples")
  }, [items])

  const sources = React.useMemo(() => {
    if (source === "samples") return SAMPLE_SOURCES
    return (items ?? []).map((i) => i.dataUrl)
  }, [source, items])

  React.useEffect(() => {
    if (sources.length === 0) {
      setAtlas(null)
      return
    }
    let stale = false
    setError(null)
    buildAtlas(sources, LAYOUT.planeWidth / LAYOUT.planeHeight)
      .then((a) => {
        if (!stale) setAtlas(a)
      })
      .catch((e: any) => {
        if (!stale) setError(e?.message || "Could not build the texture atlas")
      })
    return () => {
      stale = true
    }
  }, [sources])

  const onCanvas = React.useCallback(
    (el: HTMLCanvasElement | null) => {
      if (!el) return
      const detach = scroll.attach(el)
      // The canvas outlives this callback, so the teardown is registered on the
      // element itself rather than being lost.
      el.addEventListener("__wormhole-detach", detach as EventListener, { once: true })
    },
    [scroll]
  )

  React.useEffect(
    () => () => {
      stageRef.current
        ?.querySelector("canvas")
        ?.dispatchEvent(new Event("__wormhole-detach"))
    },
    []
  )

  /**
   * Arrow keys drive the same physics the wheel does.
   *
   * A wheel is a pointer affordance. Without this the page is operable only
   * with a mouse or a touchscreen, which is the same gap the sample tiles and
   * the split handle had.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step: Record<string, number> = {
      ArrowDown: KEY_IMPULSE,
      ArrowUp: -KEY_IMPULSE,
      PageDown: KEY_IMPULSE * 3,
      PageUp: -KEY_IMPULSE * 3,
    }
    const delta = step[e.key]
    if (delta === undefined) return
    e.preventDefault()
    scroll.impulse(delta)
  }

  const vaultCount = items?.length ?? 0
  const showing = source === "vault" ? vaultCount : SAMPLE_SOURCES.length

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Orbit className="size-4" />
          Wormhole
          <Badge variant="secondary" dot={true} className="text-[10px]">
            {backend === "webgpu" ? "WebGPU" : "WASM CPU"}
          </Badge>
        </h1>
        <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
          Every cutout you have made, on a helix around a cylinder, driven by
          scroll. One instanced draw call and one texture atlas for the whole
          ring — the layout, the bend and every effect happen in a single
          shader. Scroll, or use the arrow keys.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-warn/20 bg-warn/5 px-3 py-2">
          <AlertTriangle className="size-3.5 text-warn mt-0.5 shrink-0" />
          <p className="text-[11px] leading-snug text-warn">{error}</p>
        </div>
      )}

      <div
        ref={stageRef}
        // Focusable, so the arrow keys have somewhere to land. A canvas is not
        // interactive to the platform, so the wrapper carries the role and the
        // description instead.
        tabIndex={0}
        role="application"
        aria-label="Wormhole gallery — scroll or use arrow keys to move through your cutouts"
        onKeyDown={onKeyDown}
        style={{ background: preset.background }}
        className="relative flex-1 min-h-[22rem] overflow-hidden rounded-2xl shadow-surface-2 outline-none transition-[background-color] duration-240 focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring,#6B97FF)]"
      >
        {!webgl ? (
          <Fallback
            icon={<AlertTriangle className="size-5 text-warn" />}
            title="No WebGL here"
            body="This browser cannot give us a WebGL context, so the ring cannot be drawn. Everything else in the app still works — background removal does not need it."
          />
        ) : !atlas ? (
          <Fallback
            icon={<Sparkles className="size-5 text-muted-foreground" />}
            title={
              items === null
                ? "Reading your vault…"
                : showing === 0
                  ? "Nothing to show yet"
                  : "Building the atlas…"
            }
            body={
              items !== null && showing === 0
                ? "Make a cutout and it appears here. Or switch the source to the sample photos in the panel."
                : "Packing every image into one texture, so the whole ring costs a single draw call."
            }
            action={
              items !== null && showing === 0 ? (
                <Button size="compact" variant="secondary" asChild>
                  <Link to="/">
                    <ImageIcon className="size-3.5" /> Make a cutout
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <React.Suspense
            fallback={
              <Fallback
                icon={<Sparkles className="size-5 text-muted-foreground" />}
                title="Loading the renderer…"
                body="three.js and the post-processing chain are only fetched on this page."
              />
            }
          >
            <Scene
              atlas={atlas}
              scroll={scroll}
              preset={preset}
              instanceCount={instanceCount}
              speed={speed}
              imageScale={imageScale}
              reducedMotion={reducedMotion}
              bloom={bloom}
              debugMode={debugMode}
              onCanvas={onCanvas}
            />
          </React.Suspense>
        )}

        {/* A canvas is opaque to a screen reader, so what it shows is stated. */}
        <p className="sr-only" aria-live="polite">
          {showing} {showing === 1 ? "image" : "images"} arranged in a helix,
          from {source === "vault" ? "your saved cutouts" : "the sample photos"}.
          Look, {preset.label} preset.
        </p>

        {atlas && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[10px] font-mono text-white/50">
            <span>{instanceCount} slots</span>
            <span aria-hidden="true">·</span>
            <span>{atlas.uniqueCount} unique</span>
            <span aria-hidden="true">·</span>
            <span>
              {atlas.cols}×{atlas.rows} atlas
            </span>
          </div>
        )}
      </div>

      {reducedMotion && (
        <p className="text-[11px] text-muted-foreground leading-snug">
          Reduced motion is on, so the ring holds still until you scroll it and
          the scan lines, flicker and camera drift are off. Your own scrolling
          still moves it.
        </p>
      )}

      <RightSidebarPanel title="Wormhole">
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Look
          </label>
          <TabsSubtle
            selectedIndex={PRESETS.findIndex((p) => p.id === presetId)}
            onSelect={(i) => choosePreset(PRESETS[i].id)}
            size="compact"
            className="w-full flex"
          >
            {PRESETS.map((p, i) => (
              <TabsSubtleItem key={p.id} index={i} label={p.label} />
            ))}
          </TabsSubtle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {preset.hint}
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Source
          </label>
          <TabsSubtle
            selectedIndex={source === "vault" ? 0 : 1}
            onSelect={(i) => setSource(i === 0 ? "vault" : "samples")}
            size="compact"
            className="w-full flex"
          >
            <TabsSubtleItem index={0} label="Vault" />
            <TabsSubtleItem index={1} label="Samples" />
          </TabsSubtle>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {source === "vault"
              ? vaultCount === 0
                ? "Your vault is empty. Samples are opaque photos, so the matte has nothing to show."
                : `${vaultCount} saved ${vaultCount === 1 ? "cutout" : "cutouts"}, with their alpha intact.`
              : "Opaque photographs, the way the original gallery was built. Switch to Vault to see transparency."}
          </p>
        </div>

        <WormholeControls
          preset={preset}
          overrides={overrides}
          onOverride={setOverrides}
          debugMode={debugMode}
          onDebugMode={setDebugMode}
          bloom={bloom}
          onBloom={setBloom}
          speed={speed}
          onSpeed={setSpeed}
          imageScale={imageScale}
          onImageScale={setImageScale}
        />

      </RightSidebarPanel>
    </div>
  )
}

function Fallback({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-8 text-center">
      {icon}
      <p className="text-[13px] font-medium text-white/90">{title}</p>
      <p className="max-w-sm text-[11px] leading-relaxed text-white/55">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
