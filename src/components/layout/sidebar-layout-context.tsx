import * as React from "react"

/**
 * Below this width both sidebars would leave nothing for the editor.
 *
 * They are 256px and 288px and both `shrink-0`, so on a 375px phone the main
 * element measured **0 pixels wide** — the app was not awkward on mobile, it was
 * unreachable. Above this they sit in the layout; below it they become overlays
 * and start closed.
 */
export const SIDEBAR_OVERLAY_BREAKPOINT = 1024

interface SidebarLayoutContextValue {
  leftOpen: boolean
  setLeftOpen: (open: boolean) => void
  toggleLeft: () => void
  rightOpen: boolean
  setRightOpen: (open: boolean) => void
  toggleRight: () => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  /** True when the viewport is too narrow for sidebars to share space. */
  isNarrow: boolean
  triggerUpload: () => void
  setUploadHandler: (handler: () => void) => void
}

const SidebarLayoutContext = React.createContext<SidebarLayoutContextValue | null>(null)

export function SidebarLayoutProvider({ children }: { children: React.ReactNode }) {
  // Start from the real viewport rather than assuming desktop, so a phone never
  // renders the broken state even for one frame.
  const initialNarrow =
    typeof window !== "undefined" && window.innerWidth < SIDEBAR_OVERLAY_BREAKPOINT

  const [isNarrow, setIsNarrow] = React.useState(initialNarrow)
  const [leftOpen, setLeftOpen] = React.useState(!initialNarrow)
  const [rightOpen, setRightOpen] = React.useState(!initialNarrow)

  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${SIDEBAR_OVERLAY_BREAKPOINT - 1}px)`)
    const apply = (narrow: boolean) => {
      setIsNarrow(narrow)
      // Closing on the way down is the point. Re-opening on the way up restores
      // the desktop layout someone just widened the window to get back.
      setLeftOpen(!narrow)
      setRightOpen(!narrow)
    }
    apply(mq.matches)
    const onChange = (e: MediaQueryListEvent) => apply(e.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  const [searchOpen, setSearchOpen] = React.useState(false)
  const uploadHandlerRef = React.useRef<() => void>(() => {})

  const toggleLeft = React.useCallback(() => setLeftOpen((prev) => !prev), [])
  const toggleRight = React.useCallback(() => setRightOpen((prev) => !prev), [])
  
  const setUploadHandler = React.useCallback((handler: () => void) => {
    uploadHandlerRef.current = handler
  }, [])

  const triggerUpload = React.useCallback(() => {
    uploadHandlerRef.current()
  }, [])

  // Latest drawer state, for the keydown listener below to read without
  // having to be torn down and re-registered whenever it changes.
  const drawerState = React.useRef({ narrow: initialNarrow, left: !initialNarrow, right: !initialNarrow })
  drawerState.current = { narrow: isNarrow, left: leftOpen, right: rightOpen }

  // Keyboard shortcut listener
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger when inside inputs or textareas
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        if (e.key === "Escape") {
          setSearchOpen(false)
        }
        return
      }

      // Quick Search: ⌘K or Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
        return
      }

      // Add New / Upload: ⇧⌘N or Shift+Ctrl+N or ⌘O
      if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "n") ||
          ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o")) {
        e.preventDefault()
        triggerUpload()
        return
      }

      // Escape closes whichever drawer is open on a narrow viewport.
      //
      // On a phone a drawer covers the screen and the header toggle that opened
      // it sits behind it, so tapping the scrim was the only way out — and a
      // scrim is a pointer-only affordance. Escape is what closes an overlay.
      //
      // Read through a ref rather than closing over the state: this listener is
      // registered once, and adding three values to the dependency array
      // resubscribes it on every sidebar toggle.
      if (e.key === "Escape" && drawerState.current.narrow) {
        if (drawerState.current.left || drawerState.current.right) {
          e.preventDefault()
          setLeftOpen(false)
          setRightOpen(false)
          return
        }
      }

      // Left sidebar: ⌘B as well as [.
      //
      // ⌘B is what shadcn's own SidebarProvider binds, so anyone arriving from
      // a shadcn app reaches for it first. The bracket keys stay because they
      // are a pair — [ and ] for the two sides — which ⌘B alone cannot express.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault()
        toggleLeft()
        return
      }

      // Left Sidebar toggle: [
      if (e.key === "[" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleLeft()
        return
      }

      // Right Sidebar toggle: ]
      if (e.key === "]" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        toggleRight()
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [toggleLeft, toggleRight, triggerUpload])

  return (
    <SidebarLayoutContext.Provider
      value={{
        leftOpen,
        setLeftOpen,
        toggleLeft,
        rightOpen,
        setRightOpen,
        toggleRight,
        searchOpen,
        setSearchOpen,
        isNarrow,
        triggerUpload,
        setUploadHandler,
      }}
    >
      {children}
    </SidebarLayoutContext.Provider>
  )
}

export function useSidebarLayout() {
  const context = React.useContext(SidebarLayoutContext)
  if (!context) {
    throw new Error("useSidebarLayout must be used within a SidebarLayoutProvider")
  }
  return context
}
