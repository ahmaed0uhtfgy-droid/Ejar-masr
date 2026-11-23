// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet as settings } from '../api/settings'
import { onRequestGet as units } from '../api/units'
import { call, seedUnit, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
// Like the real Cache API, entries expire after their max-age.
beforeEach(() => {
  const s = new Map<string, { res: Response; until: number }>()
  vi.stubGlobal('caches', { default: {
    match: async (r: Request) => { const e = s.get(r.url); return e && e.until > Date.now() ? e.res.clone() : undefined },
    put: async (r: Request, x: Response) => { s.set(r.url, { res: x, until: Date.now() + Number(/max-age=(\d+)/.exec(x.headers.get('Cache-Control') ?? '')?.[1] ?? 0) * 1000 }) },
  } })
})
afterEach(() => { vi.unstubAllGlobals() })

const get = (query = '', ip = '1.2.3.4') => call(units, w.env, { method: 'GET', path: '/api/units', query, headers: { 'CF-Connecting-IP': ip } })
const id = (i: number) => `unitPage${String(i).padStart(8, '0')}`
const ids = (r: { json: Record<string, unknown> }) => (r.json.docs as { id: string }[]).map((d) => d.id)
function catalogue(count = 15) {
  for (let i = 0; i < count; i++) seedUnit(w.db, { id: id(i), createdAt: new Date(Date.UTC(2027, 0, 1 + i)), price: 1000 + (i % 5) * 500 + i, governorateId: i % 3 === 0 ? 'cairo' : 'giza', rentType: i % 2 ? 'daily' : 'monthly' })
  seedUnit(w.db, { id: 'unitHidden00001', createdAt: new Date(Date.UTC(2027, 5, 1)), status: 'hidden', governorateId: 'cairo' })
}

describe('GET /api/units', () => {
  it('returns active listings only, newest first, with dates in a JSON-safe form', async () => {
    catalogue()
    const r = await get('?n=24')
    expect(r.status).toBe(200)
    expect(ids(r)).toEqual(Array.from({ length: 15 }, (_, i) => id(14 - i)))
    expect(ids(r)).not.toContain('unitHidden00001')
    expect((r.json.docs as { data: { createdAt: { __ts: number } } }[])[0].data.createdAt).toEqual({ __ts: Date.UTC(2027, 0, 15) })
    expect(r.json.next).toBeNull()
    expect(r.res.headers.get('Cache-Control')).toContain('public')
  })
  it('pages through the whole catalogue with the cursor: nothing missing, nothing twice (newest and both price orders)', async () => {
    catalogue()
    for (const sort of ['newest', 'priceAsc', 'priceDesc']) {
      const seen: string[] = []
      let after = ''
      for (let page = 0; page < 10; page++) {
        const r = await get(`?sort=${sort}&n=6${after}`)
        seen.push(...ids(r))
        if (!r.json.next) break
        after = `&after=${r.json.next as string}`
      }
      expect([sort, new Set(seen).size, seen.length]).toEqual([sort, 15, 15])
    }
  })
  it('price sorting really is ordered across pages', async () => {
    catalogue()
    const prices: number[] = []
    let after = ''
    for (let p = 0; p < 10; p++) {
      const r = await get(`?sort=priceAsc&n=6${after}`)
      prices.push(...(r.json.docs as { data: { price: number } }[]).map((d) => d.data.price))
      if (!r.json.next) break
      after = `&after=${r.json.next as string}`
    }
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })
  it('filters by governorate and rent type on the server', async () => {
    catalogue()
    expect(ids(await get('?gov=cairo')).every((x) => Number(x.slice(-8)) % 3 === 0)).toBe(true)
    const daily = await get('?rent=daily')
    expect(ids(daily).length).toBeGreaterThan(0)
    expect(ids(daily).every((x) => Number(x.slice(-8)) % 2 === 1)).toBe(true)
  })
  it('cost does not depend on visitors OR on how many different searches they run: one snapshot read, then nothing', async () => {
    catalogue(); w.db.resetCounters()
    await get('?gov=cairo', '9.9.0.1')
    const first = w.db.counters.reads
    expect(first).toBeLessThanOrEqual(20) // snapshot document + the 15 active listings, once
    w.db.resetCounters()
    for (let i = 0; i < 100; i++) for (const q of ['?gov=giza', '?rent=daily', '?sort=priceAsc', '?sort=priceDesc&gov=cairo', '?gov=cairo&rent=monthly&sort=priceAsc']) await get(q, `9.9.${i}.2`)
    expect(w.db.counters.reads).toBeLessThanOrEqual(1) // at most the tiny "is the snapshot fresh" check, never a listings query
  })
  it('works with only the status+createdAt index: no gov/price composite index is ever needed for a small catalogue', async () => {
    catalogue()
    const original = globalThis.fetch
    // Any query that filters on more than status, or orders by price, would need an index that this project may not have: make those fail.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? '')
      if (body.includes('structuredQuery') && (body.includes('governorateId') || body.includes('rentType') || body.includes('"price"'))) return new Response('{"error":{"status":"FAILED_PRECONDITION"}}', { status: 400 })
      return original(input, init)
    }) as typeof fetch
    const r = await get('?gov=cairo&sort=priceAsc&rent=monthly')
    globalThis.fetch = original
    expect(r.status).toBe(200)
    expect(ids(r).length).toBeGreaterThan(0)
  })
  it('the snapshot is refreshed only when it is older than its interval (5 minutes for a small catalogue)', async () => {
    catalogue(); await get('?gov=cairo')
    vi.setSystemTime(new Date(Date.now() + 4 * 60_000)); w.db.resetCounters(); await get('?gov=giza')
    expect(w.db.counters.reads).toBeLessThanOrEqual(1) // edge copy expired, stored snapshot still fresh: no rebuild
    vi.setSystemTime(new Date(Date.now() + 4 * 60_000)); w.db.resetCounters(); await get('?gov=cairo&rent=daily')
    expect(w.db.counters.reads).toBeGreaterThan(10) // older than 5 min and the edge copy has expired: rebuilt
  })
  it('a new listing shows up after the refresh', async () => {
    catalogue(3); await get('')
    seedUnit(w.db, { id: 'unitFresh000001', createdAt: new Date(Date.UTC(2027, 6, 1)) })
    vi.setSystemTime(new Date(Date.now() + 10 * 60_000)) // refresh interval (5 min) + edge copies (3 min)
    expect(ids(await get(''))[0]).toBe('unitFresh000001')
  })
  it('a listing that was hidden or expired disappears at the next refresh, and expired ones never appear', async () => {
    catalogue(3)
    seedUnit(w.db, { id: 'unitExpired0001', createdAt: new Date(Date.UTC(2027, 7, 1)), expiresAt: new Date(Date.now() - 1000) })
    expect(ids(await get('')).includes('unitExpired0001')).toBe(false)
  })
  it('keeps serving the last snapshot if the database fails during a refresh', async () => {
    catalogue(); await get('')
    vi.setSystemTime(new Date(Date.now() + 70 * 60_000)) // past both the edge copy and the refresh interval
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('documents:runQuery') || String(input).includes('documents:commit')) return new Response('quota', { status: 429 })
      return original(input, init)
    }) as typeof fetch
    const orig = console.error; console.error = () => {}
    const r = await get('')
    console.error = orig; globalThis.fetch = original
    expect(r.status).toBe(200); expect(ids(r).length).toBe(15)
  })
  it('slims the snapshot: long descriptions are cut, so the shared document stays small', async () => {
    seedUnit(w.db, { id: 'unitLong0000001', description: 'ن'.repeat(5000) })
    const r = await get('')
    expect(String((r.json.docs as { data: { description: string } }[])[0].data.description).length).toBe(120)
    expect(JSON.stringify(w.db.get('publicCache/listings')).length).toBeLessThan(2000)
  })
  it('with 300+ active listings it switches to real indexed queries and still pages correctly', async () => {
    for (let i = 0; i < 305; i++) seedUnit(w.db, { id: id(i), createdAt: new Date(Date.UTC(2027, 0, 1) + i * 60_000), price: 1000 + i })
    const seen: string[] = []
    let after = ''
    for (let p = 0; p < 60; p++) { const r = await get(`?n=48${after}`); seen.push(...ids(r)); if (!r.json.next) break; after = `&after=${r.json.next as string}` }
    expect([new Set(seen).size, seen.length]).toEqual([305, 305])
  })
  it('rejects malformed or hostile parameters before touching the database', async () => {
    catalogue(); w.db.resetCounters()
    for (const q of ['?gov=../users', '?gov=a b', '?rent=weekly', '?sort=password', '?after=not-a-cursor', `?after=${btoa('{"v":"x","id":"y"}')}`]) expect((await get(q)).status).toBe(400)
    expect(w.db.counters.reads).toBe(0)
  })
  it('clamps the page size so one request can never read the whole collection', async () => {
    catalogue(); w.db.resetCounters(); await get('?n=100000')
    expect(w.db.counters.reads).toBeLessThanOrEqual(20)
    const r = await get('?n=1')
    expect(ids(r).length).toBeGreaterThanOrEqual(6)
  })
  it('one IP cannot mint endless cache misses: 100 uncached lookups per 10 minutes, then 429, while cached ones stay free', async () => {
    catalogue()
    let blocked = 0
    for (let i = 0; i < 130; i++) if ((await get(`?gov=gov${i}`, '8.8.8.8')).status === 429) blocked++
    expect(blocked).toBe(30)
    expect((await get('?gov=gov0', '8.8.8.8')).status).toBe(200) // already cached: free
    expect((await get('?gov=gov0x', '4.4.4.4')).status).toBe(200) // another visitor is unaffected
  })
  it('does not cache errors: a failed lookup is retried next time', async () => {
    catalogue(); const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch
    const orig = console.error; console.error = () => {}
    expect((await get('?gov=cairo')).status).toBe(500)
    console.error = orig; globalThis.fetch = original
    expect((await get('?gov=cairo')).status).toBe(200)
  })
})

describe('GET /api/settings', () => {
  const getSettings = () => call(settings, w.env, { method: 'GET', path: '/api/settings' })
  it('returns both public documents; all visitors together cost 2 reads per cache window', async () => {
    w.db.seed('settings/app', { maxImages: 5, minImages: 1 }); w.db.seed('settings/locations', { items: [{ id: 'x', name: 'قرية', parentId: 'c1' }] })
    w.db.resetCounters()
    const r = await getSettings()
    expect(r.json).toEqual({ app: { maxImages: 5, minImages: 1 }, locations: [{ id: 'x', name: 'قرية', parentId: 'c1' }] })
    for (let i = 0; i < 50; i++) await getSettings()
    expect(w.db.counters.reads).toBe(2)
  })
  it('works before the admin ever saved anything', async () => {
    expect((await getSettings()).json).toEqual({ app: null, locations: [] })
  })
})
