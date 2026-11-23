import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { themeColor } from './theme'

type RGB = [number, number, number]
const css = readFileSync('src/index.css', 'utf8')
const block = (sel: RegExp): Record<string, RGB> => {
  const body = sel.exec(css)?.[1] ?? ''
  return Object.fromEntries([...body.matchAll(/--c-([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)].map((m) => [m[1], [Number(m[2]), Number(m[3]), Number(m[4])] as RGB]))
}
const light = block(/:root\s*\{([^}]*)\}/)
const dark = block(/\.dark\s*\{([^}]*)\}/)
const lum = ([r, g, b]: RGB): number => { const f = (c: number): number => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a: RGB, b: RGB): number => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

describe('dark theme', () => {
  it('backgrounds and borders are neutral charcoal, not blue (red/green/blue channels within a few points)', () => {
    for (const k of ['paper', 'surface', 'line']) { const [r, g, b] = dark[k]; expect([k, Math.max(r, g, b) - Math.min(r, g, b) <= 8]).toEqual([k, true]) }
  })
  it('is actually dark: page background below 8% luminance, cards slightly lighter', () => {
    expect(lum(dark.paper)).toBeLessThan(0.02)
    expect(lum(dark.surface)).toBeGreaterThan(lum(dark.paper))
    expect(lum(dark.surface)).toBeLessThan(0.05)
  })
  it('keeps readable text everywhere (WCAG AA 4.5:1 or better)', () => {
    const pairs: [string, string, number][] = [['ink', 'paper', 7], ['ink', 'surface', 7], ['mute', 'paper', 4.5], ['mute', 'surface', 4.5], ['nile', 'paper', 4.5], ['nile', 'surface', 4.5], ['danger', 'paper', 4.5], ['danger', 'surface', 4.5], ['paper', 'nile-dark', 4.5]]
    for (const [a, b, min] of pairs) expect([a, b, contrast(dark[a], dark[b]) >= min]).toEqual([a, b, true])
  })
  it('the logo disc follows the theme (it used to stay navy in dark mode)', () => {
    expect(Math.max(...dark.logo) - Math.min(...dark.logo)).toBeLessThanOrEqual(8)
    expect(light.logo).toEqual([11, 27, 58])
  })
  it('defines every colour token the light theme defines, so no component falls back to a light colour', () => {
    for (const k of Object.keys(light)) expect(Object.keys(dark)).toContain(k)
  })
})

describe('light theme (unchanged brand)', () => {
  it('text stays readable', () => {
    for (const [a, b] of [['ink', 'paper'], ['mute', 'paper'], ['nile', 'surface'], ['danger', 'paper']]) expect([a, b, contrast(light[a], light[b]) >= 4.5]).toEqual([a, b, true])
  })
})

describe('themeColor (phone browser bar)', () => {
  it('matches each theme', () => { expect([themeColor('dark'), themeColor('light')]).toEqual(['#0F0F10', '#0B1B3A']) })
  it('the dark bar colour equals the dark page background', () => {
    const hex = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`
    expect(themeColor('dark')).toBe(hex(dark.paper))
  })
})
