// Light or dark, and who decides.
//
// The app used to hardcode `class="dark"` on <html> and never read anything
// back. The toggle wrote `localStorage.theme` faithfully and nothing ever
// looked at it, so choosing light mode lasted exactly until the next reload —
// and someone whose OS is set to light got a dark app on their first visit,
// because `prefers-color-scheme` was not consulted anywhere.
//
// Three states, not two: "light", "dark", or no stored preference at all. The
// third is the default and means "follow the OS", which is the only way an OS
// change can be respected after the fact — a stored "dark" that merely happened
// to match the OS at the time is indistinguishable from a deliberate choice.

export const THEME_KEY = "theme"

export type ThemeChoice = "light" | "dark"
/** null = no stored choice, follow the system. */
export type StoredTheme = ThemeChoice | null

export function storedTheme(): StoredTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY)
    return raw === "light" || raw === "dark" ? raw : null
  } catch {
    // Private mode, or storage blocked. Following the system is the right
    // fallback; throwing here would take the whole app down over a preference.
    return null
  }
}

export function systemTheme(): ThemeChoice {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark"
}

/** What should actually be on screen right now. */
export function resolveTheme(): ThemeChoice {
  return storedTheme() ?? systemTheme()
}

export function applyTheme(theme: ThemeChoice) {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  // Mirrored as an attribute as well as a class: the class is what the CSS
  // keys off, the attribute is what makes the current theme readable without
  // inferring it from a class list.
  root.setAttribute("data-theme", theme)
}

export function setTheme(theme: ThemeChoice) {
  applyTheme(theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // The theme still applies for this session; it just will not be
    // remembered. Better than refusing to switch.
  }
}

/**
 * Follow the OS for as long as the user has not chosen.
 *
 * Returns its own teardown. Checks `storedTheme()` at event time rather than
 * capturing it, so switching to light and back to system-follow inside one
 * session behaves.
 */
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {}
  const mq = window.matchMedia("(prefers-color-scheme: light)")
  const onChange = () => {
    if (storedTheme() === null) applyTheme(systemTheme())
  }
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}
