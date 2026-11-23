// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { renderIndex, renderNotFound } from '../_lib/articlePages'
import type { Env } from '../_lib/env'

const env = { SITE_URL: 'https://site.test' } as unknown as Env

describe('blog pages follow the design the admin picked', () => {
  it('royal: the page carries data-design="royal" and the royal palette', () => {
    const html = renderIndex(env, [], 1, 'royal')
    expect(html).toContain('<html lang="ar" dir="rtl" data-design="royal">')
    expect(html).toContain('html[data-design=royal]{color-scheme:dark;--bg:#061431')
  })
  it('classic is the default, and anything unknown falls back to it', () => {
    expect(renderIndex(env, [], 1)).toContain('data-design="classic"')
    expect(renderNotFound(env, 'nonsense' as never)).toContain('data-design="classic"')
  })
  it('still has no JavaScript and keeps its SEO basics', () => {
    const html = renderIndex(env, [], 1, 'royal')
    expect(html).not.toContain('<script>')
    expect(html).toContain('<link rel="canonical"')
  })
})
