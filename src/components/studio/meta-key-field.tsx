import * as React from "react"
import { KeyRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { setMetaKey, validateMetaKey, metaKeyRemembered } from "@/lib/meta"

/**
 * Inline Meta key entry for any page that wants an AI feature, so the key is
 * never a trip to another tab. Same storage policy as the studio's panel:
 * session only unless the user opts in, sent only to api.meta.ai.
 */
export function MetaKeyField({
  onSaved,
  hint,
}: {
  onSaved: () => void
  hint?: string
}) {
  const [value, setValue] = React.useState("")
  const [remember, setRemember] = React.useState(metaKeyRemembered())
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const save = async () => {
    const key = value.trim()
    if (!key || busy) return
    setBusy(true)
    setError(null)
    const check = await validateMetaKey(key)
    setBusy(false)
    if (!check.ok) {
      setError(check.error ?? "That key did not work.")
      return
    }
    setMetaKey(key, remember)
    setValue("")
    onSaved()
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex flex-1 min-w-0 items-center gap-1.5 h-7 rounded-md bg-surface-3 px-2">
          <KeyRound className="size-3 text-muted-foreground shrink-0" />
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder="Paste your Meta API key"
            aria-label="Meta API key"
            autoComplete="off"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>
        <Button
          size="compact"
          variant="primary"
          disabled={!value.trim() || busy}
          onClick={() => void save()}
          className="h-7 text-[11px]"
        >
          {busy ? "…" : "Save"}
        </Button>
      </div>
      <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        Remember on this device (otherwise it dies with the tab)
      </label>
      {error && <p className="text-[11px] text-warn">{error}</p>}
      <p className="text-[10px] leading-snug text-muted-foreground">
        {hint ??
          "The key stays in this browser and goes only to api.meta.ai. Get one at dev.meta.ai."}
      </p>
    </div>
  )
}
