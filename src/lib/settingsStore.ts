import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { DEFAULT_SETTINGS } from './defaults'
import { normalizeDesign } from './designIds'
import { edgeAvailable, fetchEdge, markEdgeDown, revive } from './edgeApi'
import type { AppSettings, LocItem } from './types'

// localStorage (shared by every tab and kept between visits) instead of sessionStorage: a returning visitor costs nothing.
const TTL_MS = 15 * 60 * 1000
const KEY = 'ejar:settings:v2'

interface Cached { at: number; settings: AppSettings; locations: LocItem[] }

function readCache(): Cached | null {
  try {
    const s = localStorage.getItem(KEY)
    if (!s) return null
    const c = JSON.parse(s) as Cached
    return Date.now() - c.at < TTL_MS ? c : null
  } catch { return null }
}

export function clearSettingsCache(): void {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem('ejar:settings:v1') } catch { /* ignore */ }
}

export function mergeSettings(d: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(d ?? {}),
    design: normalizeDesign(d?.design),
    unitTypes: d?.unitTypes?.length ? d.unitTypes : DEFAULT_SETTINGS.unitTypes,
    amenities: d?.amenities ?? DEFAULT_SETTINGS.amenities,
  }
}

/**
 * Cached 15 min in localStorage. A cold visitor is served by the edge-cached /api/settings (0 Firestore reads for them: all visitors share
 * 2 reads per 10 minutes); if that is unavailable the two documents are read directly. `force` (admin screens) always reads Firestore.
 */
export async function loadSettings(force = false): Promise<{ settings: AppSettings; locations: LocItem[] }> {
  if (!force) {
    const c = readCache()
    if (c) return { settings: c.settings, locations: c.locations }
  }
  let settings: AppSettings | null = null
  let locations: LocItem[] = []
  if (!force && edgeAvailable()) {
    try {
      const r = await fetchEdge<{ app: Record<string, unknown> | null; locations: LocItem[] | null }>('/api/settings')
      settings = mergeSettings(r.app ? (revive(r.app) as Partial<AppSettings>) : undefined)
      locations = r.locations ?? []
    } catch { markEdgeDown() }
  }
  if (!settings) {
    const [s, l] = await Promise.all([getDoc(doc(db, 'settings', 'app')), getDoc(doc(db, 'settings', 'locations'))])
    settings = mergeSettings(s.exists() ? (s.data() as Partial<AppSettings>) : undefined)
    locations = l.exists() ? ((l.data().items as LocItem[] | undefined) ?? []) : []
  }
  try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), settings, locations } satisfies Cached)) } catch { /* ignore */ }
  return { settings, locations }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await setDoc(doc(db, 'settings', 'app'), { ...settings, updatedAt: serverTimestamp() })
  clearSettingsCache()
}

export async function saveLocations(items: LocItem[]): Promise<void> {
  await setDoc(doc(db, 'settings', 'locations'), { items, updatedAt: serverTimestamp() })
  clearSettingsCache()
}
