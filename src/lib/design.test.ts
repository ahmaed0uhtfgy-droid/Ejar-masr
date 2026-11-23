import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyDesign, currentDesign, DESIGN_KEY } from './design'
import { DEFAULT_DESIGN, DESIGN_IDS, DESIGNS, normalizeDesign } from './designIds'
import { DEFAULT_SETTINGS } from './defaultSettings'
import { mergeSettings } from './settingsStore'

const root = document.documentElement
beforeEach(() => { localStorage.clear(); root.removeAttribute('data-design'); root.classList.remove('dark'); document.getElementById('ejar-design-fonts')?.remove(); document.head.innerHTML = '<meta name="theme-color" content="#0B1B3A">' })
afterEach(() => { localStorage.clear() })

describe('design ids', () => {
  it('has exactly the two designs, classic by default', () => {
    expect([...DESIGN_IDS]).toEqual(['classic', 'royal'])
    expect(DEFAULT_DESIGN).toBe('classic')
    for (const id of DESIGN_IDS) expect(DESIGNS[id].id).toBe(id)
  })
  it('unknown, empty or old values fall back to classic instead of breaking the page', () => {
    for (const v of [undefined, null, '', 'Royal', 'dark', 42, {}]) expect(normalizeDesign(v)).toBe('classic')
    expect(normalizeDesign('royal')).toBe('royal')
  })
  it('old settings documents (no design field) keep working, and the field survives a merge', () => {
    expect(mergeSettings({ maxImages: 3 }).design).toBe('classic')
    expect(mergeSettings({ design: 'royal' }).design).toBe('royal')
    expect(mergeSettings({ design: 'nonsense' as never }).design).toBe('classic')
    expect(DEFAULT_SETTINGS.design).toBe('classic')
  })
})

describe('applyDesign', () => {
  it('royal: sets the attribute, forces dark, loads its fonts once, recolours the browser bar and remembers the choice', () => {
    applyDesign('royal'); applyDesign('royal')
    expect(currentDesign()).toBe('royal')
    expect(root.classList.contains('dark')).toBe(true)
    expect(document.querySelectorAll('#ejar-design-fonts')).toHaveLength(1)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(DESIGNS.royal.themeColor)
    expect(localStorage.getItem(DESIGN_KEY)).toBe('royal')
  })
  it('classic: gives the visitor their own light / dark choice back (royal never overwrites it)', () => {
    localStorage.setItem('theme', 'light')
    applyDesign('royal')
    expect(root.classList.contains('dark')).toBe(true)
    applyDesign('classic')
    expect(root.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
    localStorage.setItem('theme', 'dark'); applyDesign('classic')
    expect(root.classList.contains('dark')).toBe(true)
  })
  it('a preview (remember = false) is not stored for the next visit', () => {
    applyDesign('royal', false)
    expect(localStorage.getItem(DESIGN_KEY)).toBeNull()
  })
  it('classic does not download the royal fonts', () => {
    applyDesign('classic')
    expect(document.getElementById('ejar-design-fonts')).toBeNull()
  })
})

describe('index.html pre-paint script', () => {
  const html = readFileSync('index.html', 'utf8')
  it('reads the remembered design before the app loads, so there is no flash of the other design', () => {
    expect(html).toContain("localStorage.getItem('ejar:design')")
    expect(html).toContain("setAttribute('data-design'")
    expect(DESIGN_KEY).toBe('ejar:design')
  })
})

describe('royal palette (index.css)', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const body = /html\[data-design='royal'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  const tok = Object.fromEntries([...body.matchAll(/--c-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number]]))
  const lum = ([r, g, b]: number[]): number => { const f = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
  const contrast = (a: number[], b: number[]): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
  it('defines every colour token the base theme defines', () => {
    for (const k of ['ink', 'paper', 'surface', 'line', 'mute', 'nile', 'nile-dark', 'sand', 'danger', 'logo']) expect(Object.keys(tok)).toContain(k)
  })
  it('keeps all text readable (WCAG AA 4.5:1 or better)', () => {
    for (const [a, b] of [['ink', 'paper'], ['ink', 'surface'], ['mute', 'paper'], ['mute', 'surface'], ['nile', 'paper'], ['nile', 'surface'], ['danger', 'paper'], ['danger', 'surface'], ['paper', 'nile-dark']]) expect([a, b, contrast(tok[a], tok[b]) >= 4.5]).toEqual([a, b, true])
  })
  it('is actually dark', () => { expect(lum(tok.paper)).toBeLessThan(0.02) })
})
