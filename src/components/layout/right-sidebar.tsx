import * as React from "react"
import { createPortal } from "react-dom"
import { PanelRightClose } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useSidebarLayout } from "./sidebar-layout-context"

/**
 * One right sidebar, filled by whichever route is showing.
 *
 * There were three mechanisms for this and only one was wired up: a
 * StudioSidebar hard-coded to `pathname === "/"`, plus an unused portal and an
 * unused context. The context could not have worked — `setContent(children)`
 * from an effect keyed on `children` re-runs every render, because JSX is a
 * fresh object each time, so it looped.
 *
 * The lesson is in the shape of this one: **no React nodes in state**. The
 * shell owns the chrome and exposes two DOM slots; panels portal into them.
 * Only the title, a string, is state — so a panel can re-render freely without
 * touching the provider.
 */
interface RightSidebarValue {
  bodyEl: HTMLElement | null
  actionsEl: HTMLElement | null
  setBodyEl: (el: HTMLElement | null) => void
  setActionsEl: (el: HTMLElement | null) => void
  title: string | null
  setTitle: (title: string | null) => void
  panelCount: number
  register: () => void
  unregister: () => void
}

const Ctx = React.createContext<RightSidebarValue | null>(null)

export function RightSidebarProvider({ children }: { children: React.ReactNode }) {
  const [bodyEl, setBodyEl] = React.useState<HTMLElement | null>(null)
  const [actionsEl, setActionsEl] = React.useState<HTMLElement | null>(null)
  const [title, setTitle] = React.useState<string | null>(null)
  const [panelCount, setPanelCount] = React.useState(0)

  // Stable, so a panel's effect never re-runs just because the provider did.
  const register = React.useCallback(() => setPanelCount((n) => n + 1), [])
  const unregister = React.useCallback(() => setPanelCount((n) => Math.max(0, n - 1)), [])

  const value = React.useMemo(
    () => ({
      bodyEl,
      actionsEl,
      setBodyEl,
      setActionsEl,
      title,
      setTitle,
      panelCount,
      register,
      unregister,
    }),
    [bodyEl, actionsEl, title, panelCount, register, unregister]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRightSidebarPanel() {
  const ctx = React.useContext(Ctx)
  return { hasPanel: (ctx?.panelCount ?? 0) > 0, title: ctx?.title ?? null }
}

function useRightSidebar() {
  const ctx = React.useContext(Ctx)
  if (!ctx) throw new Error("useRightSidebar must be used within a RightSidebarProvider")
  return ctx
}

/**
 * The chrome: header, collapse control, scroll container, and the narrow-screen
 * overlay behaviour. Renders nothing until a route contributes a panel, so a
 * route without controls gets its full width back.
 */
export function RightSidebarShell() {
  const { rightOpen, setRightOpen, isNarrow, toggleRight } = useSidebarLayout()
  const { setBodyEl, setActionsEl, title, panelCount } = useRightSidebar()

  if (!rightOpen || panelCount === 0) return null

  return (
    <>
      {isNarrow && (
        <div
          className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
          onClick={() => setRightOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label={title ?? "Panel"}
        className={cn(
          // py-2 mirrors the inset main panel's my-2 so both content boxes
          // start and end on the same lines — the sidebar-08 inset rhythm.
          "w-72 shrink-0 h-svh flex flex-col bg-background text-sidebar-foreground select-none",
          // Opaque surface when floating: bg-background emits no CSS here, so a
          // drawer relying on it was see-through.
          // py-2 is the sidebar-08 inset rhythm, and it only makes sense while
          // the sidebar is docked next to the inset main panel. On a drawer it
          // leaves an 8px gap at the top and bottom so the panel visibly fails
          // to reach the screen edges.
          isNarrow
            ? "fixed inset-y-0 right-0 z-50 bg-surface-1 shadow-surface-4"
            : "sticky top-0 py-2 z-0"
        )}
      >
        <div className="flex items-center justify-between px-2 pr-1.5 shrink-0 h-11">
          <span className="font-semibold text-[13px] tracking-tight text-foreground pl-1.5 truncate">
            {title}
          </span>

          <div className="flex items-center gap-1">
            <div ref={setActionsEl} className="flex items-center gap-1" />

            <Tooltip
              content={
                <span>
                  Collapse{" "}
                  <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">]</kbd>
                </span>
              }
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon-compact"
                onClick={toggleRight}
                aria-label="Collapse panel"
                className="size-6 rounded-md hover:bg-hover active:bg-active active:scale-95 transition-all duration-80 text-muted-foreground hover:text-foreground shrink-0"
              >
                <PanelRightClose className="size-3.5" />
              </Button>
            </Tooltip>
          </div>
        </div>

        {/* ScrollArea, not a native overflow: an overlay scrollbar takes no
            layout width, which is what the scrollbar-gutter reservation here
            was compensating for. Panels are portalled into the viewport, so
            the ref has to be the element that scrolls. */}
        <ScrollArea
          className="flex-1 min-h-0"
          viewportClassName="p-3"
          viewportRef={setBodyEl}
          viewportProps={{ className: "space-y-4" }}
        />
      </aside>
    </>
  )
}

/**
 * Contribute controls to the right sidebar from a route.
 *
 * `title` is a string so it can live in state safely. `actions` is JSX and is
 * portalled rather than stored, which is what keeps this from looping.
 */
export function RightSidebarPanel({
  title,
  actions,
  children,
}: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const { bodyEl, actionsEl, setTitle, register, unregister } = useRightSidebar()

  React.useEffect(() => {
    register()
    return unregister
  }, [register, unregister])

  React.useEffect(() => {
    setTitle(title)
  }, [title, setTitle])

  return (
    <>
      {bodyEl && createPortal(children, bodyEl)}
      {actions && actionsEl && createPortal(actions, actionsEl)}
    </>
  )
}
