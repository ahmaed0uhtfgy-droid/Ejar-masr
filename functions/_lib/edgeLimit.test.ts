// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { batchCount, edgeCached, overLimit } from './edgeLimit'

function fakeCaches() {
  const store = new Map<string, Response>()
  return { default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, x: Response) => { store.set(r.url, x) }, delete: async (r: Request) => store.delete(r.url) } }
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-03-10T10:00:00Z')); vi.stubGlobal('caches', fakeCaches()) })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('overLimit', () => {
  it('allows `max` hits and blocks the next ones', async () => {
    const r: boolean[] = []
    for (let i = 0; i < 5; i++) r.push(await overLimit('k', 3, 60))
    expect(r).toEqual([false, false, false, true, true])
  })
  it('keys are independent', async () => {
    for (let i = 0; i < 3; i++) await overLimit('a', 3, 60)
    expect(await overLimit('a', 3, 60)).toBe(true)
    expect(await overLimit('b', 3, 60)).toBe(false)
  })
  it('a new window starts with a clean count', async () => {
    for (let i = 0; i < 4; i++) await overLimit('k', 3, 60)
    vi.setSystemTime(new Date('2027-03-10T10:01:05Z'))
    expect(await overLimit('k', 3, 60)).toBe(false)
  })
  it('keys containing slashes or odd characters cannot collide with other keys', async () => {
    for (let i = 0; i < 3; i++) await overLimit('x/1', 3, 60)
    expect(await overLimit('x', 3, 60)).toBe(false)
  })
  it('fails OPEN: no cache, or a broken cache, never blocks anybody', async () => {
    vi.stubGlobal('caches', undefined)
    expect(await overLimit('k', 1, 60)).toBe(false); expect(await overLimit('k', 1, 60)).toBe(false)
    vi.stubGlobal('caches', { default: { match: async () => { throw new Error('boom') }, put: async () => { throw new Error('boom') } } })
    expect(await overLimit('k', 1, 60)).toBe(false)
  })
})

describe('edgeCached', () => {
  it('loads once and serves the stored value afterwards', async () => {
    let calls = 0
    const load = async () => { calls++; return { a: calls } }
    expect(await edgeCached('k', 60, load)).toEqual({ a: 1 })
    expect(await edgeCached('k', 60, load)).toEqual({ a: 1 })
    expect(calls).toBe(1)
  })
  it('works (without caching) when the cache is unavailable', async () => {
    vi.stubGlobal('caches', undefined)
    let calls = 0
    await edgeCached('k', 60, async () => ++calls); await edgeCached('k', 60, async () => ++calls)
    expect(calls).toBe(2)
  })
})

describe('batchCount', () => {
  it('returns 0 until the threshold, then the whole batch, then starts again', async () => {
    const out: number[] = []
    for (let i = 0; i < 12; i++) out.push(await batchCount('u1', 5))
    expect(out).toEqual([0, 0, 0, 0, 5, 0, 0, 0, 0, 5, 0, 0])
  })
  it('keys are independent', async () => { await batchCount('a', 2); expect(await batchCount('b', 2)).toBe(0); expect(await batchCount('a', 2)).toBe(2) })
  it('without a cache every event is written (nothing is silently lost)', async () => { vi.stubGlobal('caches', undefined); expect(await batchCount('a', 5)).toBe(1) })
})
