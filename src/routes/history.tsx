import * as React from "react"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  History as HistoryIcon,
  Trash2,
  Download,
  Copy,
  Check,
  ArrowRight,
  HardDrive,
  Link2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { parseRecipe } from "@/lib/recipe/schema"
import { toShareLink } from "@/lib/recipe/share"
import { Badge } from "@/components/ui/badge"
import { WormholeView } from "@/components/wormhole/wormhole-view"
import { CardGroup, Card } from "@/components/ui/card"
import {
  getHistory,
  deleteHistoryItem,
  clearAllHistory,
  type HistoryItem,
} from "@/lib/history-store"

export const Route = createFileRoute("/history")({
  component: HistoryPage,
})

function HistoryPage() {
  const [tab, setTab] = React.useState<"vault" | "wormhole">("vault")
  const [items, setItems] = React.useState<HistoryItem[]>([])
  const [linkedId, setLinkedId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [copiedId, setCopiedId] = React.useState<string | null>(null)

  const loadItems = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await getHistory()
      setItems(data)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadItems()
  }, [loadItems])

  const handleDelete = async (id: string) => {
    await deleteHistoryItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to clear your local cutout history?")) {
      await clearAllHistory()
      setItems([])
    }
  }

  const handleCopy = async (item: HistoryItem) => {
    try {
      const res = await fetch(item.dataUrl)
      const blob = await res.blob()
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ])
      setCopiedId(item.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (e) {
      console.error("Failed to copy:", e)
    }
  }

  /**
   * Share the treatment, not the picture.
   *
   * A vault entry holds both; only the recipe travels. Sending the image would
   * be a different feature and a much worse default — this is someone's photo.
   */
  const handleShareRecipe = async (item: HistoryItem) => {
    const parsed = parseRecipe(item.recipe)
    if (!parsed.ok) return
    try {
      await navigator.clipboard.writeText(toShareLink(parsed.recipe))
      setLinkedId(item.id)
      window.setTimeout(() => setLinkedId(null), 2000)
    } catch {
      // Clipboard refused; the Save button is still there.
    }
  }

  const handleDownload = (item: HistoryItem) => {
    const a = document.createElement("a")
    a.href = item.dataUrl
    a.download = `${item.name}-no-bg.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto w-full p-4 md:p-6 select-none">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4.5 rounded-2xl bg-surface-2 shadow-surface-1">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <HistoryIcon className="size-5 text-foreground" />
              Vault History
            </h1>
            <Badge variant="secondary" dot={true} className="text-[10px]">
              Local IndexedDB
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Cutouts generated in your current browser session. Stored strictly in your browser storage.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {items.length > 0 && tab === "vault" && (
            <Button
              variant="outline"
              size="compact"
              onClick={handleClearAll}
              className="gap-1.5 text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" /> Clear All History
            </Button>
          )}
        </div>
      </div>

      {/* Vault / Wormhole tabs: the Wormhole plays with the vault's
          cutouts, so it lives here now (its /wormhole route remains). */}
      <div className="flex gap-1" role="tablist" aria-label="Vault views">
        {(
          [
            ["vault", "Vault"],
            ["wormhole", "Wormhole"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors duration-80 " +
              (tab === id
                ? "bg-selected text-foreground"
                : "bg-surface-3 text-muted-foreground hover:text-foreground")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "wormhole" && <WormholeView />}
      {tab === "vault" && (
        <>

      {/* Grid or Empty State */}
      {items.length === 0 ? (
        <div className="rounded-2xl p-12 text-center flex flex-col items-center justify-center space-y-3 bg-surface-2/60 shadow-surface-1">
          <div className="size-12 rounded-xl bg-surface-3 flex items-center justify-center text-foreground shadow-surface-1">
            <HardDrive className="size-6" />
          </div>
          <h2 className="text-base font-semibold text-foreground">
            No cutouts in history yet
          </h2>
          <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
            When you remove backgrounds in AI Studio, your transparent cutouts are automatically saved here so you never lose your work.
          </p>
          <Button asChild size="compact" variant="primary" className="mt-2">
            <Link to="/" search={{}} className="gap-1.5">
              Open AI Studio <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      ) : (
        <CardGroup axis="xy" className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((item, idx) => (
            <Card
              key={item.id}
              index={idx}
              className="p-0 overflow-hidden flex flex-col transition-all group shadow-surface-1"
            >
              {/* Thumbnail with checkerboard background */}
              <div className="relative aspect-square w-full bg-checkered overflow-hidden flex items-center justify-center p-3">
                <img
                  src={item.dataUrl}
                  alt={item.name}
                  className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-160"
                />
              </div>

              {/* Card Meta & Actions */}
              <div className="p-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-xs truncate text-foreground">
                      {item.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono">
                      {item.width}×{item.height} · {item.duration}s
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors"
                    title="Delete item"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 pt-1">
                  <Button
                    variant="outline"
                    size="compact"
                    onClick={() => handleCopy(item)}
                    className="flex-1 text-[11px] h-7 gap-1"
                  >
                    {copiedId === item.id ? (
                      <>
                        <Check className="size-3 text-ok" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="size-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="secondary"
                    size="compact"
                    onClick={() => handleDownload(item)}
                    className="flex-1 text-[11px] h-7 gap-1"
                  >
                    <Download className="size-3" />
                    <span>Save</span>
                  </Button>
                </div>

                {/* The treatment that produced it. Entries saved before the
                    vault recorded one simply do not offer this. */}
                {item.recipe != null && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onClick={() => handleShareRecipe(item)}
                    className="w-full text-[11px] h-7 gap-1"
                  >
                    {linkedId === item.id ? (
                      <>
                        <Check className="size-3 text-ok" />
                        <span>Link copied</span>
                      </>
                    ) : (
                      <>
                        <Link2 className="size-3" />
                        <span>Share this treatment</span>
                      </>
                    )}
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </CardGroup>
      )}
        </>
      )}
    </div>
  )
}
