// @vitest-environment node
import { createHash } from 'node:crypto'
import { cairoDayKey, cloudinarySignature, escapeHtml, isValidDocId, safeJsonLd } from './logic'
import { decodeFields, encodeValue } from './firestore'

describe('cloudinarySignature', () => {
  it('equals SHA-1 of sorted params + secret (checked against node:crypto)', async () => {
    const params = { timestamp: 1700000000, folder: 'units/u1', allowed_formats: 'jpg,png' }
    const expected = createHash('sha1').update('allowed_formats=jpg,png&folder=units/u1&timestamp=1700000000' + 'secret').digest('hex')
    expect(await cloudinarySignature(params, 'secret')).toBe(expected)
  })
})

describe('cairoDayKey', () => {
  it('rolls over at Cairo midnight (UTC+2 in November)', () => {
    expect(cairoDayKey(new Date('2026-11-06T21:59:00Z'))).toBe('2026-11-06')
    expect(cairoDayKey(new Date('2026-11-06T22:01:00Z'))).toBe('2026-11-07')
  })
})

describe('input hardening', () => {
  it('accepts Firestore-style ids and rejects path tricks', () => {
    expect(isValidDocId('Ab12Cd34Ef56Gh78Ij90')).toBe(true)
    expect(isValidDocId('../users/x')).toBe(false)
    expect(isValidDocId('short')).toBe(false)
    expect(isValidDocId(42)).toBe(false)
  })
  it('escapes HTML and JSON-LD', () => {
    expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;')
    expect(safeJsonLd({ a: '</script><script>alert(1)' })).not.toContain('</script>')
  })
})

describe('Firestore REST codec', () => {
  it('round-trips values', () => {
    const src = { s: 'x', n: 3, f: 1.5, b: true, z: null, arr: ['a', 'b'], m: { k: 1 }, d: new Date('2026-01-01T00:00:00.000Z') }
    const fields = Object.fromEntries(Object.entries(src).map(([k, v]) => [k, encodeValue(v)]))
    expect(decodeFields(fields)).toEqual(src)
  })
})
