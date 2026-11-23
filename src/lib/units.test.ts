import { filtersToParams, matchesFilters, mapUnit, paramsToFilters } from './units'
import type { Unit } from './types'

const base = (over: Partial<Unit> = {}): Unit => ({ ...mapUnit('abc', { status: 'active', price: 3000, rooms: 2, bathrooms: 1, area: 90, typeId: 'apartment', governorateId: 'g1', areaId: 'c1', rentType: 'monthly', amenities: ['elevator', 'ac'], audience: 'all', ownerType: 'owner' }), ...over })

describe('matchesFilters', () => {
  it('rejects non-active and expired units', () => {
    expect(matchesFilters(base({ status: 'hidden' }), {})).toBe(false)
    expect(matchesFilters(base({ expiresAt: new Date(Date.now() - 1000) }), {})).toBe(false)
    expect(matchesFilters(base({ expiresAt: new Date(Date.now() + 100000) }), {})).toBe(true)
  })
  it('applies numeric filters', () => {
    expect(matchesFilters(base(), { priceMin: 2000, priceMax: 3000 })).toBe(true)
    expect(matchesFilters(base(), { priceMax: 2999 })).toBe(false)
    expect(matchesFilters(base(), { roomsMin: 3 })).toBe(false)
    expect(matchesFilters(base(), { areaMin: 90 })).toBe(true)
  })
  it('requires all selected amenities', () => {
    expect(matchesFilters(base(), { amenities: ['elevator'] })).toBe(true)
    expect(matchesFilters(base(), { amenities: ['elevator', 'parking'] })).toBe(false)
  })
  it('treats audience "all" units as matching any audience filter', () => {
    expect(matchesFilters(base({ audience: 'all' }), { audience: 'families' })).toBe(true)
    expect(matchesFilters(base({ audience: 'singles' }), { audience: 'families' })).toBe(false)
  })
  it('handles furnished / student / owner type', () => {
    expect(matchesFilters(base({ furnished: true }), { furnished: 'no' })).toBe(false)
    expect(matchesFilters(base({ studentHousing: false }), { student: true })).toBe(false)
    expect(matchesFilters(base({ ownerType: 'broker' }), { ownerType: 'owner' })).toBe(false)
  })
})

describe('URL params', () => {
  it('round-trips filters, sort and view', () => {
    const f = { governorateId: 'g1', typeId: 'villa', priceMax: 5000, amenities: ['ac', 'gas'], student: true, furnished: 'yes' as const }
    const p = filtersToParams(f, 'priceAsc', 'map')
    const r = paramsToFilters(new URLSearchParams(p.toString()))
    expect(r.filters).toMatchObject(f)
    expect(r.sort).toBe('priceAsc')
    expect(r.view).toBe('map')
  })
  it('ignores junk values', () => {
    const r = paramsToFilters(new URLSearchParams('pmin=abc&sort=hack&rent=weekly&furn=maybe'))
    expect(r.filters.priceMin).toBeUndefined()
    expect(r.filters.rentType).toBeUndefined()
    expect(r.filters.furnished).toBeUndefined()
    expect(r.sort).toBe('newest')
  })
})
