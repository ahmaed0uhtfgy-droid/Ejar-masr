import { DEFAULT_DESIGN, DESIGNS, normalizeDesign, type DesignId } from './designIds'

export { DEFAULT_DESIGN, DESIGNS, normalizeDesign }
export type { DesignId }

/** localStorage key read by the inline script in index.html, so the right design is on screen before the first paint. */
export const DESIGN_KEY = 'ejar:design'
const FONT_LINK_ID = 'ejar-design-fonts'
/** Fonts only the royal design needs (classic already loads its own in index.html), so classic visitors never download them. */
const ROYAL_FONTS = 'https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;900&family=Montserrat:wght@700;800&display=swap'

/** The design currently on <html> (set by the inline script in index.html or by applyDesign). */
export function currentDesign(): DesignId {
  if (typeof document === 'undefined') return DEFAULT_DESIGN
  return normalizeDesign(document.documentElement.getAttribute('data-design'))
}

/** The visitor's own light / dark choice (what ThemeToggle stores), falling back to the phone / browser setting. */
function preferredDark(): boolean {
  try {
    const s = localStorage.getItem('theme')
    if (s) return s === 'dark'
  } catch { /* storage may be blocked */ }
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Puts a design on the page: data-design attribute, fonts, light/dark class, browser bar colour.
 *  - royal is always dark: it forces the `dark` class (so every `dark:` utility keeps working) without touching the visitor's saved choice.
 *  - going back to classic restores that saved choice.
 * `remember` stores it for the next visit (not for the admin's temporary preview).
 */
export function applyDesign(design: DesignId, remember = true): void {
  if (typeof document === 'undefined') return
  const d = normalizeDesign(design)
  const root = document.documentElement
  root.setAttribute('data-design', d)
  root.classList.toggle('dark', d === 'royal' ? true : preferredDark())

  const existing = document.getElementById(FONT_LINK_ID)
  if (d === 'royal' && !existing) {
    const l = document.createElement('link')
    l.id = FONT_LINK_ID; l.rel = 'stylesheet'; l.href = ROYAL_FONTS
    document.head.appendChild(l)
  }

  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', d === 'royal' ? DESIGNS.royal.themeColor : root.classList.contains('dark') ? '#0F0F10' : DESIGNS.classic.themeColor)
  if (remember) { try { localStorage.setItem(DESIGN_KEY, d) } catch { /* ignore */ } }
}
