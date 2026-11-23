/** Pure helpers behind the map components (no Leaflet, no DOM), so they can be tested. */

export interface Pin { lat: number; lng: number }
export const EGYPT_CENTER: [number, number] = [26.8, 30.8]
export const inEgypt = (p: Pin): boolean => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= 21.5 && p.lat <= 32 && p.lng >= 24.5 && p.lng <= 37

/** 6 decimals is about 10 cm: more is false precision. */
export const roundCoord = (n: number): number => Math.round(n * 1e6) / 1e6
export const toPin = (lat: number, lng: number): Pin => ({ lat: roundCoord(lat), lng: roundCoord(lng) })

export interface TileSet { url: string; attribution: string; maxZoom: number; subdomains: string; retina: boolean }
const ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'
/**
 * CARTO's basemaps are drawn for web maps: clear streets, readable Arabic labels, sharp on phones ({r} = retina), and a dark version that matches the
 * site's dark theme. OpenStreetMap's own tiles stay as the automatic fallback if CARTO is unreachable.
 */
export const tilesFor = (dark: boolean): TileSet => ({
  url: `https://{s}.basemaps.cartocdn.com/rastertiles/${dark ? 'dark_all' : 'voyager'}/{z}/{x}/{y}{r}.png`,
  attribution: ATTR, maxZoom: 20, subdomains: 'abcd', retina: true,
})
export const FALLBACK_TILES: TileSet = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19, subdomains: 'abc', retina: false }

/** Opens the exact point in Google Maps (directions, street view, satellite): the easiest way for a visitor to double-check a location. */
export const googleMapsUrl = (p: Pin): string => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`

// ---------- address search (OpenStreetMap Nominatim; only ever called when the user presses the search button) ----------
export const geocodeUrl = (q: string): string => `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', q: q.trim(), countrycodes: 'eg', 'accept-language': 'ar', limit: '5' }).toString()}`

export interface Place extends Pin { label: string }
/** Validates Nominatim's answer: only well-formed results that are really inside Egypt, no duplicates, at most 5. */
export function parseGeocode(raw: unknown): Place[] {
  if (!Array.isArray(raw)) return []
  const out: Place[] = []
  for (const r of raw as unknown[]) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const lat = Number(o.lat); const lng = Number(o.lon)
    if (typeof o.lat !== 'string' && typeof o.lat !== 'number') continue
    if (typeof o.lon !== 'string' && typeof o.lon !== 'number') continue
    const p = toPin(lat, lng)
    if (!inEgypt(p) || typeof o.display_name !== 'string') continue
    if (out.some((x) => x.lat === p.lat && x.lng === p.lng)) continue
    out.push({ ...p, label: o.display_name.slice(0, 120) })
    if (out.length === 5) break
  }
  return out
}

// ---------- clustering ----------
export interface Point { id: string; x: number; y: number }
export interface Cluster { ids: string[]; x: number; y: number }
/**
 * Groups points that are closer than about `cell` pixels (screen pixels at the current zoom), so overlapping price tags turn into one numbered bubble
 * that splits as you zoom in. Order is stable and every point lands in exactly one cluster.
 */
export function clusterByGrid(points: Point[], cell: number): Cluster[] {
  const size = Math.max(1, cell)
  const cells = new Map<string, { ids: string[]; sx: number; sy: number }>()
  for (const p of points) {
    const key = `${Math.floor(p.x / size)}:${Math.floor(p.y / size)}`
    const c = cells.get(key) ?? { ids: [], sx: 0, sy: 0 }
    c.ids.push(p.id); c.sx += p.x; c.sy += p.y
    cells.set(key, c)
  }
  return [...cells.values()].map((c) => ({ ids: c.ids, x: c.sx / c.ids.length, y: c.sy / c.ids.length }))
}
