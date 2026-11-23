import { beforeEach, describe, expect, it, vi } from 'vitest'

const count = vi.fn().mockResolvedValue({ data: () => ({ count: 7 }) })
vi.mock('./firebase', () => ({ db: {} }))
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), query: vi.fn(), where: vi.fn(), getCountFromServer: (...a: unknown[]) => count(...a), Timestamp: { fromMillis: (n: number) => n } }))

import { activeUnitCount } from './stats'
import { resetEdge } from './edgeApi'

beforeEach(() => { localStorage.clear(); count.mockClear(); resetEdge(); vi.unstubAllGlobals() })

describe('activeUnitCount (home page statistic)', () => {
  it('uses the total from the edge-cached listings answer: no database read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ docs: [], next: null, total: 42 }))))
    expect(await activeUnitCount()).toBe(42)
    expect(count).not.toHaveBeenCalled()
  })
  it('remembers the number for 10 minutes (second call makes no request at all)', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ docs: [], total: 5 })))
    vi.stubGlobal('fetch', f)
    await activeUnitCount(); await activeUnitCount()
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('with 300+ listings (no total) or when the edge is down, falls back to the one aggregation read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ docs: [], next: null }))))
    expect(await activeUnitCount()).toBe(7)
    localStorage.clear(); resetEdge()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')))
    expect(await activeUnitCount()).toBe(7)
    expect(count).toHaveBeenCalledTimes(2)
  })
})
