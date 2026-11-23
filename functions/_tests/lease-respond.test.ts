// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/lease-respond'
import { ADMIN, LEASE, OTHER, OWNER, TENANT, UNIT, as, call, seedLease, seedPayment, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const act = (action: string, uid: string, extra: Record<string, unknown> = {}) => call(onRequestPost, w.env, { token: as(uid), body: { leaseId: LEASE, action, ...extra } })
const lease = () => w.db.get(`leases/${LEASE}`) as Record<string, unknown>
const unit = () => w.db.get(`units/${UNIT}`) as Record<string, unknown>
const pays = () => w.db.list('payments').sort((a, b) => a.id.localeCompare(b.id))
function ready(leaseOver: Record<string, unknown> = {}, unitOver: Record<string, unknown> = {}) {
  for (const u of [OWNER, TENANT, OTHER]) seedUser(w.db, u)
  seedUser(w.db, ADMIN, { role: 'admin' })
  seedUnit(w.db, unitOver)
  seedLease(w.db, leaseOver)
}

describe('accept', () => {
  it('builds the schedule, puts the deposit on the first installment, locks the unit until the lease end', async () => {
    ready({ depositCents: 1000000, depositMode: 'held-claim', depositStatus: 'unpaid' })
    const r = await act('accept', OWNER)
    expect(r.json.status).toBe('active')
    const [p0, p1] = pays()
    expect(p0.data).toMatchObject({ index: 0, amountCents: 2500000, depositCents: 1000000, netCents: 1500000, dueDate: '2027-03-20', status: 'due', ownerId: OWNER, tenantId: TENANT })
    expect(p1.data).toMatchObject({ index: 1, amountCents: 1500000, depositCents: 0, dueDate: '2027-06-20' })
    expect(unit()).toMatchObject({ status: 'rented', rentedUntil: '2027-09-20', rentedLeaseId: LEASE })
    expect(lease()).toMatchObject({ status: 'active', reminderDays: 3 })
  })
  it.each([
    ['owner', { tenant: 0, owner: 150000 }],
    ['tenant', { tenant: 150000, owner: 0 }],
    ['split', { tenant: 75000, owner: 75000 }],
  ])('fee payer "%s": the fee is split exactly and money adds up', async (feePayer, e) => {
    ready({ feePercent: 10, feePayer })
    await act('accept', OWNER)
    const d = pays()[0].data
    expect(d).toMatchObject({ feeCents: 150000, tenantFeeCents: e.tenant, amountCents: 1500000 + e.tenant, netCents: 1500000 - e.owner })
    expect(Number(d.amountCents) - Number(d.netCents)).toBe(150000) // platform keeps exactly the fee
  })
  it('rejects every other pending request for the same unit and tells those tenants', async () => {
    ready(); seedLease(w.db, { id: 'leaseCompetitor000001', tenantId: OTHER })
    await act('accept', OWNER)
    expect(w.db.get('leases/leaseCompetitor000001')?.status).toBe('rejected')
    expect(w.db.list(`users/${OTHER}/notifications`)).toHaveLength(1)
  })
  it('only the owner can accept, and only once', async () => {
    ready()
    expect((await act('accept', TENANT)).status).toBe(403)
    expect((await act('accept', OTHER)).status).toBe(403)
    expect((await act('accept', ADMIN)).status).toBe(403)
    expect(lease().status).toBe('requested')
    await act('accept', OWNER)
    const again = await act('accept', OWNER)
    expect([again.status, again.json.error]).toEqual([409, 'state'])
    expect(pays()).toHaveLength(2)
  })
  it('refuses when the unit is no longer available, or the start date has passed', async () => {
    ready({}, { status: 'hidden' })
    expect((await act('accept', OWNER)).json.error).toBe('unit')
    ready({ startDate: '2027-03-01' })
    expect((await act('accept', OWNER)).json.error).toBe('start-passed')
    expect(pays()).toHaveLength(0)
  })
  it('refuses when the unit belongs to someone else', async () => {
    ready({}, { ownerId: OTHER })
    expect((await act('accept', OWNER)).json.error).toBe('unit')
  })
  it('refuses when payments are switched off', async () => {
    ready(); w.db.seed('settings/payments', { paymentsEnabled: false })
    expect((await act('accept', OWNER)).status).toBe(503)
  })
})

describe('reject / cancel / end', () => {
  it('owner rejects a request; tenant is notified', async () => {
    ready(); await act('reject', OWNER)
    expect(lease().status).toBe('rejected')
    expect(w.db.list(`users/${TENANT}/notifications`)).toHaveLength(1)
    expect((await act('reject', TENANT)).status).toBe(403)
  })
  it('tenant cancels a pending request', async () => {
    ready(); expect((await act('cancel', TENANT)).json.status).toBe('cancelled')
    expect((await act('cancel', OWNER)).status).toBe(403)
  })
  it('tenant cancels an active lease before paying: unpaid installments cancelled and the unit is listed again', async () => {
    ready(); await act('accept', OWNER)
    expect((await act('cancel', TENANT)).json.status).toBe('cancelled')
    expect(pays().every((p) => p.data.status === 'cancelled')).toBe(true)
    expect(unit()).toMatchObject({ status: 'active', rentedLeaseId: null, rentedUntil: null })
  })
  it('tenant cannot cancel once money was paid or is being processed', async () => {
    ready({ status: 'active', firstPaidAt: new Date() }); seedPayment(w.db, 0, { status: 'paid', payoutStatus: 'held' }); seedPayment(w.db, 1)
    expect((await act('cancel', TENANT)).json.error).toBe('paid')
    ready({ status: 'active' }); seedPayment(w.db, 0, { status: 'pending' })
    expect((await act('cancel', TENANT)).json.error).toBe('paid')
    expect(lease().status).toBe('active')
  })
  it('re-listing never overrides a unit the admin hid, or one locked by a different lease', async () => {
    ready({ status: 'active' }, { status: 'rented', rentedLeaseId: LEASE, hiddenByAdmin: true }); seedPayment(w.db, 0)
    await act('cancel', TENANT)
    expect(unit().status).toBe('rented')
    ready({ status: 'active' }, { status: 'rented', rentedLeaseId: 'someOtherLease0001' }); seedPayment(w.db, 0)
    await act('cancel', TENANT)
    expect(unit().rentedLeaseId).toBe('someOtherLease0001')
  })
  it('owner or admin ends an active lease; a stranger cannot', async () => {
    ready({ status: 'active' }, { status: 'rented', rentedLeaseId: LEASE }); seedPayment(w.db, 0); seedPayment(w.db, 1, { status: 'paid', payoutStatus: 'held' })
    expect((await act('end', OTHER)).status).toBe(403)
    expect((await act('end', TENANT)).status).toBe(403)
    expect((await act('end', ADMIN)).json.status).toBe('ended')
    expect(pays().map((p) => p.data.status)).toEqual(['cancelled', 'paid']) // paid money is never touched
    expect(unit().status).toBe('active')
    expect((await act('end', OWNER)).json.error).toBe('state')
  })
  it('ending a lease with a held deposit opens the claim window', async () => {
    ready({ status: 'active', depositStatus: 'held', depositMode: 'held-claim', depositCents: 1000000 }); seedPayment(w.db, 0, { status: 'paid' })
    await act('end', OWNER)
    expect(lease()).toMatchObject({ status: 'ended', depositClaimUntil: '2027-03-13' })
  })
})

describe('contract confirmation (gates payment)', () => {
  it('payment opens only when BOTH sides confirmed', async () => {
    ready({ status: 'active' })
    expect((await act('confirm-contract', OWNER)).json.contractConfirmed).toBe(false)
    expect(lease().contractConfirmedAt).toBeUndefined()
    expect((await act('confirm-contract', OWNER)).status).toBe(200) // owner again: harmless, still not both
    expect((await act('confirm-contract', TENANT)).json.contractConfirmed).toBe(true)
    expect(lease().contractConfirmedAt).toBeInstanceOf(Date)
    expect((await act('confirm-contract', TENANT)).json.error).toBe('state')
  })
  it('outsiders cannot confirm; non-active leases cannot be confirmed', async () => {
    ready({ status: 'active' }); expect((await act('confirm-contract', OTHER)).status).toBe(403)
    ready({ status: 'requested' }); expect((await act('confirm-contract', OWNER)).json.error).toBe('state')
  })
  it('the owner confirming twice must not count as the tenant confirming', async () => {
    ready({ status: 'active' })
    await act('confirm-contract', OWNER); await act('confirm-contract', OWNER)
    expect(lease().contractConfirmedAt).toBeUndefined()
  })
})

describe('move-in confirmation releases the escrow', () => {
  const paid = () => { ready({ status: 'active', firstPaidAt: new Date(), startDate: '2027-03-01', endDate: '2027-09-01' }); seedPayment(w.db, 0, { status: 'paid', payoutStatus: 'held' }); seedPayment(w.db, 1, { status: 'paid', payoutStatus: 'held', netCents: 0 }); seedPayment(w.db, 2, { status: 'due' }) }
  it('held money becomes pending payout (or none when the net is zero); unpaid installments untouched', async () => {
    paid()
    expect((await act('confirm-move-in', TENANT)).json.moveInConfirmed).toBe(true)
    expect(pays().map((p) => p.data.payoutStatus)).toEqual(['pending', 'none', 'none'])
    expect(lease().moveInConfirmedAt).toBeInstanceOf(Date)
  })
  it('ONLY the tenant can release it (not the owner, not the admin)', async () => {
    paid()
    for (const uid of [OWNER, ADMIN, OTHER]) expect((await act('confirm-move-in', uid)).status).toBe(403)
    expect(pays()[0].data.payoutStatus).toBe('held')
  })
  it('cannot be confirmed twice, before paying, or before the lease starts', async () => {
    paid(); await act('confirm-move-in', TENANT)
    expect((await act('confirm-move-in', TENANT)).json.error).toBe('state')
    ready({ status: 'active' }); expect((await act('confirm-move-in', TENANT)).json.error).toBe('unpaid')
    ready({ status: 'active', firstPaidAt: new Date(), startDate: '2027-03-20' }); expect((await act('confirm-move-in', TENANT)).json.error).toBe('not-started')
  })
  it('"not received" flags the lease and keeps the money held', async () => {
    paid(); expect((await act('not-received', TENANT)).json.moveInIssue).toBe(true)
    expect(lease().moveInIssue).toBe(true)
    expect(pays()[0].data.payoutStatus).toBe('held')
  })
})

describe('cancellation request after payment, reminders', () => {
  it('is blocked by default', async () => {
    ready({ status: 'active', firstPaidAt: new Date() })
    expect((await act('request-cancel', TENANT)).json.error).toBe('blocked')
  })
  it('works when enabled', async () => {
    w.db.seed('settings/payments', { cancelAfterPayment: 'request' })
    ready({ status: 'active', firstPaidAt: new Date() })
    expect((await act('request-cancel', TENANT)).json.cancelRequested).toBe(true)
    expect((await act('request-cancel', TENANT)).json.error).toBe('state')
    expect((await act('request-cancel', OWNER)).status).toBe(403)
  })
  it('not possible after move-in was confirmed', async () => {
    w.db.seed('settings/payments', { cancelAfterPayment: 'request' })
    ready({ status: 'active', firstPaidAt: new Date(), moveInConfirmedAt: new Date() })
    expect((await act('request-cancel', TENANT)).json.error).toBe('state')
  })
  it('reminder days are clamped to 1..30 and fall back to the default; owner only', async () => {
    ready({ status: 'active' })
    expect((await act('set-reminder', OWNER, { reminderDays: 7 })).json.reminderDays).toBe(7)
    for (const bad of [0, 31, -3, 'x', null]) expect((await act('set-reminder', OWNER, { reminderDays: bad })).json.reminderDays).toBe(3)
    expect((await act('set-reminder', TENANT, { reminderDays: 5 })).status).toBe(403)
  })
})

describe('input validation', () => {
  it('unknown action, bad id, missing lease', async () => {
    ready()
    expect((await act('delete-everything', OWNER)).json.error).toBe('bad-action')
    expect((await call(onRequestPost, w.env, { token: as(OWNER), body: { leaseId: '../x', action: 'accept' } })).json.error).toBe('bad-id')
    expect((await call(onRequestPost, w.env, { token: as(OWNER), body: { leaseId: 'Missing0000000000000', action: 'accept' } })).status).toBe(404)
    expect((await call(onRequestPost, w.env, { body: { leaseId: LEASE, action: 'accept' } })).status).toBe(401)
  })
})
