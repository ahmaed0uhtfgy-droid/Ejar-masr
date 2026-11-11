import { describe, expect, it } from 'vitest'
import { addMonthsYmd, buildTerms, daysBetween, feeCents, validCycles } from './rent'

describe('rent schedule', () => {
  it('clamps month ends', () => {
    expect(addMonthsYmd('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonthsYmd('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsYmd('2026-11-15', 3)).toBe('2027-02-15')
  })
  it('builds a monthly schedule', () => {
    const r = buildTerms({ rentType: 'monthly', price: 5000, startDate: '2026-12-01', durationMonths: 6, cycleMonths: 3 }, '2026-11-10')
    expect(r.ok && r.schedule.map((s) => [s.dueDate, s.amount])).toEqual([['2026-12-01', 15000], ['2027-03-01', 15000]])
    expect(r.ok && r.total).toBe(30000)
    expect(r.ok && r.endDate).toBe('2027-06-01')
  })
  it('builds a single daily payment', () => {
    const r = buildTerms({ rentType: 'daily', price: 800, startDate: '2026-11-20', days: 5 }, '2026-11-10')
    expect(r.ok && r.schedule).toHaveLength(1)
    expect(r.ok && r.total).toBe(4000)
  })
  it('rejects bad input', () => {
    const base = { rentType: 'monthly' as const, price: 1000, durationMonths: 5, cycleMonths: 3 }
    expect(buildTerms({ ...base, startDate: '2026-12-01' }, '2026-11-10').ok).toBe(false)
    expect(buildTerms({ ...base, durationMonths: 6, startDate: '2026-11-01' }, '2026-11-10').ok).toBe(false)
    expect(buildTerms({ ...base, durationMonths: 6, startDate: '2027-12-01' }, '2026-11-10').ok).toBe(false)
    expect(buildTerms({ ...base, durationMonths: 6, startDate: '2026-02-31' }, '2026-01-10').ok).toBe(false)
  })
  it('fees and cycles', () => {
    expect(feeCents(1000000, 2.5)).toBe(25000)
    expect(feeCents(1000, -5)).toBe(0)
    expect(validCycles(6)).toEqual([1, 3, 6])
    expect(validCycles(5)).toEqual([1])
  })
  it('honours admin limits', () => {
    const t = { rentType: 'monthly' as const, price: 1000, startDate: '2026-12-01', durationMonths: 12, cycleMonths: 3 }
    expect(buildTerms(t, '2026-11-10', { maxMonths: 6, cycles: [1, 3] }).ok).toBe(false)
    expect(buildTerms(t, '2026-11-10', { maxMonths: 24, cycles: [1, 6] }).ok).toBe(false)
    expect(buildTerms(t, '2026-11-10', { maxMonths: 24, cycles: [1, 3] }).ok).toBe(true)
    expect(validCycles(12, [1, 6])).toEqual([1, 6])
  })
  it('counts days', () => {
    expect(daysBetween('2026-11-11', '2026-11-14')).toBe(3)
    expect(daysBetween('2026-11-14', '2026-11-11')).toBe(-3)
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1)
  })
})
