// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { closeLeaseWrites } from './leasing'
import { PAY_DEFAULTS, PHONE_RE, depositModeOf, limitsOf, newId, normalizePaySettings, splitFee } from './rentdb'
import type { Doc } from './firestore'

describe('normalizePaySettings (admin-editable document -> safe values)', () => {
  it('uses the defaults for an empty or missing document', () => {
    expect(normalizePaySettings(undefined)).toEqual(PAY_DEFAULTS)
    expect(normalizePaySettings({})).toEqual(PAY_DEFAULTS)
  })
  it('clamps absurd values into their allowed range', () => {
    const s = normalizePaySettings({ platformFeePercent: 500, depositClaimDays: -5, maxLeaseMonths: 9999, defaultReminderDays: 0, maxOpenRequests: 1000, cancelFeePercent: 150, payoutDays: 999, refundDays: 0, disputeDays: 999, firstPayoutCapEgp: -1 })
    expect(s).toMatchObject({ platformFeePercent: 30, depositClaimDays: 0, maxLeaseMonths: 60, defaultReminderDays: 1, maxOpenRequests: 20, cancelFeePercent: 100, payoutDays: 60, refundDays: 1, disputeDays: 60, firstPayoutCapEgp: 0 })
  })
  it('falls back to defaults for NaN-ish junk (null, text, objects)', () => {
    const s = normalizePaySettings({ platformFeePercent: 'lots', maxLeaseMonths: {}, maxOpenRequests: undefined, payoutDays: NaN })
    expect(s.platformFeePercent).toBe(PAY_DEFAULTS.platformFeePercent); expect(s.maxLeaseMonths).toBe(PAY_DEFAULTS.maxLeaseMonths); expect(s.payoutDays).toBe(PAY_DEFAULTS.payoutDays)
  })
  it('only the explicit value false switches payments off', () => {
    expect(normalizePaySettings({ paymentsEnabled: false }).paymentsEnabled).toBe(false)
    for (const v of [undefined, null, 0, '', 'false']) expect(normalizePaySettings({ paymentsEnabled: v }).paymentsEnabled).toBe(true)
  })
  it('only allows known cycles, fee payers and cancel modes', () => {
    expect(normalizePaySettings({ cycles: [1, 2, 3, 7, '6'] }).cycles).toEqual([1, 3, 6])
    expect(normalizePaySettings({ cycles: [2, 5] }).cycles).toEqual([1, 3, 6, 12])
    expect(normalizePaySettings({ cycles: 'all' }).cycles).toEqual([1, 3, 6, 12])
    expect(normalizePaySettings({ feePayer: 'platform' }).feePayer).toBe('owner')
    expect(normalizePaySettings({ feePayer: 'split' }).feePayer).toBe('split')
    expect(normalizePaySettings({ cancelAfterPayment: 'always' }).cancelAfterPayment).toBe('blocked')
  })
  it('limitsOf exposes what buildTerms needs', () => { expect(limitsOf(normalizePaySettings({ maxLeaseMonths: 12, cycles: [1, 12] }))).toEqual({ maxMonths: 12, cycles: [1, 12] }) })
})

describe('splitFee', () => {
  it.each([[1001, 'owner', 0, 1001], [1001, 'tenant', 1001, 0], [1001, 'split', 501, 500], [0, 'split', 0, 0]] as const)('fee %i paid by %s', (fee, payer, tenant, owner) => {
    expect(splitFee(fee, payer)).toEqual({ tenant, owner })
  })
  it('never loses or creates a cent', () => { for (const fee of [1, 2, 3, 99, 12345]) for (const p of ['owner', 'tenant', 'split'] as const) { const s = splitFee(fee, p); expect(s.tenant + s.owner).toBe(fee) } })
})

describe('small helpers', () => {
  it('newId is 20 url-safe characters, valid as a document id, and does not repeat', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()))
    expect(ids.size).toBe(500)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9]{20}$/)
    expect(newId(6)).toHaveLength(6)
  })
  it('depositModeOf falls back to "none"', () => {
    expect([depositModeOf('held-claim'), depositModeOf('held-auto'), depositModeOf('x'), depositModeOf(undefined), depositModeOf(null)]).toEqual(['held-claim', 'held-auto', 'none', 'none', 'none'])
  })
  it('PHONE_RE accepts normal numbers and nothing that could carry markup', () => {
    for (const ok of ['01012345678', '+20 101 234 5678', '0020 1012345678']) expect(PHONE_RE.test(ok)).toBe(true)
    for (const bad of ['', '1234567', '<script>', '0101-2345678', '01012345678\n<b>', 'a'.repeat(10), '1'.repeat(21)]) expect(PHONE_RE.test(bad)).toBe(false)
  })
})

describe('closeLeaseWrites', () => {
  const S = normalizePaySettings({ depositClaimDays: 3 })
  const pay = (id: string, status: string): Doc => ({ id, data: { status } })
  const L = { unitId: 'u1', depositStatus: 'none', depositMode: 'none' }
  it('cancels only unpaid installments (due, failed, pending) and never paid/refunded ones', () => {
    const w = closeLeaseWrites('l1', L, 'ended', [pay('a', 'due'), pay('b', 'failed'), pay('c', 'pending'), pay('d', 'paid'), pay('e', 'refunded'), pay('f', 'cancelled')], null, '2027-03-10', S)
    expect(w.filter((x) => x.path.startsWith('payments/')).map((x) => x.path)).toEqual(['payments/a', 'payments/b', 'payments/c'])
  })
  it('opens the claim window only for held deposits (claim mode: N days, auto mode: closes today)', () => {
    const d = (over: Record<string, unknown>) => (closeLeaseWrites('l1', { ...L, ...over }, 'ended', [], null, '2027-03-10', S)[0] as { data: Record<string, unknown> }).data
    expect(d({ depositStatus: 'held', depositMode: 'held-claim' }).depositClaimUntil).toBe('2027-03-13')
    expect(d({ depositStatus: 'held', depositMode: 'held-auto' }).depositClaimUntil).toBe('2027-03-10')
    expect(d({ depositStatus: 'unpaid' }).depositStatus).toBe('none')
    expect(d({ depositStatus: 'none' }).depositClaimUntil).toBeUndefined()
  })
  it('only re-lists a unit that this lease locked and the admin did not hide', () => {
    const unit = (data: Record<string, unknown>): Doc => ({ id: 'u1', data })
    const relist = (u: Doc | null) => closeLeaseWrites('l1', L, 'cancelled', [], u, '2027-03-10', S).some((x) => x.path === 'units/u1')
    expect(relist(unit({ rentedLeaseId: 'l1', status: 'rented' }))).toBe(true)
    expect(relist(unit({ rentedLeaseId: 'other', status: 'rented' }))).toBe(false)
    expect(relist(unit({ rentedLeaseId: 'l1', status: 'rented', hiddenByAdmin: true }))).toBe(false)
    expect(relist(unit({ rentedLeaseId: 'l1', status: 'hidden' }))).toBe(false)
    expect(relist(null)).toBe(false)
  })
})
