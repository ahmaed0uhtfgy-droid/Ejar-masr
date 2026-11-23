import { describe, expect, it } from 'vitest'
import { addDaysYmd, addMonthsYmd, buildTerms, daysBetween, feeCents, parseYmd, toCents, validCycles } from './rent'

const T = '2027-03-10'
const monthly = (over: Record<string, unknown> = {}) => buildTerms({ rentType: 'monthly', price: 5000, startDate: '2027-03-10', durationMonths: 12, cycleMonths: 1, ...over } as Parameters<typeof buildTerms>[0], T)

describe('parseYmd', () => {
  it('accepts real dates only', () => {
    expect(parseYmd('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 })
    for (const bad of ['2027-02-29', '2027-13-01', '2027-00-10', '2027-04-31', '2027-1-1', '27-01-01', '', ' 2027-01-01', '2027-01-01T00:00', null, undefined, 20270101, {}]) expect(parseYmd(bad)).toBeNull()
  })
})

describe('date arithmetic', () => {
  it('adds months across year ends, clamping to the last day', () => {
    expect(addMonthsYmd('2027-12-31', 2)).toBe('2028-02-29')
    expect(addMonthsYmd('2027-11-30', 3)).toBe('2028-02-29')
    expect(addMonthsYmd('2027-01-31', 13)).toBe('2028-02-29')
    expect(addMonthsYmd('2027-05-31', 1)).toBe('2027-06-30')
    expect(addMonthsYmd('2027-03-10', 0)).toBe('2027-03-10')
    expect(addMonthsYmd('2027-03-10', 24)).toBe('2029-03-10')
  })
  it('the end date of a lease started on the 31st is never earlier than its last installment start', () => {
    const r = monthly({ startDate: '2027-03-31', durationMonths: 12, cycleMonths: 1 })
    expect(r.ok).toBe(true)
    if (r.ok) { for (let i = 1; i < r.schedule.length; i++) expect(r.schedule[i].from >= r.schedule[i - 1].from).toBe(true); expect(r.endDate >= r.schedule[r.schedule.length - 1].from).toBe(true) }
  })
  it('adds days across month and leap-year boundaries', () => {
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29'); expect(addDaysYmd('2027-02-28', 1)).toBe('2027-03-01'); expect(addDaysYmd('2027-12-31', 1)).toBe('2028-01-01'); expect(addDaysYmd('2027-03-10', -10)).toBe('2027-02-28')
  })
  it('daysBetween is exact across daylight-saving changes (calendar days, not 24h blocks)', () => {
    expect(daysBetween('2027-04-29', '2027-05-01')).toBe(2); expect(daysBetween('2027-10-28', '2027-11-01')).toBe(4); expect(daysBetween('2027-03-10', '2027-03-10')).toBe(0)
  })
})

describe('money', () => {
  it('toCents rounds to the nearest cent', () => { expect([toCents(0), toCents(1), toCents(19.99), toCents(0.1 + 0.2), toCents(5000)]).toEqual([0, 100, 1999, 30, 500000]) })
  it('feeCents: rounds, clamps the percentage to 0-30 and survives garbage', () => {
    expect(feeCents(10000, 0)).toBe(0); expect(feeCents(10000, 10)).toBe(1000); expect(feeCents(10000, 99)).toBe(3000); expect(feeCents(333, 10)).toBe(33)
    for (const p of [NaN, Infinity, -Infinity]) expect(feeCents(10000, p)).toBe(p === Infinity ? 0 : 0)
    expect(feeCents(0, 10)).toBe(0)
  })
})

describe('buildTerms: schedules always add up', () => {
  it('every installment has the same amount and the total equals their sum, to the cent (no float drift)', () => {
    for (const price of [1234.56, 0.1, 999.99, 5000, 33.33, 1e6 + 0.07]) for (const [months, cycle] of [[12, 1], [6, 3], [24, 12], [12, 6], [9, 3]]) {
      const r = monthly({ price, durationMonths: months, cycleMonths: cycle })
      expect(r.ok).toBe(true)
      if (!r.ok) continue
      expect(r.schedule).toHaveLength(months / cycle)
      const sumCents = r.schedule.reduce((s, x) => s + toCents(x.amount), 0)
      expect(toCents(r.total)).toBe(sumCents)
      expect(r.total).toBe(sumCents / 100)
    }
  })
  it('installments are contiguous: each ends where the next begins, and the last ends at endDate', () => {
    const r = monthly({ durationMonths: 12, cycleMonths: 3 })
    if (!r.ok) throw new Error('expected ok')
    r.schedule.forEach((s, i) => { expect(s.dueDate).toBe(s.from); if (i) expect(s.from).toBe(r.schedule[i - 1].to) })
    expect(r.schedule[r.schedule.length - 1].to).toBe(r.endDate)
  })
  it('accepts starting today and the last allowed day (180 days ahead), rejects one day later', () => {
    expect(monthly({ startDate: T }).ok).toBe(true)
    expect(monthly({ startDate: addDaysYmd(T, 180) }).ok).toBe(true)
    expect(monthly({ startDate: addDaysYmd(T, 181) }).ok).toBe(false)
    expect(monthly({ startDate: addDaysYmd(T, -1) }).ok).toBe(false)
  })
  it.each([[0], [-1], [NaN], [Infinity], [-Infinity], ['5000'], [null], [undefined]])('rejects an invalid unit price: %j', (price) => {
    expect(monthly({ price }).ok).toBe(false)
    expect(buildTerms({ rentType: 'daily', price: price as number, startDate: T, days: 2 }, T).ok).toBe(false)
  })
  it('daily: 1 and 90 days are valid, 0 / 91 / fractions / NaN are not', () => {
    const d = (days: unknown) => buildTerms({ rentType: 'daily', price: 800, startDate: T, days: days as number }, T).ok
    expect([d(1), d(90), d(0), d(91), d(1.5), d(NaN), d(undefined), d(-3)]).toEqual([true, true, false, false, false, false, false, false])
    const r = buildTerms({ rentType: 'daily', price: 800, startDate: T, days: 90 }, T)
    if (r.ok) expect([r.endDate, r.total, r.schedule.length]).toEqual(['2027-06-08', 72000, 1])
  })
  it('error messages are Arabic text the UI can show', () => {
    const r = monthly({ durationMonths: 0 })
    expect(r.ok === false && /[\u0600-\u06FF]/.test(r.message)).toBe(true)
  })
  it('validCycles', () => { expect(validCycles(12)).toEqual([1, 3, 6, 12]); expect(validCycles(1)).toEqual([1]); expect(validCycles(0)).toEqual([1, 3, 6, 12]) })
})
