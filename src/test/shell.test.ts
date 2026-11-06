import { readFileSync } from 'node:fs'
import { ar } from '../i18n/ar'

describe('document shell', () => {
  const html = readFileSync('index.html', 'utf8')
  it('is Arabic and right-to-left', () => { expect(html).toContain('<html lang="ar" dir="rtl">') })
  it('applies the stored theme before paint (no flash)', () => { expect(html).toContain("classList.add('dark')") })
})

describe('i18n dictionary', () => {
  const strings: string[] = []
  const walk = (o: unknown) => {
    if (typeof o === 'string') strings.push(o)
    else if (Array.isArray(o)) o.forEach(walk)
    else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => { if (k !== 'contactEmail') walk(v) })
  }
  walk(ar)
  it('has no empty strings (besides contactEmail)', () => { expect(strings.every((s) => s.trim().length > 0)).toBe(true) })
  it('landing helpers interpolate', () => { expect(ar.landing.titleType('شقق', 'القاهرة')).toBe('شقق للإيجار في القاهرة') })
})
