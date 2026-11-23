// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { relinkSite } from '../_lib/articleText'

const base = 'https://new-domain.com'

describe('relinkSite: the site address inside articles follows the domain', () => {
  it('replaces {{site}} with the current address', () => {
    expect(relinkSite('زور [الموقع]({{site}}/search) و {{SITE_URL}}', base)).toBe('زور [الموقع](https://new-domain.com/search) و https://new-domain.com')
  })
  it('rewrites links to a previous domain (any scheme, with or without www) and bare mentions of it', () => {
    const md = '[أ](https://old.pages.dev/rent/cairo) [ب](http://www.old.pages.dev/search) النص: old.pages.dev'
    expect(relinkSite(md, base, ['https://old.pages.dev'])).toBe('[أ](https://new-domain.com/rent/cairo) [ب](https://new-domain.com/search) النص: new-domain.com')
  })
  it('leaves other sites and relative links alone, and does nothing when the domain did not change', () => {
    const md = '[خارجي](https://example.org/x) [داخلي](/search) [نفس](https://new-domain.com/a)'
    expect(relinkSite(md, base, ['https://old.pages.dev', base])).toBe(md)
  })
})
