import * as React from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  Scissors,
  Sparkles,
  Layers,
  Terminal,
  History as HistoryIcon,
  Cpu,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  Video,
  Film,
  Gauge,
  HardDrive,
  Orbit,
  Mountain,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { ThemeToggle } from "./theme-toggle"
import { DiagnosticsDialog } from "./diagnostics-dialog"
import { useSidebarLayout } from "./sidebar-layout-context"
import { getHistory, type HistoryItem, clearHistory } from "@/lib/history-store"
import { countCachedModels } from "@/lib/model-cache"

/** Kept next to the nav it counts, so adding an item cannot leave it behind. */
const WORKSPACE_COUNT = 4

export function AppSidebar() {
  const { leftOpen, setLeftOpen, isNarrow, setSearchOpen, triggerUpload } = useSidebarLayout()
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const [historyItems, setHistoryItems] = React.useState<HistoryItem[]>([])
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false)
  const [hasWebGPU, setHasWebGPU] = React.useState<boolean | null>(null)
  const [cachedModelCount, setCachedModelCount] = React.useState<number | null>(null)

  // Refresh history items
  const refreshHistory = React.useCallback(async () => {
    try {
      const items = await getHistory()
      setHistoryItems(items.slice(0, 5))
    } catch {
      // ignore
    }
  }, [])

  React.useEffect(() => {
    const openSheet = () => setDiagnosticsOpen(true)
    window.addEventListener("open-diagnostics", openSheet)
    return () => window.removeEventListener("open-diagnostics", openSheet)
  }, [])

  React.useEffect(() => {
    refreshHistory()
    const interval = setInterval(refreshHistory, 3000)
    return () => clearInterval(interval)
  }, [refreshHistory])

  // How many models are on disk. Re-read on navigation, because the manager is
  // the one page that changes it — a stale badge there would be the only place
  // the number is actually being looked at.
  React.useEffect(() => {
    let stale = false
    countCachedModels()
      .then((n) => {
        if (!stale) setCachedModelCount(n)
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [currentPath])

  // Detect WebGPU
  React.useEffect(() => {
    if (typeof navigator !== "undefined" && "gpu" in navigator && navigator.gpu) {
      navigator.gpu.requestAdapter().then((adapter) => {
        setHasWebGPU(!!adapter)
      }).catch(() => setHasWebGPU(false))
    } else {
      setHasWebGPU(false)
    }
  }, [])

  if (!leftOpen) return null

  return (
    <>
      {/* Tapping away is how a drawer is dismissed on a phone; without this the
          only way out is the header toggle hidden behind the drawer. */}
      {isNarrow && (
        <div
          className="fixed inset-0 z-40 bg-scrim backdrop-blur-sm"
          onClick={() => setLeftOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        aria-label="Sidebar"
        className={cn(
          // py-2 mirrors the inset main panel's my-2 so the two content
          // boxes start and end on the same lines. This is what shadcn's
          // sidebar-08 does with variant="inset": the sidebar gets p-2 and the
          // SidebarInset gets m-2, so neither is flush to the window and the
          // header rows sit at the same y. Without it the three header rows
          // here began at 0, 8 and 0 and were 40, 44 and 44 tall — three
          // baselines, no two of which agreed.
          "relative w-64 shrink-0 h-svh flex flex-col bg-background text-sidebar-foreground select-none",
          // Narrow: float above the editor instead of taking its width, which
          // is what crushed main to zero pixels.
          // bg-surface-1 rather than the bg-background alongside it: that
          // utility emits no CSS (no @theme maps the token), so the drawer was
          // transparent and the page was legible straight through it. Harmless
          // while the sidebar is docked beside the content and the body paints
          // the same colour underneath; not harmless floating above it.
          // py-2 is the sidebar-08 inset rhythm, and it only makes sense while
          // the sidebar is docked next to the inset main panel. On a drawer it
          // leaves an 8px gap at the top and bottom so the panel visibly fails
          // to reach the screen edges.
          isNarrow
            ? "fixed inset-y-0 left-0 z-50 bg-surface-1 shadow-surface-4"
            : "sticky top-0 py-2 z-0"
        )}
      >
      {/* ─── Header: Fluid Functionalism Rhythm (24px buttons, gap-1, pr-1.5) ─── */}
      <div className="flex items-center gap-1 px-2 pr-1.5 h-11 shrink-0">
        <Link to="/" className="min-w-0 flex-1 flex items-center gap-2 pl-1.5 group">
          <div className="size-6 rounded-md bg-surface-4 text-foreground flex items-center justify-center shadow-surface-2 shrink-0 transition-colors duration-80 group-hover:bg-surface-5">
            <Scissors className="size-3.5" />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-semibold text-[13px] tracking-tight text-foreground truncate">
              remove.free
            </span>
            <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-surface-3 text-muted-foreground font-medium">
              V1
            </span>
          </div>
        </Link>

        {/* Action cluster on 26px/28px column rhythm */}
        <div className="flex items-center gap-1">
          {/* Quick Search */}
          <Tooltip
            content={
              <span>
                Search <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
              </span>
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon-compact"
              onClick={() => setSearchOpen(true)}
              className="size-6 rounded-md hover:bg-hover active:bg-active active:scale-95 transition-all duration-80 text-muted-foreground hover:text-foreground shrink-0"
            >
              <Search className="size-3.5" />
              <span className="sr-only">Quick Search</span>
            </Button>
          </Tooltip>

          <ThemeToggle />

          {/* Add New / Upload */}
          <Tooltip
            content={
              <span>
                New Upload <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">⇧⌘N</kbd>
              </span>
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon-compact"
              onClick={triggerUpload}
              className="size-6 rounded-md hover:bg-hover active:bg-active active:scale-95 transition-all duration-80 text-muted-foreground hover:text-foreground shrink-0"
            >
              <Plus className="size-3.5" />
              <span className="sr-only">Upload Image</span>
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* ─── Scrollable Navigation ─── */}
      <ScrollArea className="flex-1 min-h-0" viewportClassName="px-2 py-2 [&>div]:space-y-4">
        {/* Create: where work happens */}
        <div>
          <div className="px-2 pb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            <span>Create</span>
            <span className="text-[10px] font-mono">{WORKSPACE_COUNT}</span>
          </div>
          <nav aria-label="Create" className="space-y-0.5">
            <SidebarItem
              to="/"
              active={currentPath === "/"}
              icon={<Sparkles className="size-4" />}
              label="AI Studio"
              badge="GPU"
            />
            <SidebarItem
              to="/batch"
              active={currentPath === "/batch"}
              icon={<Layers className="size-4" />}
              label="Batch Queue"
              badge="ZIP"
            />
            <SidebarItem
              to="/video"
              active={currentPath === "/video"}
              icon={<Film className="size-4" />}
              label="Video Cutout"
              badge="WEBM"
            />
            <SidebarItem
              to="/webcam"
              active={currentPath === "/webcam"}
              icon={<Video className="size-4" />}
              label="Live Camera"
              badge="RT"
            />
          </nav>
        </div>

        {/* Explore: measure and play */}
        <div>
          <div className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            <span>Explore</span>
          </div>
          <nav aria-label="Explore" className="space-y-0.5">
            <SidebarItem
              to="/bench"
              active={currentPath === "/bench"}
              icon={<Gauge className="size-4" />}
              label="Model Bench"
              badge="Test"
            />
            <SidebarItem
              to="/depth"
              active={currentPath === "/depth"}
              icon={<Mountain className="size-4" />}
              label="Depth Maps"
              badge="3D"
            />
          </nav>
        </div>

        {/* Library & system */}
        <div>
          <div className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
            <span>Library & System</span>
          </div>
          <nav aria-label="Library and system" className="space-y-0.5">
            <SidebarItem
              to="/history"
              active={currentPath === "/history"}
              icon={<HistoryIcon className="size-4" />}
              label="Vault History"
              badge={historyItems.length > 0 ? String(historyItems.length) : undefined}
            />
            <SidebarItem
              to="/models"
              active={currentPath === "/models"}
              icon={<HardDrive className="size-4" />}
              label="Model Storage"
              badge={cachedModelCount !== null ? String(cachedModelCount) : undefined}
            />
            <SidebarItem
              to="/agent"
              active={currentPath === "/agent"}
              icon={<Terminal className="size-4" />}
              label="Agent & API"
              badge="Auto"
            />
            <button
              onClick={() => setDiagnosticsOpen(true)}
              className="w-full flex items-center justify-between px-2.5 h-8 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-hover active:bg-active transition-all duration-80"
            >
              <span className="flex items-center gap-2.5">
                <Cpu className="size-4" />
                <span>Engine Diagnostics</span>
              </span>
              <span className="text-[10px] font-mono text-ok">Ready</span>
            </button>
            <button
              onClick={() => window.dispatchEvent(new Event("start-tour"))}
              className="w-full flex items-center justify-between px-2.5 h-8 rounded-lg text-[13px] text-muted-foreground hover:text-foreground hover:bg-hover active:bg-active transition-all duration-80"
            >
              <span className="flex items-center gap-2.5">
                <Sparkles className="size-4" />
                <span>Guided Tour</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-surface-2 text-muted-foreground">
                6 steps
              </span>
            </button>
          </nav>
        </div>

        {/* Recent Cutouts Mini Feed */}
        {historyItems.length > 0 && (
          <div>
            <div className="px-2 pb-1.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground tracking-wider uppercase">
              <span>Recent Cutouts</span>
              <button
                onClick={async () => {
                  if (confirm("Clear recent history?")) {
                    await clearHistory()
                    refreshHistory()
                  }
                }}
                className="text-[10px] text-muted-foreground hover:text-destructive active:scale-90 transition-all duration-80"
                title="Clear history"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
            <div className="space-y-1">
              {historyItems.map((item) => (
                <Link
                  key={item.id}
                  to="/"
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-hover active:bg-active active:scale-[0.98] transition-all duration-80 text-[12px] text-foreground/80 hover:text-foreground group"
                >
                  <div className="size-6 rounded bg-surface-2 overflow-hidden shrink-0">
                    <img
                      src={item.dataUrl}
                      alt={item.name}
                      className="size-full object-cover"
                    />
                  </div>
                  <span className="truncate flex-1">{item.name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                    {item.width}×{item.height}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Engine diagnostics lives in Library & System now; the footer
            badge below is its other door. */}
      </ScrollArea>

      {/* ─── Footer: Hardware status badge ─── */}
      <div className="p-2 shrink-0">
        {/* A button, not a div: this opens the diagnostics sheet, and as a div
            it was unreachable by keyboard. */}
        <button
          type="button"
          onClick={() => setDiagnosticsOpen(true)}
          aria-expanded={diagnosticsOpen}
          className="w-full text-left flex items-center gap-2.5 p-2 rounded-xl bg-surface-2/80 hover:bg-surface-3 active:scale-[0.98] cursor-pointer transition-all duration-80 shadow-surface-1"
        >
          <div className="size-6 rounded-md bg-ok/10 text-ok flex items-center justify-center shrink-0">
            <Cpu className="size-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-foreground truncate">
                {hasWebGPU ? "Neural Engine (GPU)" : "Neural Engine (CPU)"}
              </span>
              <CheckCircle2 className="size-3 text-ok shrink-0" />
            </div>
            <p className="text-[10px] text-muted-foreground truncate">
              100% Private · Zero Server Uploads
            </p>
          </div>
        </button>
      </div>

      <DiagnosticsDialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />
      </aside>
    </>
  )
}

function SidebarItem({
  to,
  active,
  icon,
  label,
  badge,
}: {
  to: string
  active: boolean
  icon: React.ReactNode
  label: string
  badge?: string
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center justify-between px-2.5 h-8 rounded-lg text-[13px] transition-[background-color,color] duration-80 outline-none select-none",
        active
          ? "bg-selected text-foreground shadow-surface-2"
          : "text-muted-foreground hover:text-foreground hover:bg-hover active:bg-active active:scale-95 transition-all duration-80"
      )}
      style={{
        fontVariationSettings: active ? "'wght' 550, 'opsz' 18" : "'wght' 400, 'opsz' 14",
      }}
    >
      <span className="flex items-center gap-2.5 truncate">
        <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </span>
      {badge && (
        <span
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded-md",
            active
              ? "bg-surface-3 text-foreground shadow-surface-1"
              : "bg-surface-2 text-muted-foreground"
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  )
}
