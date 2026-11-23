import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from './defaults'
import { resetEdge } from './edgeApi'
import { clearSettingsCache, loadSettings } from './settingsStore'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, clear: () => m.clear() }
}
let calls = 0
beforeEach(() => {
  resetEdge(); calls = 0
  vi.stubGlobal('localStorage', fakeStorage()); vi.stubGlobal('sessionStorage', fakeStorage())
  vi.stubGlobal('fetch', async () => { calls++; return new Response(JSON.stringify({ app: { maxImages: 4, updatedAt: { __ts: 5 } }, locations: [{ id: 'x', name: 'قرية', parentId: 'c1' }] })) })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('loadSettings', () => {
  it('uses the edge API: no Firestore read for the visitor', async () => {
    const r = await loadSettings()
    expect(calls).toBe(1)
    expect(r.settings.maxImages).toBe(4)
    expect(r.settings.minImages).toBe(DEFAULT_SETTINGS.minImages) // merged over defaults
    expect(r.locations).toEqual([{ id: 'x', name: 'قرية', parentId: 'c1' }])
  })
  it('a second call (another page, another tab, a later visit) costs nothing at all', async () => {
    await loadSettings(); await loadSettings(); await loadSettings()
    expect(calls).toBe(1)
  })
  it('the cache is cleared when the admin saves, so the next load fetches again', async () => {
    await loadSettings(); clearSettingsCache(); await loadSettings()
    expect(calls).toBe(2)
  })
  it('an empty settings document falls back to the built-in defaults', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ app: null, locations: null })))
    const r = await loadSettings()
    expect(r.settings).toEqual(DEFAULT_SETTINGS); expect(r.locations).toEqual([])
  })
  it('a corrupt cache entry is ignored, not fatal', async () => {
    localStorage.setItem('ejar:settings:v2', '{not json')
    expect((await loadSettings()).settings.maxImages).toBe(4)
  })
})
