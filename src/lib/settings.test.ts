import { DEFAULT_SETTINGS } from './defaultSettings'
import { mergeSettings } from './settingsStore'

describe('mergeSettings (admin document over defaults)', () => {
  it('returns the defaults when there is no stored document', () => { expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS) })
  it('stored values win, but empty type lists fall back to the defaults', () => {
    const s = mergeSettings({ maxImages: 3, unitTypes: [] })
    expect(s.maxImages).toBe(3); expect(s.unitTypes).toEqual(DEFAULT_SETTINGS.unitTypes); expect(s.minImages).toBe(DEFAULT_SETTINGS.minImages)
  })
  it('an admin-defined list of unit types replaces the defaults', () => {
    expect(mergeSettings({ unitTypes: [{ id: 'tent', label: 'خيمة' }] }).unitTypes).toEqual([{ id: 'tent', label: 'خيمة' }])
  })
  it('defaults are sane: at least 1 image required, at most 10, 20 reveals a day', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ minImages: 1, maxImages: 10, dailyRevealLimit: 20 })
    expect(DEFAULT_SETTINGS.unitTypes.length).toBeGreaterThan(0)
    expect(new Set(DEFAULT_SETTINGS.unitTypes.map((t) => t.id)).size).toBe(DEFAULT_SETTINGS.unitTypes.length)
  })
})
