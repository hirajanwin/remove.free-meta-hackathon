/// <reference types="vite/client" />
import { Outlet, createRootRoute } from '@tanstack/react-router'
import * as React from 'react'
import { MotionConfig } from 'framer-motion'
import { SidebarLayoutProvider } from '@/components/layout/sidebar-layout-context'
import { StudioProvider } from '@/components/studio/studio-context'
import { ShapeProvider } from '@/lib/shape-context'
import { SizeProvider } from '@/lib/size-context'
import { IconProvider } from '@/lib/icon-context'
import { AppSidebar } from '@/components/layout/app-sidebar'
import { TopToolbar, ChatDock } from "@/components/studio/chrome"
import { AppHeader } from '@/components/layout/app-header'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RightSidebarProvider, RightSidebarShell } from '@/components/layout/right-sidebar'
import { StudioSidebar } from '@/components/layout/studio-sidebar'
import { QuickSearchDialog } from '@/components/search/quick-search-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'

// Static metadata (title, description, og:*, favicon, stylesheet) is declared in
// index.html instead of a head() here, so it is present in the served HTML
// rather than being applied after hydration.
export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <ShapeProvider defaultShape="rounded">
        <SizeProvider size="default">
          <IconProvider>
            <SidebarLayoutProvider>
              <RightSidebarProvider>
                <StudioProvider>
                  <TooltipProvider delayDuration={150}>
                    {/* ─── Base Substrate: Hosts Left & Right Sidebars in Same Plane ─── */}
                    <div className="relative flex w-full h-svh bg-background overflow-hidden">
                      {/* Left Sidebar (256px, Base Substrate) */}
                      <AppSidebar />

                      {/* ─── Central Inset Canvas: Elevated Floating Surface (Fluid Functionalism) ─── */}
                      <div className="flex flex-1 min-w-0 h-svh flex-col">
                      {/* Header sits on the base plane with the sidebars; only the page below is inset. */}
                      <AppHeader />
                      <TopToolbar />
                      <main className="relative flex flex-1 min-h-0 flex-col bg-surface-1 mb-2 rounded-2xl shadow-surface-3 overflow-hidden transition-all duration-240">
                        {/* The page scroller.
                            ScrollArea rather than a native overflow, so the
                            scrollbar matches the two sidebars instead of being
                            the one piece of OS chrome in the layout — and
                            because an overlay scrollbar takes no layout width,
                            which is what made the right sidebar's tab strip
                            reflow when a taller panel appeared.
                            tabIndex keeps it reachable, so a keyboard user can
                            scroll a page taller than the viewport. The ring is
                            inset: main clips its overflow, so the global
                            2px-outset outline was drawn and then cut off, which
                            is how this came to look like a silent tab stop. */}
                        <ScrollArea
                          className="flex-1 min-h-0"
                          // The ! matters. Radix's ScrollArea sets `display: table` as an inline
                          // style on its content div — that is how it measures content
                          // width — and an inline style beats a class, so a plain
                          // `[&>div]:flex` silently lost. The route then became a block
                          // child of a table and every `flex-1` inside it stopped
                          // filling the height. ui/sidebar.tsx already had `[&>div]:!block`
                          // for exactly this reason.
                          viewportClassName="outline-none focus-visible:outline-1 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--focus-ring,#6B97FF)] [&>div]:!flex [&>div]:!min-h-full [&>div]:!h-full [&>div]:!flex-col"
                          viewportProps={{ tabIndex: 0 }}
                        >
                          <Outlet />
                        </ScrollArea>
                      </main>
                      <ChatDock />
                      </div>

                      {/* Right sidebar chrome. Routes fill it via RightSidebarPanel;
                          it renders nothing when no route contributes one. */}
                      <RightSidebarShell />
                      <StudioSidebar />
                    </div>

                    {/* Quick Search Dialog (⌘K) */}
                    <QuickSearchDialog />

                    {/* Global System Diagnostics Dialog */}
                  </TooltipProvider>
                </StudioProvider>
              </RightSidebarProvider>
            </SidebarLayoutProvider>
          </IconProvider>
        </SizeProvider>
      </ShapeProvider>
    </MotionConfig>
  )
}
