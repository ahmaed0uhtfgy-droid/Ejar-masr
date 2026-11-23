import { Timestamp } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { edgeAvailable, fetchEdge, markEdgeDown, resetEdge, revive } from './edgeApi'

beforeEach(resetEdge)
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('revive', () => {
  it('turns { __ts } markers back into Firestore Timestamps, at any depth, and leaves everything else alone', () => {
    const out = revive({ a: { __ts: 1_800_000_000_000 }, list: [{ __ts: 5 }, 'x', 7, null, true], nested: { deep: { __ts: 10 } }, plain: { __ts: 'not-a-number' }, extra: { __ts: 1, other: 2 } }) as Record<string, unknown>
    expect(out.a).toBeInstanceOf(Timestamp)
    expect((out.a as Timestamp).toDate().getTime()).toBe(1_800_000_000_000)
    expect((out.list as unknown[]).slice(1)).toEqual(['x', 7, null, true])
    expect((out.list as unknown[])[0]).toBeInstanceOf(Timestamp)
    expect(((out.nested as { deep: unknown }).deep)).toBeInstanceOf(Timestamp)
    expect(out.plain).toEqual({ __ts: 'not-a-number' })
    expect(out.extra).toEqual({ __ts: 1, other: 2 })
  })
  it('handles primitives and empty values', () => { expect(revive(null)).toBeNull(); expect(revive(5)).toBe(5); expect(revive('s')).toBe('s'); expect(revive([])).toEqual([]); expect(revive({})).toEqual({}) })
})

describe('fetchEdge and the circuit breaker', () => {
  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: 1 })))
    expect(await fetchEdge<{ ok: number }>('/api/x')).toEqual({ ok: 1 })
  })
  it('rejects on HTTP errors (404 in local dev, 429 rate limit, 500)', async () => {
    for (const status of [404, 429, 500]) {
      vi.stubGlobal('fetch', async () => new Response('x', { status }))
      await expect(fetchEdge('/api/x')).rejects.toThrow(String(status))
    }
  })
  it('gives up after the timeout instead of keeping the visitor waiting', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) => new Promise((_res, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('aborted'))) }))
    const t0 = Date.now()
    await expect(fetchEdge('/api/slow', 30)).rejects.toThrow('aborted')
    expect(Date.now() - t0).toBeLessThan(1500)
  })
  it('after a failure the API is skipped for 2 minutes, then tried again', () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2027-03-10T10:00:00Z'))
    expect(edgeAvailable()).toBe(true)
    markEdgeDown()
    expect(edgeAvailable()).toBe(false)
    vi.setSystemTime(new Date('2027-03-10T10:01:59Z')); expect(edgeAvailable()).toBe(false)
    vi.setSystemTime(new Date('2027-03-10T10:02:01Z')); expect(edgeAvailable()).toBe(true)
  })
})
