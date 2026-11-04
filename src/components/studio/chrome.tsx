import * as React from "react"
import { createPortal } from "react-dom"
import { useStudio, type SlotName } from "@/components/studio/studio-context"

import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui/slider"
import { ChevronRight, ChevronsUpDown } from "lucide-react"
import { LatestRunBar } from "@/components/studio/audit-panel"

// Chrome shared by every "create" route (Studio, Video, Camera, Batch).
// One tab strip, one aspect-fit box, one file bar and one field label, so the
// four pages read as the same app. Nothing here knows about a route.

export type PanelTab = "edit" | "ai" | "model" | "export" | "audit"

const ALL_TABS: ReadonlyArray<readonly [PanelTab, string]> = [
  ["edit", "Edit"],
  ["ai", "AI"],
  ["model", "Model"],
  ["export", "Export"],
  ["audit", "Audit"],
]

/** The right sidebar's tab strip. A route passes the subset it has. */
export function PanelTabs({
  value,
  onChange,
  tabs = ["edit", "ai", "model", "export", "audit"],
}: {
  value: PanelTab
  onChange: (tab: PanelTab) => void
  tabs?: PanelTab[]
}) {
  return (
    <div className="sticky -top-3 z-10 flex items-center gap-1.5 bg-background pb-1.5">
    <div
      className="flex flex-1 gap-0.5 rounded-xl bg-surface-3 p-0.5"
      role="tablist"
      aria-label="Panel tabs"
    >
      {ALL_TABS.filter(([id]) => tabs.includes(id)).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "flex-1 rounded-lg px-1.5 py-1.5 text-[12px] font-medium transition-colors duration-80",
            value === id
              ? "bg-selected text-foreground shadow-surface-1"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
    <CardsToggleAll />
    </div>
  )
}

/** Hidden, not unmounted: a typed prompt or half-set key survives a tab switch. */
export function TabPane({
  active,
  tab,
  children,
}: {
  active: PanelTab
  tab: PanelTab
  children: React.ReactNode
}) {
  return (
    <div role="tabpanel" hidden={active !== tab} className="space-y-3">
      {children}
    </div>
  )
}

/** The one section-label style used in every panel. */
export function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "block text-[11px] font-medium text-muted-foreground uppercase tracking-wider",
        className
      )}
    >
      {children}
    </span>
  )
}

/**
 * A box that is exactly the largest rectangle of `aspect` (w/h) that fits its
 * parent. Both halves of a comparison use it, so they can never disagree about
 * shape and never show letterbox bands.
 */
export function FitBox({
  aspect,
  className,
  style,
  children,
}: {
  aspect: number
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const ratio = aspect > 0 ? aspect : 16 / 9
  return (
    <div className="size-full flex items-center justify-center overflow-hidden [container-type:size]">
      <div
        className={cn("relative", className)}
        style={{
          width: `min(100cqw, calc(100cqh * ${ratio}))`,
          aspectRatio: String(ratio),
          ...style,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Name, size, last-run chip on the left; page actions on the right. */
export function FileBar({
  name,
  detail,
  actions,
  showRun = true,
}: {
  name: string
  detail?: string
  actions?: React.ReactNode
  showRun?: boolean
}) {
  return (
    <div className="min-h-10 px-4 py-1 flex items-center justify-between gap-3 shrink-0 bg-background/50 backdrop-blur-xs">
      <div className="flex items-center gap-2 text-[12px] truncate min-w-0">
        <span className="font-medium text-foreground truncate">{name}</span>
        {detail && (
          <span className="text-[11px] font-mono text-muted-foreground shrink-0">{detail}</span>
        )}
        {showRun && (
          <span className="hidden md:inline-flex min-w-0 pl-2 border-l border-border/40">
            <LatestRunBar />
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </div>
  )
}

/**
 * The canvas toolbar: under the header, on the base plane. Row one holds the
 * tools, the view modes and the zoom; row two holds the active tool's options
 * and only exists while a tool has some. Pages fill the slots with <BottomSlot>.
 */
export function TopToolbar() {
  const { setBottomEl } = useStudio()
  // Stable ref callbacks: an inline one is detached and re-attached on every
  // render, which flips the slot state null -> el and loops.
  const refs = React.useMemo(() => {
    const make = (slot: SlotName) => (el: HTMLElement | null) => setBottomEl(slot, el)
    return {
      center: make("center"),
      left: make("left"),
      right: make("right"),
      options: make("options"),
    }
  }, [setBottomEl])
  return (
    <div className="shrink-0 px-4 pb-2 flex flex-col gap-1.5 [&:not(:has([data-slot]>*))]:hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <div data-slot ref={refs.center} className="flex items-center gap-2 min-w-0 empty:hidden" />
        <div data-slot ref={refs.left} className="flex items-center empty:hidden" />
        <div data-slot ref={refs.right} className="flex items-center gap-2 ml-auto empty:hidden" />
      </div>
      <div data-slot ref={refs.options} className="flex flex-wrap items-center gap-2 empty:hidden" />
    </div>
  )
}

/** The bottom inset: chat and suggestions. */
export function ChatDock() {
  const { setBottomEl } = useStudio()
  const ref = React.useCallback((el: HTMLElement | null) => setBottomEl("chat", el), [setBottomEl])
  return <div ref={ref} className="shrink-0 px-4 pb-3 empty:hidden" />
}

export function BottomSlot({
  slot,
  children,
}: {
  slot: SlotName
  children: React.ReactNode
}) {
  const { bottomEls } = useStudio()
  const el = bottomEls[slot]
  return el ? createPortal(children, el) : null
}

/** Zoom for every create page: out, slider, in, and a reset readout. */
export function ZoomControl({
  zoom,
  onChange,
  min = 0.5,
  max = 3,
}: {
  zoom: number
  onChange: (zoom: number) => void
  min?: number
  max?: number
}) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, Number((zoom + d).toFixed(2)))))
  return (
    <div className="flex h-7 items-center gap-1 rounded-full bg-surface-2/95 px-2 shadow-surface-2 select-none">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= min}
        onClick={() => step(-0.25)}
        className="size-5 rounded-full text-[14px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        −
      </button>
      <div className="w-24 px-1 [&>div>div:first-child]:hidden">
        <Slider
          min={min}
          max={max}
          step={0.05}
          value={[zoom]}
          onValueChange={([v]) => onChange(v)}
          label=""
          formatValue={() => ""}
          size="compact"
          variant="compact"
        />
      </div>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= max}
        onClick={() => step(0.25)}
        className="size-5 rounded-full text-[14px] leading-none text-muted-foreground hover:text-foreground disabled:opacity-40"
      >
        +
      </button>
      <button
        type="button"
        onClick={() => onChange(1)}
        title="Reset zoom to 100%"
        aria-label={`Zoom is ${Math.round(zoom * 100)}%. Reset to 100%.`}
        className="min-w-10 px-1 text-[12px] font-mono text-muted-foreground hover:text-foreground hover:bg-surface-4 transition-colors"
      >
        {Math.round(zoom * 100)}%
      </button>
    </div>
  )
}

export interface PillTabItem {
  label: string
  title?: string
  icon?: React.ComponentType<{ className?: string }>
}

/**
 * The one segmented control for the app's canvas chrome: backdrop modes,
 * tools and view modes all share this pill so they read as one family.
 * `iconOnlyInactive` shows an item's label only while it is selected.
 */
export function PillTabs({
  items,
  value,
  onChange,
  ariaLabel,
  iconOnlyInactive = false,
  className,
}: {
  items: PillTabItem[]
  value: number
  onChange: (index: number) => void
  ariaLabel: string
  iconOnlyInactive?: boolean
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex h-7 items-center gap-0.5 rounded-full bg-surface-2/95 px-0.5 shadow-surface-2 shrink-0", className)}
    >
      {items.map((item, i) => {
        const selected = i === value
        const Icon = item.icon
        return (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={item.label}
            title={item.title ?? item.label}
            onClick={() => onChange(i)}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[12px] whitespace-nowrap transition-colors duration-80",
              selected ? "bg-selected text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" />}
            {(!iconOnlyInactive || selected || !Icon) && item.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Panel cards ───
//
// Every sidebar block is one of these. Rules the defaults follow:
//   - Open by default: the decision a tab exists for (Subject, Refine, Model,
//     Export). A new user should never have to open anything to get a result.
//   - Closed by default: anything optional or fiddly (look, overlay, depth
//     slice, smoothing). Closed cards still say what they are doing in a
//     one-line summary, so nothing is hidden state.
//   - Auto-open: a card opens itself when the user turns its feature on or
//     picks the matching tool, and never closes itself.
//   - A card with a master switch can be enabled without opening it.
// Open/closed is remembered per card on this device; Expand/Collapse all
// resets the lot.

const CARD_EVENT = "panel-cards"

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(`remove-free:card:${id}`)
    return stored === null ? fallback : stored === "1"
  } catch {
    return fallback
  }
}

export function PanelCard({
  id,
  title,
  icon: Icon,
  summary,
  toggle,
  defaultOpen = false,
  autoOpen = false,
  children,
}: {
  id: string
  title: string
  icon?: React.ComponentType<{ className?: string }>
  /** Shown on the header while collapsed: what this card is currently doing. */
  summary?: React.ReactNode
  /** Master switch in the header, so the feature can be turned on while collapsed. */
  toggle?: { checked: boolean; onChange: (checked: boolean) => void; label?: string }
  defaultOpen?: boolean
  /** Opens the card when this turns true (never closes it). */
  autoOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpenState] = React.useState(() => readOpen(id, defaultOpen))
  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next)
      try {
        localStorage.setItem(`remove-free:card:${id}`, next ? "1" : "0")
      } catch {
        // preference just does not persist
      }
    },
    [id]
  )

  const prevAuto = React.useRef(autoOpen)
  React.useEffect(() => {
    if (autoOpen && !prevAuto.current) setOpenState(true)
    prevAuto.current = autoOpen
  }, [autoOpen])

  React.useEffect(() => {
    const onAll = (e: Event) => setOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open))
    window.addEventListener(CARD_EVENT, onAll)
    return () => window.removeEventListener(CARD_EVENT, onAll)
  }, [setOpen])

  return (
    <div id={id} className="scroll-mt-12 rounded-xl bg-surface-2">
      <div className="flex h-9 items-center gap-2 pl-3 pr-2.5">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-160", open && "rotate-90")}
          />
          {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
          <span className="truncate text-[12px] font-medium text-foreground">{title}</span>
          {!open && summary && (
            <span className="ml-auto min-w-0 max-w-[55%] truncate text-[11px] text-muted-foreground">
              {summary}
            </span>
          )}
        </button>
        {toggle && (
          <button
            type="button"
            role="switch"
            aria-checked={toggle.checked}
            aria-label={toggle.label ?? `${title} on or off`}
            onClick={() => {
              const next = !toggle.checked
              toggle.onChange(next)
              if (next) setOpen(true)
            }}
            className={cn(
              "relative h-4 w-7 shrink-0 rounded-full transition-colors duration-80",
              toggle.checked ? "bg-ok" : "bg-surface-5"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-3 rounded-full bg-white shadow transition-[left] duration-80",
                toggle.checked ? "left-[14px]" : "left-0.5"
              )}
            />
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-160",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div
          className="overflow-hidden"
          aria-hidden={!open}
          {...(open ? {} : ({ inert: "" } as Record<string, string>))}
        >
          <div className="space-y-2.5 px-3 pb-3">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Expand or collapse every card on the page. */
export function CardsToggleAll() {
  const [openAll, setOpenAll] = React.useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        const next = !openAll
        setOpenAll(next)
        window.dispatchEvent(new CustomEvent(CARD_EVENT, { detail: { open: next } }))
      }}
      title={openAll ? "Collapse all cards" : "Expand all cards"}
      aria-label={openAll ? "Collapse all cards" : "Expand all cards"}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-hover transition-colors duration-80"
    >
      <ChevronsUpDown className="size-3.5" />
    </button>
  )
}
