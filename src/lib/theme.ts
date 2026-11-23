import { DESIGNS } from './designIds'

export type Theme = 'light' | 'dark'

export function getTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** Colour of the browser's address bar / status bar on phones. The royal design has its own (it is always dark). */
export const themeColor = (t: Theme, royal = false): string => (royal ? DESIGNS.royal.themeColor : t === 'dark' ? '#0F0F10' : '#0B1B3A')

/** Keeps <meta name="theme-color"> in step with the theme and design (the page ships with the light value). */
export function syncThemeColor(): void {
  const royal = document.documentElement.getAttribute('data-design') === 'royal'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor(getTheme(), royal))
}

export function setTheme(t: Theme): void {
  document.documentElement.classList.toggle('dark', t === 'dark')
  syncThemeColor()
  try { localStorage.setItem('theme', t) } catch { /* storage may be blocked */ }
}
