import * as React from "react"
import { Link2, Download, Upload, Check, AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  download,
  isRecipeFile,
  readRecipeFile,
  toShareLink,
} from "@/lib/recipe/share"
import { FILE_EXTENSION, type Recipe } from "@/lib/recipe/schema"

/**
 * Sending a treatment to someone, and receiving one.
 *
 * The loop Paperlab gets right and that almost no tool does: what you sculpted
 * should be passable to another person without either of you having an account,
 * and what they receive should be **editable rather than read-only**. A link
 * here opens a studio with your settings loaded and every control live.
 *
 * Nothing about it touches a server. The recipe rides in the URL fragment,
 * which by specification is never sent to the origin — so the static host this
 * is served from cannot see what was shared even in principle.
 */
export function RecipePanel({
  recipe,
  onLoad,
}: {
  recipe: Recipe
  onLoad: (recipe: Recipe, warnings: string[]) => void
}) {
  const [copied, setCopied] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileRef = React.useRef<HTMLInputElement>(null)

  const copyLink = async () => {
    setError(null)
    try {
      await navigator.clipboard.writeText(toShareLink(recipe))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("The browser refused clipboard access")
    }
  }

  const take = async (file: File) => {
    setError(null)
    if (!isRecipeFile(file)) {
      setError(`That is not a ${FILE_EXTENSION} file`)
      return
    }
    const result = await readRecipeFile(file)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onLoad(result.recipe, result.warnings)
  }

  return (
    <div
      className="pt-3 space-y-2"
      // Drop anywhere on the panel, not only on a button. A recipe arriving as
      // a file from a chat app is the common case and hunting for a target is
      // not what anyone wants to do with it.
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files?.[0]
        if (file) void take(file)
      }}
    >
      <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider block">
        Recipe
      </label>

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          variant="secondary"
          size="compact"
          onClick={() => void copyLink()}
          className="gap-1.5 text-[11px] h-7"
        >
          {copied ? <Check className="size-3 text-ok" /> : <Link2 className="size-3" />}
          {copied ? "Copied" : "Share link"}
        </Button>
        <Button
          variant="secondary"
          size="compact"
          onClick={() => download(recipe)}
          className="gap-1.5 text-[11px] h-7"
        >
          <Download className="size-3" />
          Save
        </Button>
      </div>

      <Button
        variant="ghost"
        size="compact"
        onClick={() => fileRef.current?.click()}
        className="w-full gap-1.5 text-[11px] h-7"
      >
        <Upload className="size-3" />
        Open a {FILE_EXTENSION}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept={FILE_EXTENSION}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void take(file)
          e.target.value = ""
        }}
      />

      {error && (
        <p className="flex items-start gap-1.5 text-[10px] leading-snug text-warn">
          <AlertTriangle className="size-3 shrink-0 mt-px" />
          {error}
        </p>
      )}

      <p className="text-[10px] leading-snug text-muted-foreground">
        A treatment, not a picture — the model, the subject, the backdrop and the
        effects. Point it at your own photo and it applies the same look. Drop a{" "}
        {FILE_EXTENSION} anywhere on this panel to load one.
      </p>
    </div>
  )
}
