import { Timestamp } from 'firebase/firestore'
import { filtersToParams, mapUnit, matchesFilters, paramsToFilters } from './units'

describe('mapUnit (never trust stored shapes)', () => {
  it('an empty document becomes a safe, inert unit', () => {
    expect(mapUnit('u', {})).toMatchObject({ id: 'u', title: '', price: 0, deposit: null, lat: null, lng: null, images: [], amenities: [], status: 'active', rentType: 'monthly', ownerType: 'owner', depositMode: 'none', createdAt: null, expiresAt: null })
  })
  it('wrong types fall back instead of leaking through (strings for numbers, non-arrays for lists)', () => {
    const u = mapUnit('u', { price: '3000', deposit: '500', lat: '30.1', images: 'a.jpg', amenities: { a: 1 }, rentType: 'weekly', ownerType: 'agency', createdAt: '2027-01-01' })
    expect(u).toMatchObject({ price: 3000, deposit: null, lat: null, images: [], amenities: [], rentType: 'monthly', ownerType: 'owner', createdAt: null })
  })
  it('converts Timestamps', () => { expect(mapUnit('u', { expiresAt: Timestamp.fromDate(new Date('2027-05-01T00:00:00Z')) }).expiresAt?.toISOString()).toBe('2027-05-01T00:00:00.000Z') })
})

describe('matchesFilters edge cases', () => {
  const u = (o: Record<string, unknown> = {}) => mapUnit('u', { status: 'active', price: 3000, rooms: 2, typeId: 'apartment', ...o })
  it('price bounds are inclusive and 0 is a real bound', () => {
    expect(matchesFilters(u(), { priceMin: 3000, priceMax: 3000 })).toBe(true)
    expect(matchesFilters(u(), { priceMax: 0 })).toBe(false)
    expect(matchesFilters(u({ price: 0 }), { priceMax: 0 })).toBe(true)
  })
  it('an empty amenities array filters nothing', () => { expect(matchesFilters(u(), { amenities: [] })).toBe(true) })
  it('an expiry exactly now counts as expired', () => {
    const now = new Date('2027-03-10T10:00:00Z')
    expect(matchesFilters(u({ expiresAt: Timestamp.fromDate(now) }), {}, now)).toBe(false)
  })
  it('rented, hidden and removed units never match', () => { for (const status of ['rented', 'hidden', 'removed']) expect(matchesFilters(u({ status }), {})).toBe(false) })
})

describe('URL <-> filters', () => {
  it('an empty search gives an empty query string', () => { expect(filtersToParams({}, 'newest', 'list').toString()).toBe('') })
  it('0 and false behave: pmin=0 is kept, student=false is dropped', () => {
    const p = filtersToParams({ priceMin: 0, student: false }, 'newest', 'list')
    expect(p.get('pmin')).toBe('0'); expect(p.has('student')).toBe(false)
  })
  it('hostile query strings are parsed into harmless values', () => {
    const r = paramsToFilters(new URLSearchParams('gov=<script>&pmax=Infinity&rooms=-1&am=,,a,,&sort=priceDesc&view=map&student=1'))
    expect(r.filters.governorateId).toBe('<script>') // kept as plain text; it is only ever compared, never rendered as HTML
    expect(r.filters.priceMax).toBeUndefined(); expect(r.filters.amenities).toEqual(['a']); expect(r.filters.student).toBeUndefined()
    expect([r.sort, r.view]).toEqual(['priceDesc', 'map'])
  })
})
