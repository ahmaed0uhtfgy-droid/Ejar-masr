import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'
import { DEFAULT_SETTINGS } from './defaults'
import type { AppSettings, LocItem } from './types'

const TTL_MS = 10 * 60 * 1000
const KEY = 'ejar:settings:v1'

interface Cached { at: number; settings: AppSettings; locations: LocItem[] }

function readCache(): Cached | null {
  try {
    const s = sessionStorage.getItem(KEY)
    if (!s) return null
    const c = JSON.parse(s) as Cached
    return Date.now() - c.at < TTL_MS ? c : null
  } catch { return null }
}

export function clearSettingsCache(): void {
  try { sessionStorage.removeItem(KEY) } catch { /* ignore */ }
}

export function mergeSettings(d: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(d ?? {}),
    unitTypes: d?.unitTypes?.length ? d.unitTypes : DEFAULT_SETTINGS.unitTypes,
    amenities: d?.amenities ?? DEFAULT_SETTINGS.amenities,
  }
}

/** 2 document reads per cold session, 0 afterwards (10 minute sessionStorage cache). */
export async function loadSettings(force = false): Promise<{ settings: AppSettings; locations: LocItem[] }> {
  if (!force) {
    const c = readCache()
    if (c) return { settings: c.settings, locations: c.locations }
  }
  const [s, l] = await Promise.all([getDoc(doc(db, 'settings', 'app')), getDoc(doc(db, 'settings', 'locations'))])
  const settings = mergeSettings(s.exists() ? (s.data() as Partial<AppSettings>) : undefined)
  const locations = l.exists() ? ((l.data().items as LocItem[] | undefined) ?? []) : []
  try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), settings, locations } satisfies Cached)) } catch { /* ignore */ }
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
