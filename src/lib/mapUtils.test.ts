import { describe, expect, it } from 'vitest'
import { EGYPT_CENTER, FALLBACK_TILES, clusterByGrid, geocodeUrl, googleMapsUrl, inEgypt, parseGeocode, roundCoord, tilesFor, toPin } from './mapUtils'

describe('inEgypt', () => {
  it('accepts points in Egypt and rejects the rest of the world, NaN and Infinity', () => {
    for (const p of [{ lat: 30.0444, lng: 31.2357 }, { lat: 31.2001, lng: 29.9187 }, { lat: 24.0889, lng: 32.8998 }, { lat: 27.9158, lng: 34.33 }]) expect(inEgypt(p)).toBe(true)
    for (const p of [{ lat: 51.5, lng: -0.12 }, { lat: 0, lng: 0 }, { lat: 25, lng: 55 }, { lat: NaN, lng: 31 }, { lat: 30, lng: Infinity }]) expect(inEgypt(p)).toBe(false)
    expect(inEgypt({ lat: EGYPT_CENTER[0], lng: EGYPT_CENTER[1] })).toBe(true)
  })
})

describe('coordinates', () => {
  it('rounds to 6 decimals (about 10 cm)', () => { expect(roundCoord(30.123456789)).toBe(30.123457); expect(toPin(31.99999999, 29.1)).toEqual({ lat: 32, lng: 29.1 }) })
})

describe('tiles', () => {
  it('light and dark use the matching CARTO styles with retina support, and subdomains for parallel loading', () => {
    expect(tilesFor(false).url).toContain('/voyager/'); expect(tilesFor(true).url).toContain('/dark_all/')
    for (const d of [false, true]) { const t = tilesFor(d); expect(t.url).toContain('{r}'); expect(t.subdomains).toBe('abcd'); expect(t.attribution).toContain('OpenStreetMap'); expect(t.attribution).toContain('CARTO') }
  })
  it('keeps plain OpenStreetMap as a fallback, with its own attribution', () => { expect(FALLBACK_TILES.url).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png'); expect(FALLBACK_TILES.attribution).toContain('OpenStreetMap') })
})

describe('googleMapsUrl', () => { it('points at the exact coordinates', () => { expect(googleMapsUrl({ lat: 30.0444, lng: 31.2357 })).toBe('https://www.google.com/maps/search/?api=1&query=30.0444,31.2357') }) })

describe('address search', () => {
  it('builds a request limited to Egypt, in Arabic, 5 results, safely encoded', () => {
    const u = new URL(geocodeUrl('  مدينة نصر & <script> '))
    expect(u.origin + u.pathname).toBe('https://nominatim.openstreetmap.org/search')
    expect([u.searchParams.get('countrycodes'), u.searchParams.get('accept-language'), u.searchParams.get('limit'), u.searchParams.get('format')]).toEqual(['eg', 'ar', '5', 'jsonv2'])
    expect(u.searchParams.get('q')).toBe('مدينة نصر & <script>')
  })
  const row = (lat: unknown, lon: unknown, name: unknown = 'مكان') => ({ lat, lon, display_name: name })
  it('keeps well-formed results inside Egypt and drops everything else', () => {
    const r = parseGeocode([row('30.0626', '31.3219', 'مدينة نصر، القاهرة'), row('51.5', '-0.12', 'London'), row('abc', '31'), row('30', '31', 42), null, 'x', row(undefined, '31')])
    expect(r).toEqual([{ lat: 30.0626, lng: 31.3219, label: 'مدينة نصر، القاهرة' }])
  })
  it('removes duplicates and caps the list at 5', () => {
    expect(parseGeocode([row('30.1', '31.1'), row('30.1', '31.1')])).toHaveLength(1)
    expect(parseGeocode(Array.from({ length: 9 }, (_, i) => row(String(30 + i / 100), '31')))).toHaveLength(5)
  })
  it('anything that is not a list gives an empty result (a failing or changed service never breaks the form)', () => {
    for (const v of [null, undefined, {}, 'oops', 5, { error: 'rate limited' }]) expect(parseGeocode(v)).toEqual([])
  })
  it('long labels are shortened', () => { expect(parseGeocode([row('30', '31', 'ن'.repeat(500))])[0].label).toHaveLength(120) })
})

describe('clusterByGrid', () => {
  const pts = (xs: [number, number][]) => xs.map(([x, y], i) => ({ id: `p${i}`, x, y }))
  it('every point ends up in exactly one cluster', () => {
    const points = pts(Array.from({ length: 200 }, (_, i) => [(i * 37) % 900, (i * 91) % 700] as [number, number]))
    const clusters = clusterByGrid(points, 64)
    const all = clusters.flatMap((c) => c.ids)
    expect([all.length, new Set(all).size]).toEqual([200, 200])
  })
  it('nearby points merge into one bubble centred between them; far points stay separate', () => {
    const c = clusterByGrid(pts([[10, 10], [30, 30], [500, 500]]), 64)
    expect(c).toHaveLength(2)
    expect(c[0].ids).toEqual(['p0', 'p1']); expect([c[0].x, c[0].y]).toEqual([20, 20])
    expect(c[1].ids).toEqual(['p2'])
  })
  it('zooming in (larger pixel distances) splits clusters apart', () => {
    const close = pts([[10, 10], [50, 50]])
    expect(clusterByGrid(close, 64)).toHaveLength(1)
    expect(clusterByGrid(close.map((p) => ({ ...p, x: p.x * 4, y: p.y * 4 })), 64)).toHaveLength(2)
  })
  it('handles empty input, identical points and a nonsense cell size', () => {
    expect(clusterByGrid([], 64)).toEqual([])
    expect(clusterByGrid(pts([[5, 5], [5, 5], [5, 5]]), 64)[0].ids).toHaveLength(3)
    expect(clusterByGrid(pts([[5, 5]]), 0)).toHaveLength(1)
    expect(clusterByGrid(pts([[-100, -100], [-90, -95]]), 64).flatMap((c) => c.ids)).toHaveLength(2) // negative coordinates are fine
  })
})
