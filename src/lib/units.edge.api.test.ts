import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetEdge } from './edgeApi'
import { latestUnits, searchUnits } from './units'

const doc = (i: number, over: Record<string, unknown> = {}) => ({ id: `u${i}`, data: { title: `وحدة ${i}`, price: 1000 + i, status: 'active', governorateId: 'cairo', rooms: 2, createdAt: { __ts: Date.UTC(2027, 0, 1 + i) }, expiresAt: null, images: [], amenities: [], ...over } })
let calls: string[] = []
const serve = (docs: ReturnType<typeof doc>[], next: string | null = null) => vi.stubGlobal('fetch', async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify({ docs, next })) })

beforeEach(() => { resetEdge(); calls = [] })
afterEach(() => { vi.unstubAllGlobals() })

describe('searchUnits through the edge API', () => {
  it('asks the API (not Firestore) with the server-side filters, and maps the listings', async () => {
    serve([doc(1), doc(2)])
    const page = await searchUnits({ governorateId: 'cairo', rentType: 'monthly' }, 'priceAsc')
    expect(calls).toHaveLength(1)
    const u = new URL(calls[0], 'https://x.test')
    expect([u.pathname, u.searchParams.get('gov'), u.searchParams.get('rent'), u.searchParams.get('sort')]).toEqual(['/api/units', 'cairo', 'monthly', 'priceAsc'])
    expect(page.items.map((x) => x.title)).toEqual(['وحدة 1', 'وحدة 2'])
    expect(page.items[0].createdAt).toBeInstanceOf(Date) // { __ts } became a real date
    expect(page.done).toBe(true)
  })
  it('keeps applying the client-side filters (rooms, price, ...) to what the API returns', async () => {
    serve([doc(1, { rooms: 1 }), doc(2, { rooms: 3 }), doc(3, { rooms: 3, price: 99999 })])
    const page = await searchUnits({ roomsMin: 3, priceMax: 5000 }, 'newest')
    expect(page.items.map((x) => x.id)).toEqual(['u2'])
  })
  it('returns a cursor for "load more" and sends it back as `after`', async () => {
    const full = Array.from({ length: 24 }, (_, i) => doc(i))
    serve(full, 'TOKEN123')
    const first = await searchUnits({}, 'newest', null, 12)
    expect(first.done).toBe(false)
    expect(first.cursor).toEqual({ api: 'TOKEN123', id: 'u23' })
    calls = []; serve([doc(30)], null)
    const second = await searchUnits({}, 'newest', first.cursor, 12)
    expect(new URL(calls[0], 'https://x.test').searchParams.get('after')).toBe('TOKEN123')
    expect(second.done).toBe(true)
  })
  it('a page that is exactly full with nothing after it is not requested again (no duplicates, no extra call)', async () => {
    serve(Array.from({ length: 24 }, (_, i) => doc(i)), null)
    const page = await searchUnits({}, 'newest', null, 12)
    expect(calls).toHaveLength(1)
    expect(page.done).toBe(true)
    expect(new Set(page.items.map((x) => x.id)).size).toBe(page.items.length)
  })
  it('hides expired and non-active listings exactly as before', async () => {
    serve([doc(1, { expiresAt: { __ts: Date.now() - 1000 } }), doc(2, { status: 'rented' }), doc(3)])
    expect((await searchUnits({}, 'newest')).items.map((x) => x.id)).toEqual(['u3'])
  })
})

describe('latestUnits through the edge API', () => {
  it('returns the newest n unexpired listings from one cached call', async () => {
    serve([doc(5), doc(4, { expiresAt: { __ts: Date.now() - 1000 } }), doc(3), doc(2), doc(1)])
    const r = await latestUnits(2)
    expect(r.map((x) => x.id)).toEqual(['u5', 'u3'])
    expect(calls).toHaveLength(1)
  })
})
