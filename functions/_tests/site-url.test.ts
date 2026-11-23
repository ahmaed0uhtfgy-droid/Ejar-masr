// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { DEFAULT_SITE_URL } from '../../src/lib/brand'
import { siteUrl, type Env } from '../_lib/env'

const e = (v?: string) => ({ SITE_URL: v }) as unknown as Env

describe('siteUrl', () => {
  it('adds https:// when SITE_URL was typed without a scheme (fixes the invalid Sitemap line in robots.txt)', () => {
    expect(siteUrl(e('ejar-masr1.pages.dev'))).toBe('https://ejar-masr1.pages.dev')
  })
  it('keeps a full address, drops trailing slashes and spaces, and falls back to the default when empty', () => {
    expect(siteUrl(e('https://www.ejar-masr.com/'))).toBe('https://www.ejar-masr.com')
    expect(siteUrl(e('  http://localhost:8788 '))).toBe('http://localhost:8788')
    expect(siteUrl(e(''))).toBe(DEFAULT_SITE_URL)
    expect(siteUrl(e(undefined))).toBe(DEFAULT_SITE_URL)
  })
})
