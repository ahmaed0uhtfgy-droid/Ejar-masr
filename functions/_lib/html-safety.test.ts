// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { HttpError, errorResponse, json } from './http'
import { cloudinaryUrl, escapeHtml, isExpiredDate, isValidDocId, safeJsonLd, sha1Hex } from './logic'
import { bodyHtml, faqJsonLd } from './seoBody'
import { decodeFields, decodeValue, encodeValue } from './firestore'

const PAYLOADS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'; DROP TABLE units;--", '</title><script>x</script>', '<svg/onload=alert(1)>', 'javascript:alert(1)', '&lt;already&gt;', '\u0000<b>']

describe('escapeHtml', () => {
  it.each(PAYLOADS)('neutralises %j (no raw < > " \' remain)', (p) => { expect(escapeHtml(p)).not.toMatch(/[<>"']/) })
  it('escapes & first so entities are not double-decoded', () => { expect(escapeHtml('&lt;')).toBe('&amp;lt;') })
  it('leaves Arabic and normal text alone', () => { expect(escapeHtml('شقة للإيجار 3 غرف')).toBe('شقة للإيجار 3 غرف') })
})

describe('safeJsonLd (data placed inside <script type="application/ld+json">)', () => {
  it.each(PAYLOADS)('cannot be used to break out of the script tag: %j', (p) => {
    const out = safeJsonLd({ name: p, nested: { list: [p] } })
    expect(out).not.toMatch(/[<>&]/)
    expect(JSON.parse(out).name).toBe(p) // still the same data once parsed
  })
})

describe('bodyHtml / faqJsonLd (server-rendered SEO copy built from stored text)', () => {
  it('escapes every user-controlled string it renders', () => {
    const html = bodyHtml({ h1: PAYLOADS[0], paragraphs: [PAYLOADS[1]], sections: [{ h2: PAYLOADS[2], text: PAYLOADS[3], links: [{ href: PAYLOADS[4], text: PAYLOADS[5] }], faqs: [{ q: PAYLOADS[1], a: PAYLOADS[0] }] }] })
    expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).not.toContain('<svg'); expect(html).not.toContain('onerror=alert(1)>')
    expect(html.startsWith('<main')).toBe(true)
  })
  it('handles empty input', () => { expect(bodyHtml({ h1: 'x' })).toBe('<main style="position:absolute;width:1px;height:1px;overflow:hidden"><h1>x</h1></main>') })
  it('builds FAQPage JSON-LD', () => { expect(faqJsonLd([{ q: 'a', a: 'b' }])).toEqual({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'a', acceptedAnswer: { '@type': 'Answer', text: 'b' } }] }) })
})

describe('isValidDocId', () => {
  it('accepts only 10-40 alphanumerics', () => {
    expect(isValidDocId('a'.repeat(10))).toBe(true); expect(isValidDocId('a'.repeat(40))).toBe(true)
    for (const bad of ['a'.repeat(9), 'a'.repeat(41), 'abc-defghijk', 'abc_defghijk', 'abc/defghijk', 'abc.defghijk', ' abcdefghijk', 'abcdefghijk\n', 'ابجدهوزحطيكلمن', undefined, null, {}, [], ['a'.repeat(12)]]) expect(isValidDocId(bad)).toBe(false)
  })
})

describe('cloudinaryUrl / isExpiredDate / sha1Hex', () => {
  it('builds a transformed delivery URL; the cloud name is the part before the first colon', () => {
    expect(cloudinaryUrl('demo:units/u1/abc')).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_1200,h_630,c_fill/units/u1/abc')
    expect(cloudinaryUrl('demo:a:b', 100, 50)).toBe('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,w_100,h_50,c_fill/a:b')
  })
  it('a stored image id can never point the URL at another host', () => {
    for (const id of ['evil.com/x:y', '@evil.com:y', 'a b:c', 'x\n:y']) expect(new URL(cloudinaryUrl(id)).hostname).toBe('res.cloudinary.com')
  })
  it('isExpiredDate: only real Dates in the past (or now) count as expired', () => {
    const now = new Date('2027-03-10T10:00:00Z')
    expect([isExpiredDate(new Date('2027-03-10T09:59:59Z'), now), isExpiredDate(now, now), isExpiredDate(new Date('2027-03-10T10:00:01Z'), now), isExpiredDate(null, now), isExpiredDate(undefined, now), isExpiredDate('2020-01-01', now)]).toEqual([true, true, false, false, false, false])
  })
  it('sha1Hex of known vectors', async () => { expect(await sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d'); expect(await sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709') })
})

describe('HTTP helpers', () => {
  it('json() sets content type and disables caching', async () => {
    const r = json({ a: 1 }, 201, { 'X-Test': '1' })
    expect([r.status, r.headers.get('Cache-Control'), r.headers.get('X-Test'), r.headers.get('Content-Type')]).toEqual([201, 'no-store', '1', 'application/json; charset=utf-8'])
  })
  it('errorResponse exposes HttpError details but hides unexpected errors', async () => {
    const known = errorResponse(new HttpError(409, 'state', 'msg'))
    expect([known.status, await known.json()]).toEqual([409, { error: 'state', message: 'msg' }])
    const orig = console.error; console.error = () => {}
    const unknown = errorResponse(new Error('secret db password leaked'))
    console.error = orig
    const body = JSON.stringify(await unknown.json())
    expect(unknown.status).toBe(500); expect(body).not.toContain('secret'); expect(body).toContain('server')
  })
})

describe('Firestore REST codec', () => {
  it('encodes integers and doubles differently, and decodes both to numbers', () => {
    expect(encodeValue(5)).toEqual({ integerValue: '5' }); expect(encodeValue(5.5)).toEqual({ doubleValue: 5.5 })
    expect(decodeValue({ integerValue: '9007199254740991' })).toBe(9007199254740991); expect(decodeValue({ doubleValue: 0.1 })).toBe(0.1)
  })
  it('null and undefined become nullValue; unknown shapes decode to undefined', () => {
    expect(encodeValue(null)).toEqual({ nullValue: null }); expect(encodeValue(undefined)).toEqual({ nullValue: null }); expect(decodeValue({ referenceValue: 'x' })).toBeUndefined()
  })
  it('round-trips nested arrays/maps/dates/Arabic text, and empty containers', () => {
    const src = { a: [1, [2, { b: 'شقة' }], []], m: {}, d: new Date('2027-03-10T10:00:00.000Z'), t: true, f: false }
    expect(decodeFields((encodeValue(src) as { mapValue: { fields: Record<string, never> } }).mapValue.fields)).toEqual(src)
  })
  it('a string that looks like a number stays a string', () => { expect(decodeValue(encodeValue('007'))).toBe('007') })
})

describe('wire format (edge-cached documents)', () => {
  it('toWire / fromWire round-trip dates at any depth and leave other values alone', async () => {
    const { toWire, fromWire } = await import('./wire')
    const src = { a: new Date('2027-03-10T10:00:00.000Z'), n: { d: [new Date(0), 'x', 5, null, true] }, s: 'نص' }
    const wire = toWire(src)
    expect(JSON.parse(JSON.stringify(wire))).toEqual({ a: { __ts: Date.parse('2027-03-10T10:00:00.000Z') }, n: { d: [{ __ts: 0 }, 'x', 5, null, true] }, s: 'نص' })
    expect(fromWire(JSON.parse(JSON.stringify(wire)))).toEqual(src)
  })
  it('a real document that merely has a field called __ts with other keys is not treated as a date', async () => {
    const { fromWire } = await import('./wire')
    expect(fromWire({ __ts: 5, other: 1 })).toEqual({ __ts: 5, other: 1 })
  })
})
