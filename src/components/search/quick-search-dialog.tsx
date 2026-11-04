import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useNavigate } from "@tanstack/react-router"
import { Search, Sparkles, Image as ImageIcon, Layers, Terminal, History, Palette, Download, Copy, Cpu, ArrowRight, X, Film, Video, Gauge } from "lucide-react"
import { spring } from "@/lib/springs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useSidebarLayout } from "@/components/layout/sidebar-layout-context"

interface SearchItem {
  id: string
  title: string
  subtitle?: string
  category: "Navigation" | "Sample Photos" | "Background Styles" | "Actions"
  icon: React.ReactNode
  /**
   * A CSS colour or gradient this row applies.
   *
   * Rendered as a filled swatch rather than a tinted glyph. Tinting the glyph
   * looked right in exactly one theme: `text-white` sat on a `bg-muted` tile
   * that is near-white in light mode, and `text-neutral-900` vanished the
   * moment the row was selected and the tile turned dark. A swatch carries its
   * own border, so it stays visible against anything.
   */
  swatch?: string
  action: () => void
  shortcut?: string
}

export function QuickSearchDialog({
  onSelectSample,
  onApplyBg,
}: {
  onSelectSample?: (url: string) => void
  onApplyBg?: (type: "transparent" | "color" | "gradient" | "blur", value?: string) => void
}) {
  const { searchOpen, setSearchOpen, triggerUpload, toggleLeft, toggleRight } = useSidebarLayout()
  const [query, setQuery] = React.useState("")
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  React.useEffect(() => {
    if (searchOpen) {
      setQuery("")
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [searchOpen])

  const items: SearchItem[] = React.useMemo(() => [
    // Navigation
    {
      id: "nav-studio",
      title: "AI Studio Playground",
      subtitle: "Single image background removal & split slider",
      category: "Navigation",
      icon: <Sparkles className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/" }); setSearchOpen(false) },
    },
    {
      id: "nav-batch",
      title: "Batch Processing Studio",
      subtitle: "Queue multiple images and export as ZIP",
      category: "Navigation",
      icon: <Layers className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/batch" }); setSearchOpen(false) },
    },
    {
      id: "nav-video",
      title: "Video Cutout",
      subtitle: "Per-frame matting with a transparent WebM export",
      category: "Navigation",
      icon: <Film className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/video" }); setSearchOpen(false) },
    },
    {
      id: "nav-webcam",
      title: "Live Camera",
      subtitle: "Real-time backdrop replacement from the webcam",
      category: "Navigation",
      icon: <Video className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/webcam" }); setSearchOpen(false) },
    },
    {
      id: "nav-bench",
      title: "Model Bench",
      subtitle: "Time every model on this device and pick one on evidence",
      category: "Navigation",
      icon: <Gauge className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/bench" }); setSearchOpen(false) },
    },
    {
      id: "nav-agent",
      title: "Agent & API Hub",
      subtitle: "Option A browser automation & Option B CLI script",
      category: "Navigation",
      icon: <Terminal className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/agent" }); setSearchOpen(false) },
    },
    {
      id: "nav-history",
      title: "Vault History",
      subtitle: "View locally saved cutouts in IndexedDB",
      category: "Navigation",
      icon: <History className="size-4 text-muted-foreground" />,
      action: () => { navigate({ to: "/history" }); setSearchOpen(false) },
    },
    // Samples
    {
      id: "sample-sneakers",
      title: "Sample: Red Nike Sneakers",
      subtitle: "Complex contours and lace detail",
      category: "Sample Photos",
      icon: <ImageIcon className="size-4 text-muted-foreground" />,
      action: () => {
        onSelectSample?.("https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1000")
        setSearchOpen(false)
      },
    },
    {
      id: "sample-portrait",
      title: "Sample: Studio Portrait",
      subtitle: "Fine hair strands and soft lighting",
      category: "Sample Photos",
      icon: <ImageIcon className="size-4 text-pink-400" />,
      action: () => {
        onSelectSample?.("https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=1000")
        setSearchOpen(false)
      },
    },
    {
      id: "sample-dog",
      title: "Sample: Golden Retriever",
      subtitle: "Fur boundary and flower stems",
      category: "Sample Photos",
      icon: <ImageIcon className="size-4 text-muted-foreground" />,
      action: () => {
        onSelectSample?.("https://images.unsplash.com/photo-1552053831-71594a27632d?w=1000")
        setSearchOpen(false)
      },
    },
    {
      id: "sample-car",
      title: "Sample: Porsche Sports Car",
      subtitle: "Reflective surfaces and windshield alpha",
      category: "Sample Photos",
      icon: <ImageIcon className="size-4 text-muted-foreground" />,
      action: () => {
        onSelectSample?.("https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=1000")
        setSearchOpen(false)
      },
    },
    // Background Styles
    {
      id: "bg-transparent",
      title: "Apply: Transparent PNG Checkerboard",
      subtitle: "Zero background, pure alpha cutout",
      category: "Background Styles",
      icon: <Palette className="size-4" />,
      swatch:
        "repeating-conic-gradient(#d4d4d8 0% 25%, #ffffff 0% 50%) 50% / 8px 8px",
      action: () => { onApplyBg?.("transparent"); setSearchOpen(false) },
    },
    {
      id: "bg-white",
      title: "Apply: Pure Studio White (#ffffff)",
      subtitle: "Clean e-commerce product backdrop",
      category: "Background Styles",
      icon: <Palette className="size-4" />,
      swatch: "#ffffff",
      action: () => { onApplyBg?.("color", "#ffffff"); setSearchOpen(false) },
    },
    {
      id: "bg-obsidian",
      title: "Apply: Obsidian Black (#09090b)",
      subtitle: "Premium dark product studio",
      category: "Background Styles",
      icon: <Palette className="size-4" />,
      swatch: "#09090b",
      action: () => { onApplyBg?.("color", "#09090b"); setSearchOpen(false) },
    },
    {
      id: "bg-sunset",
      title: "Apply: Sunset Glow Gradient",
      subtitle: "Warm amber to coral transition",
      category: "Background Styles",
      icon: <Palette className="size-4" />,
      swatch: "linear-gradient(135deg, #f97316 0%, #ec4899 100%)",
      action: () => { onApplyBg?.("gradient", "linear-gradient(135deg, #f97316 0%, #ec4899 100%)"); setSearchOpen(false) },
    },
    {
      id: "bg-bokeh",
      title: "Apply: Aperture Bokeh Blur",
      subtitle: "Shallow depth of field blur behind subject",
      category: "Background Styles",
      icon: <Palette className="size-4 text-muted-foreground" />,
      action: () => { onApplyBg?.("blur"); setSearchOpen(false) },
    },
    // Actions
    {
      id: "action-upload",
      title: "Upload New Photo",
      subtitle: "Select image file from computer",
      category: "Actions",
      icon: <ImageIcon className="size-4 text-primary" />,
      action: () => { triggerUpload(); setSearchOpen(false) },
      shortcut: "⇧⌘N",
    },
    {
      id: "action-toggle-left",
      title: "Toggle Left Navigation Sidebar",
      subtitle: "Show or hide the main workspace sidebar",
      category: "Actions",
      icon: <Layers className="size-4 text-muted-foreground" />,
      action: () => { toggleLeft(); setSearchOpen(false) },
      shortcut: "[",
    },
    {
      id: "action-toggle-right",
      title: "Toggle Right Studio Controls",
      subtitle: "Show or hide the background & tuning sidebar",
      category: "Actions",
      icon: <Palette className="size-4 text-muted-foreground" />,
      action: () => { toggleRight(); setSearchOpen(false) },
      shortcut: "]",
    },
  ], [navigate, onApplyBg, onSelectSample, setSearchOpen, toggleLeft, toggleRight, triggerUpload])

  const filteredItems = React.useMemo(() => {
    if (!query.trim()) return items
    const q = query.toLowerCase()
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subtitle?.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
    )
  }, [items, query])

  // Handle arrow keys and enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredItems.length))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % Math.max(1, filteredItems.length))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = filteredItems[selectedIndex]
      if (item) item.action()
    } else if (e.key === "Escape") {
      setSearchOpen(false)
    }
  }

  return (
    <AnimatePresence>
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: spring.fast.exit }}
            transition={spring.fast}
            onClick={() => setSearchOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 bg-scrim backdrop-blur-sm"
          />

          {/* Modal Box */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8, transition: spring.fast.exit }}
            transition={spring.moderate}
            // Without these it was a modal in appearance only: nothing
            // announced it as a dialog, and axe's `region` rule fired on its
            // contents because they sat in no landmark and no dialog.
            role="dialog"
            aria-modal="true"
            aria-label="Quick search"
            // Surface ladder and shadow ladder, like every other raised
            // element. bg-popover/95 + shadow-2xl were the two tokens this
            // component had invented for itself: the first is a shadcn colour
            // the rest of the app does not use, the second is a Tailwind
            // preset outside the 1-8 shadow scale.
            className="relative w-full max-w-xl rounded-2xl bg-surface-2 shadow-surface-4 backdrop-blur-xl overflow-hidden flex flex-col z-10"
            onKeyDown={handleKeyDown}
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
              <Search className="size-5 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                placeholder="Type a command, search cutouts, sample photos, or background styles..."
                className="w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
                // Arrow keys already moved the highlight, but nothing told a
                // screen reader that the highlight existed. These four
                // attributes are what turn a styled div list into a listbox
                // the input is driving.
                role="combobox"
                aria-expanded
                aria-controls="quick-search-results"
                aria-activedescendant={
                  filteredItems[selectedIndex]
                    ? `quick-search-option-${filteredItems[selectedIndex].id}`
                    : undefined
                }
                aria-autocomplete="list"
                aria-label="Search commands and photos"
              />
              <button
                type="button"
                aria-label="Close search"
                onClick={() => setSearchOpen(false)}
                className="size-6 shrink-0 rounded-md hover:bg-hover active:bg-active flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors duration-80"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Results List */}
            <ScrollArea
              className="max-h-[380px]"
              viewportClassName="p-2 [&>div]:space-y-1"
              viewportProps={{
                id: "quick-search-results",
                role: "listbox",
                "aria-label": "Results",
              }}
            >
              {filteredItems.length === 0 ? (
                <div role="status" className="py-12 text-center text-[13px] text-muted-foreground">
                  No matching commands or photos found for "{query}"
                </div>
              ) : (
                filteredItems.map((item, idx) => {
                  const isSelected = idx === selectedIndex
                  return (
                    <div
                      key={item.id}
                      id={`quick-search-option-${item.id}`}
                      role="option"
                      aria-selected={isSelected}
                      onClick={item.action}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      // bg-selected, not bg-primary. Primary is an inverted
                      // slab — rgb(184,184,184) on a near-black dialog — which
                      // is the harsh selection treatment this design system
                      // deliberately avoids. --selected is #D4D4D4 / #525252:
                      // a step away from the surface, in the same direction as
                      // every other raised element.
                      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-colors duration-80 text-foreground ${
                        isSelected ? "bg-selected" : "hover:bg-hover"
                      }`}
                    >
                      {item.swatch ? (
                        <span
                          aria-hidden="true"
                          className="size-7 rounded-lg shrink-0 border border-border/70 shadow-surface-1"
                          style={{ background: item.swatch }}
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="size-7 rounded-lg flex items-center justify-center shrink-0 bg-muted text-muted-foreground"
                        >
                          {item.icon}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium truncate">
                            {item.title}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono bg-muted text-muted-foreground">
                            {item.category}
                          </span>
                        </div>
                        {item.subtitle && (
                          <p
                            className={`text-[11px] truncate mt-0.5 ${
                              // muted-foreground only carries 3.2:1 against
                              // --selected; a dimmed foreground carries 7.4.
                              isSelected ? "text-foreground/75" : "text-muted-foreground"
                            }`}
                          >
                            {item.subtitle}
                          </p>
                        )}
                      </div>
                      {item.shortcut ? (
                        <kbd className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-muted text-muted-foreground border border-border/50">
                          {item.shortcut}
                        </kbd>
                      ) : (
                        <ArrowRight
                          className={`size-3.5 opacity-0 group-hover:opacity-100 transition-opacity ${
                            isSelected ? "opacity-100 text-foreground" : "text-muted-foreground"
                          }`}
                        />
                      )}
                    </div>
                  )
                })
              )}
            </ScrollArea>

            {/* Footer hints */}
            <div className="flex items-center justify-between px-4 py-2 bg-surface-3 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-surface-4 rounded shadow-surface-1">↑</kbd>
                  <kbd className="px-1 py-0.5 bg-surface-4 rounded shadow-surface-1">↓</kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1 py-0.5 bg-surface-4 rounded shadow-surface-1">↵</kbd>
                  to select
                </span>
              </div>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-surface-4 rounded shadow-surface-1">esc</kbd>
                to close
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
