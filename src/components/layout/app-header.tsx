import { useState } from "react"
import {
  PanelLeft,
  PanelRight,
  Copy,
  Download,
  Check,
} from "lucide-react"
import { useSidebarLayout } from "@/components/layout/sidebar-layout-context"
import { useStudio } from "@/components/studio/studio-context"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { fontWeights } from "@/lib/font-weight"
import { useRouterState } from "@tanstack/react-router"
import { useRightSidebarPanel } from "./right-sidebar"
import { BackgroundStrip } from "@/components/studio/background-strip"

interface AppHeaderProps {
  onDownloadCutout?: () => void
  onCopyCutout?: () => void
  hasCutout?: boolean
}

/** The four "create" pages share one backdrop in the header. */
const CREATE_ROUTES = ["/", "/video", "/webcam", "/batch"]

const PAGE_TITLES: Record<string, string> = {
  "/batch": "Batch Studio",
  "/video": "Video Cutout",
  "/webcam": "Live Camera",
  "/agent": "Agent & API",
  "/history": "Vault History",
  "/bench": "Model Bench",
  "/models": "Model Storage",
  "/wormhole": "Wormhole",
  "/depth": "Depth Maps",
}

export function AppHeader({
  onDownloadCutout,
  onCopyCutout,
  hasCutout: hasCutoutProp,
}: AppHeaderProps) {
  const { leftOpen, rightOpen, toggleLeft, toggleRight } = useSidebarLayout()
  // Any route with a panel gets the toggle, not just the studio.
  const { hasPanel, title: panelTitle } = useRightSidebarPanel()
  const studio = useStudio()
  // The root renders <AppHeader /> bare, so the studio context is the source;
  // the old `= false` default left Copy and Download permanently disabled.
  const hasCutout = hasCutoutProp ?? studio.hasCutout
  const routerState = useRouterState()
  const pathname = routerState.location.pathname

  const [copied, setCopied] = useState(false)
  // A table rather than a chain of ifs, and the fallback is the path instead of
  // "Studio". The old fallback meant a route added without a title here read as
  // Studio in the breadcrumb — which is exactly what /models did.
  const getPageTitle = () => {
    if (pathname === "/") return "Studio"
    for (const [prefix, title] of Object.entries(PAGE_TITLES)) {
      if (pathname.startsWith(prefix)) return title
    }
    return pathname.replace(/^\//, "")
  }

  const pageTitle = getPageTitle()

  const handleCopy = () => {
    if (onCopyCutout) {
      onCopyCutout()
    } else if (studio.onCopy) {
      studio.onCopy()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = () => {
    if (onDownloadCutout) {
      onDownloadCutout()
    } else if (studio.onDownload) {
      studio.onDownload()
    }
  }

  return (
    <header className="min-h-11 bg-background px-3 py-0.5 flex items-center justify-between gap-3 shrink-0 z-10 select-none">
      {/* ─── Left Section: Left Sidebar Toggle & Breadcrumbs ─── */}
      <div className="flex items-center gap-2 min-w-0">
        <Tooltip
          content={
            <span>
              {leftOpen ? "Collapse Left Sidebar" : "Expand Left Sidebar"}{" "}
              <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">[</kbd>
            </span>
          }
          side="bottom"
        >
          <Button
            variant="ghost"
            size="icon-compact"
            onClick={toggleLeft}
            className="size-6 rounded-md text-muted-foreground hover:text-foreground shrink-0"
          >
            <PanelLeft className="size-3.5" />
            <span className="sr-only">Toggle Left Sidebar</span>
          </Button>
        </Tooltip>

        {/* Backdrop controls live in the header now (the breadcrumb is
            gone — the sidebar already says where you are). Studio only:
            other routes keep their own top areas. */}
        {CREATE_ROUTES.includes(pathname) && pathname !== "/batch" ? (
          <div className="flex min-w-0 items-center overflow-hidden">
            <BackgroundStrip
              controls={studio.controls}
              onChange={(patch) =>
                studio.setControls((prev) => ({ ...prev, ...patch }))
              }
              onPickColor={
                pathname === "/"
                  ? () =>
                      studio.setControls((prev) => ({
                        ...prev,
                        pickColor: !prev.pickColor,
                        tool: "eyedropper",
                      }))
                  : undefined
              }
            />
          </div>
        ) : (
          <span
            className="text-foreground/90 font-medium truncate text-[13px]"
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {pageTitle}
          </span>
        )}
      </div>

      {/* Agent DOM contract: #status stays in the page for scripts and screen
          readers, but it is not drawn — the run chip in the file card shows
          size and time. */}
      <div id="status" className="sr-only" aria-live="polite">ready</div>

      {/* ─── Right Section: Action Cluster & Right Sidebar Toggle ─── */}
      <div className="flex items-center gap-1.5 shrink-0">
        {pathname === "/" && (
          <>
        {/* Copy Cutout */}
        <Tooltip content="Copy cutout to system clipboard" side="bottom">
          <Button
            variant="outline"
            size="compact"
            onClick={handleCopy}
            disabled={!hasCutout}
            className="h-6 text-[11px] px-2 gap-1 rounded-md"
          >
            {copied ? (
              <>
                <Check className="size-3 text-ok" />
                <span className="text-ok font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span>Copy</span>
              </>
            )}
          </Button>
        </Tooltip>

        {/* Download Cutout */}
        <Tooltip content="Save cutout with background" side="bottom">
          <Button
            variant="primary"
            size="compact"
            onClick={handleDownload}
            disabled={!hasCutout}
            className="h-6 text-[11px] px-2.5 gap-1 rounded-md font-medium"
          >
            <Download className="size-3" />
            <span>Download</span>
          </Button>
        </Tooltip>

          </>
        )}

        {/* Right Sidebar Toggle (Studio Controls - only on studio route) */}
        {hasPanel && (
          <Tooltip
            content={
              <span>
                {rightOpen ? `Collapse ${panelTitle ?? "panel"}` : `Expand ${panelTitle ?? "panel"}`}{" "}
                <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">]</kbd>
              </span>
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon-compact"
              onClick={toggleRight}
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
            >
              <PanelRight className="size-3.5" />
              <span className="sr-only">{`Toggle ${panelTitle ?? "panel"}`}</span>
            </Button>
          </Tooltip>
        )}
      </div>
    </header>
  )
}
