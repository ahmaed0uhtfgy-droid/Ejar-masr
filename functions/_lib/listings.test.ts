// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SNAPSHOT_LIMIT, pageFromSnapshot, refreshMinutes, type Snapshot } from './listings'

const NOW = Date.UTC(2027, 2, 10)
const unit = (i: number, over: Record<string, unknown> = {}) => ({ id: `u${String(i).padStart(3, '0')}`, data: { price: 1000 + (i % 4) * 100, governorateId: i % 2 ? 'giza' : 'cairo', rentType: i % 3 ? 'monthly' : 'daily', createdAt: { __ts: Date.UTC(2027, 0, 1 + i) }, expiresAt: null, ...over } })
const snap = (n: number, over: (i: number) => Record<string, unknown> = () => ({})): Snapshot => ({ builtAt: NOW, truncated: false, units: Array.from({ length: n }, (_, i) => unit(i, over(i))) })
const all = (s: Snapshot, sort: 'newest' | 'priceAsc' | 'priceDesc', n: number, gov?: string, rent?: string) => {
  const out: string[] = []
  let after: { v: number; id: string } | null = null
  for (let p = 0; p < 200; p++) { const r = pageFromSnapshot(s, { gov, rent, sort, n, after, now: NOW }); out.push(...r.docs.map((d) => d.id)); if (!r.next) break; after = r.next }
  return out
}

describe('refreshMinutes (keeps the cost under ~12,000 reads a day)', () => {
  it('is 5 minutes for small catalogues and grows with size, capped at an hour', () => {
    expect([refreshMinutes(0), refreshMinutes(1), refreshMinutes(40), refreshMinutes(100), refreshMinutes(300), refreshMinutes(100000)]).toEqual([5, 5, 5, 12, 36, 60])
  })
  it('the daily reads it implies stay within budget for any catalogue the snapshot can hold', () => {
    for (let n = 1; n <= SNAPSHOT_LIMIT; n += 7) expect(n * (1440 / refreshMinutes(n))).toBeLessThanOrEqual(Math.max(12_000 * 1.05, n * 288))
  })
})

describe('pageFromSnapshot', () => {
  it('newest first, then every sort pages through everything exactly once', () => {
    const s = snap(23)
    for (const sort of ['newest', 'priceAsc', 'priceDesc'] as const) for (const n of [6, 7, 24]) {
      const ids = all(s, sort, n)
      expect([sort, n, new Set(ids).size, ids.length]).toEqual([sort, n, 23, 23])
    }
    expect(all(s, 'newest', 24)[0]).toBe('u022')
  })
  it('orders by price with ties broken by id in the same direction as the indexed query', () => {
    const s = snap(12)
    const asc = all(s, 'priceAsc', 100).map((id) => Number(id.slice(1)))
    const prices = asc.map((i) => 1000 + (i % 4) * 100)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    const desc = all(s, 'priceDesc', 100)
    expect(desc.filter((_, i) => prices[prices.length - 1 - i] === 1300).slice(0, 3)).toEqual(['u011', 'u007', 'u003'])
  })
  it('filters by governorate and rent type, including both together', () => {
    const s = snap(30)
    expect(all(s, 'newest', 50, 'cairo').every((id) => Number(id.slice(1)) % 2 === 0)).toBe(true)
    expect(all(s, 'newest', 50, undefined, 'daily').every((id) => Number(id.slice(1)) % 3 === 0)).toBe(true)
    const both = all(s, 'newest', 50, 'cairo', 'daily')
    expect(both.length).toBeGreaterThan(0); expect(both.every((id) => Number(id.slice(1)) % 6 === 0)).toBe(true)
    expect(all(s, 'newest', 50, 'nowhere')).toEqual([])
  })
  it('never returns expired listings', () => {
    const s = snap(6, (i) => (i < 3 ? { expiresAt: { __ts: NOW - 1 } } : { expiresAt: { __ts: NOW + 1000 } }))
    expect(all(s, 'newest', 50).sort()).toEqual(['u003', 'u004', 'u005'])
  })
  it('next is null on the last page, even when the last page is exactly full', () => {
    const s = snap(12)
    expect(pageFromSnapshot(s, { sort: 'newest', n: 12, after: null, now: NOW }).next).toBeNull()
    expect(pageFromSnapshot(s, { sort: 'newest', n: 11, after: null, now: NOW }).next).not.toBeNull()
  })
  it('a cursor pointing past the end, or at a listing that has since disappeared, behaves sensibly', () => {
    const s = snap(5)
    expect(pageFromSnapshot(s, { sort: 'newest', n: 5, after: { v: 0, id: 'u000' }, now: NOW }).docs).toEqual([])
    const r = pageFromSnapshot(s, { sort: 'newest', n: 5, after: { v: Date.UTC(2027, 0, 3) + 1, id: 'gone' }, now: NOW })
    expect(r.docs.map((d) => d.id)).toEqual(['u002', 'u001', 'u000']) // continues from where the cursor value falls
  })
  it('an empty snapshot gives an empty page', () => { expect(pageFromSnapshot(snap(0), { sort: 'newest', n: 24, after: null, now: NOW })).toEqual({ docs: [], next: null }) })
})
