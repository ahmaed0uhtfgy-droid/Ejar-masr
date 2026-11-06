import { slugify } from './slug'
import { STATIC_TREE } from './locations'

describe('slugify', () => {
  it('lowercases and hyphenates', () => { expect(slugify('Kafr El Sheikh')).toBe('kafr-el-sheikh') })
  it('drops apostrophes and punctuation', () => { expect(slugify("Port Said's")).toBe('port-saids') })
  it('produces a unique non-empty latin slug for every governorate', () => {
    const slugs = STATIC_TREE.govs.map((g) => g.slug)
    expect(slugs.every((s) => /^[a-z0-9-]+$/.test(s))).toBe(true)
    expect(new Set(slugs).size).toBe(slugs.length)
  })
})
