import * as React from "react"
import { Sun, Moon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { setTheme, watchSystemTheme } from "@/lib/theme"

export function ThemeToggle() {
  const [isDark, setIsDark] = React.useState(true)

  React.useEffect(() => {
    // The inline script in index.html has already applied the theme; read it
    // back rather than assuming a default.
    const sync = () => setIsDark(document.documentElement.classList.contains("dark"))
    sync()
    // Follow the OS while no explicit choice is stored.
    const stop = watchSystemTheme()
    const mq = window.matchMedia?.("(prefers-color-scheme: light)")
    mq?.addEventListener("change", sync)
    return () => {
      stop()
      mq?.removeEventListener("change", sync)
    }
  }, [])

  const toggle = () => {
    const next = document.documentElement.classList.contains("dark") ? "light" : "dark"
    setTheme(next)
    setIsDark(next === "dark")
  }

  return (
    <Tooltip content={isDark ? "Light mode" : "Dark mode"} side="bottom">
      <Button
        variant="ghost"
        size="icon-compact"
        onClick={toggle}
        className="size-6 rounded-md hover:bg-hover active:bg-active active:scale-95 transition-all duration-80 text-muted-foreground hover:text-foreground shrink-0"
      >
        {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
        <span className="sr-only">Toggle Theme</span>
      </Button>
    </Tooltip>
  )
}
