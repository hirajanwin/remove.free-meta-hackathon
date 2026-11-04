import * as React from "react"
import { cn } from "@/lib/utils"

// macOS-style dock (shadcn.io/ui/dock pattern): icons grow on a cosine
// falloff as the pointer nears, labels float above, an active dot marks
// the current tool. Transforms only, so the layout never shifts.
// Reduced motion and touch get a static bar that works identically.

export interface DockItemDef {
  id: string
  label: string
  icon: React.ReactNode
}

const SIZE = 40
const MAGNIFICATION = 62
const COMPACT_SIZE = 30
const COMPACT_MAGNIFICATION = 44
const DISTANCE = 120

export function Dock({
  items,
  activeId,
  onSelect,
  className,
  orientation = "horizontal",
  labelSide: labelSideProp,
  compact = false,
}: {
  items: DockItemDef[]
  activeId: string
  onSelect: (id: string) => void
  className?: string
  compact?: boolean
  /** Vertical docks magnify along Y and sit at a canvas edge. */
  orientation?: "horizontal" | "vertical"
  /** Which side labels fly out on (vertical docks at the left edge want "right"). */
  labelSide?: "left" | "right"
}) {
  const vertical = orientation === "vertical"
  const size = compact ? COMPACT_SIZE : SIZE
  const mag = compact ? COMPACT_MAGNIFICATION : MAGNIFICATION
  const labelSide = labelSideProp ?? "left"
  const rootRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const [hoverLabel, setHoverLabel] = React.useState<string | null>(null)

  const reset = React.useCallback(() => {
    itemRefs.current.forEach((el) => {
      if (el) el.style.transform = "scale(1)"
    })
    setHoverLabel(null)
  }, [])

  const onMouseMove = (e: React.MouseEvent) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const root = rootRef.current
    if (!root) return
    itemRefs.current.forEach((el) => {
      if (!el) return
      const rect = el.getBoundingClientRect()
      const centre = vertical
        ? rect.top + rect.height / 2
        : rect.left + rect.width / 2
      const dist = Math.abs((vertical ? e.clientY : e.clientX) - centre)
      const falloff =
        dist >= DISTANCE ? 0 : Math.cos((dist / DISTANCE) * (Math.PI / 2))
      const scale = 1 + (mag / size - 1) * falloff
      const shift = (-(scale - 1) * 10).toFixed(1)
      el.style.transform = vertical
        ? `scale(${scale.toFixed(3)}) translateX(${shift}px)`
        : `scale(${scale.toFixed(3)}) translateY(${shift}px)`
    })
  }

  return (
    <div
      ref={rootRef}
      role="toolbar"
      aria-label="Tools"
      onMouseMove={onMouseMove}
      onMouseLeave={reset}
      className={cn(
        "relative flex gap-1 rounded-2xl bg-surface-2/95 backdrop-blur-xl shadow-surface-3 select-none",
        vertical ? "flex-col items-center px-1.5 py-2" : "items-end px-2 pt-2 pb-1.5",
        className
      )}
    >
      {items.map((item, i) => {
        const active = item.id === activeId
        return (
          <div
            key={item.id}
            className={cn("relative flex items-center", vertical ? "flex-row" : "flex-col")}
          >
            {hoverLabel === item.id && (
              <span
                className={cn(
                  "absolute whitespace-nowrap rounded-md bg-foreground px-1.5 py-0.5 text-[10px] font-medium text-background pointer-events-none z-10",
                  vertical
                    ? labelSide === "right"
                      ? "left-full ml-2 top-1/2 -translate-y-1/2"
                      : "right-full mr-2 top-1/2 -translate-y-1/2"
                    : "-top-7 left-1/2 -translate-x-1/2"
                )}
              >
                {item.label}
              </span>
            )}
            <button
              ref={(el) => {
                itemRefs.current[i] = el
              }}
              type="button"
              aria-label={item.label}
              aria-pressed={active}
              title={item.label}
              onClick={() => onSelect(item.id)}
              onMouseEnter={() => setHoverLabel(item.id)}
              onMouseLeave={() => setHoverLabel(null)}
              onFocus={() => setHoverLabel(item.id)}
              onBlur={() => setHoverLabel(null)}
              className={cn(
                "flex items-center justify-center rounded-xl transition-colors duration-80 origin-bottom will-change-transform",
                active
                  ? "bg-selected text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-hover"
              )}
              style={{ width: size, height: size }}
            >
              {item.icon}
            </button>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 size-1 rounded-full bg-foreground transition-opacity duration-80",
                active ? "opacity-70" : "opacity-0"
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
