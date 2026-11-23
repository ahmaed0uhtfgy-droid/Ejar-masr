import { Timestamp } from 'firebase/firestore'
import { fmtYmd, mapLease, mapPayment, todayYmd } from './rentals'

describe('mapLease / mapPayment (Firestore document -> typed object)', () => {
  it('fills safe defaults for an empty document, so the UI never sees undefined', () => {
    const l = mapLease('l1', {})
    expect(l).toMatchObject({ id: 'l1', unitId: '', status: 'requested', rentType: 'monthly', price: 0, installments: 1, depositMode: 'none', depositCents: 0, feePayer: 'owner', moveInIssue: false, firstPaidAt: null, depositStatus: 'none' })
    const p = mapPayment('p1', {})
    expect(p).toMatchObject({ id: 'p1', index: 0, amount: 0, status: 'due', payoutStatus: 'none', paidAt: null })
  })
  it('converts Timestamps to Dates and ignores anything else', () => {
    const when = new Date('2027-03-10T10:00:00Z')
    expect(mapLease('l', { firstPaidAt: Timestamp.fromDate(when), moveInConfirmedAt: 'yesterday', createdAt: 5 }).firstPaidAt?.toISOString()).toBe(when.toISOString())
    expect(mapLease('l', { moveInConfirmedAt: 'yesterday' }).moveInConfirmedAt).toBeNull()
    expect(mapPayment('p', { paidAt: Timestamp.fromDate(when) }).paidAt?.toISOString()).toBe(when.toISOString())
  })
  it('whitelists enum-like fields (unknown values fall back)', () => {
    expect(mapLease('l', { rentType: 'weekly', depositMode: 'x', feePayer: 'platform' })).toMatchObject({ rentType: 'monthly', depositMode: 'none', feePayer: 'owner' })
    expect(mapLease('l', { rentType: 'daily', depositMode: 'held-auto', feePayer: 'split' })).toMatchObject({ rentType: 'daily', depositMode: 'held-auto', feePayer: 'split' })
  })
  it('keeps numeric-or-null fields as null when absent', () => { expect(mapLease('l', {})).toMatchObject({ durationMonths: null, cycleMonths: null, days: null, reminderDays: null }) })
})

describe('dates', () => {
  it('fmtYmd formats a calendar day without timezone shifts and returns bad input unchanged', () => {
    expect(fmtYmd('2027-03-10')).toMatch(/١٠/); expect(fmtYmd('2027-12-31')).toMatch(/٣١/)
    expect(fmtYmd('garbage')).toBe('garbage'); expect(fmtYmd('')).toBe('')
  })
  it('todayYmd is a YYYY-MM-DD string', () => { expect(todayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/) })
})
