// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/deposit-action'
import { ADMIN, LEASE, OTHER, OWNER, TENANT, as, call, seedLease, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const act = (action: string, uid: string, extra: Record<string, unknown> = {}) => call(onRequestPost, w.env, { token: as(uid), body: { leaseId: LEASE, action, ...extra } })
const lease = () => w.db.get(`leases/${LEASE}`) as Record<string, unknown>
// Lease ended yesterday, 100.00 EGP... no: 10,000 EGP deposit (1,000,000 cents) held, claim window open until 2027-03-12.
function ready(over: Record<string, unknown> = {}) {
  for (const u of [OWNER, TENANT, OTHER]) seedUser(w.db, u)
  seedUser(w.db, ADMIN, { role: 'admin' })
  seedLease(w.db, { status: 'ended', endDate: '2027-03-09', depositMode: 'held-claim', depositCents: 1000000, depositStatus: 'held', depositClaimUntil: '2027-03-12', ...over })
}

describe('claim (owner)', () => {
  it('owner claims part of the deposit inside the window; tenant is told', async () => {
    ready()
    expect((await act('claim', OWNER, { amount: 2500, reason: 'كسر في الباب' })).json.depositStatus).toBe('claimed')
    expect(lease()).toMatchObject({ depositStatus: 'claimed', claimCents: 250000, claimReason: 'كسر في الباب' })
    expect(w.db.list(`users/${TENANT}/notifications`)).toHaveLength(1)
  })
  it.each([
    ['not the owner', TENANT, {}, 403, 'forbidden'],
    ['a stranger', OTHER, {}, 403, 'forbidden'],
    ['more than the deposit', OWNER, { amount: 10000.01 }, 400, 'bad-amount'],
    ['less than 1 EGP', OWNER, { amount: 0.5 }, 400, 'bad-amount'],
    ['negative', OWNER, { amount: -5 }, 400, 'bad-amount'],
    ['not a number', OWNER, { amount: 'all of it' }, 400, 'bad-amount'],
    ['no reason', OWNER, { amount: 100, reason: '' }, 400, 'bad-reason'],
    ['a one-word reason', OWNER, { amount: 100, reason: 'bad' }, 400, 'bad-reason'],
    ['a 301-character reason', OWNER, { amount: 100, reason: 'x'.repeat(301) }, 400, 'bad-reason'],
  ])('rejects %s', async (_n, uid, extra, status, code) => {
    ready()
    const r = await act('claim', uid, { amount: 100, reason: 'سبب كافي', ...extra })
    expect([r.status, r.json.error]).toEqual([status, code])
    expect(lease().depositStatus).toBe('held')
  })
  it('rejects after the claim window closed, and before the lease ended', async () => {
    ready({ depositClaimUntil: '2027-03-09' })
    expect((await act('claim', OWNER, { amount: 100, reason: 'سبب كافي' })).json.error).toBe('late')
    ready({ status: 'active', endDate: '2027-09-09', depositClaimUntil: undefined })
    expect((await act('claim', OWNER, { amount: 100, reason: 'سبب كافي' })).json.error).toBe('early')
  })
  it('only works for "held-claim" deposits that are held, and only once', async () => {
    ready({ depositMode: 'held-auto' }); expect((await act('claim', OWNER, { amount: 100, reason: 'سبب كافي' })).json.error).toBe('state')
    ready(); await act('claim', OWNER, { amount: 100, reason: 'سبب كافي' })
    expect((await act('claim', OWNER, { amount: 100, reason: 'سبب كافي' })).json.error).toBe('state')
  })
})

describe('tenant response, withdrawal, settlement', () => {
  const claimed = () => ready({ depositStatus: 'claimed', claimCents: 250000 })
  it('tenant accepts: claim goes to the owner, the rest back to the tenant, transfer pending', async () => {
    claimed(); await act('accept', TENANT)
    expect(lease()).toMatchObject({ depositStatus: 'settled', depositToOwnerCents: 250000, depositToTenantCents: 750000, depositTransfer: 'pending' })
  })
  it('only the tenant can accept or reject', async () => {
    claimed()
    for (const a of ['accept', 'reject']) for (const uid of [OWNER, OTHER, ADMIN]) expect((await act(a, uid)).status).toBe(403)
    expect(lease().depositStatus).toBe('claimed')
  })
  it('tenant rejects: money frozen as "disputed"; they may still accept later; owner may withdraw', async () => {
    claimed(); await act('reject', TENANT)
    expect(lease().depositStatus).toBe('disputed')
    expect((await act('reject', TENANT)).json.error).toBe('state')
    await act('withdraw', OWNER)
    expect(lease()).toMatchObject({ depositStatus: 'settled', depositToOwnerCents: 0, depositToTenantCents: 1000000 })
  })
  it('owner withdrawing a claim refunds the tenant in full; cannot withdraw with no claim', async () => {
    claimed(); expect((await act('withdraw', TENANT)).status).toBe(403)
    await act('withdraw', OWNER)
    expect(lease().depositToTenantCents).toBe(1000000)
    expect((await act('withdraw', OWNER)).json.error).toBe('state')
  })
  it('accepting when there is no claim is refused', async () => { ready(); expect((await act('accept', TENANT)).json.error).toBe('state') })
})

describe('admin settle / transferred: the admin executes decisions, never makes them', () => {
  it('after the window with no claim: full refund to the tenant', async () => {
    ready({ depositClaimUntil: '2027-03-09' })
    await act('settle', ADMIN)
    expect(lease()).toMatchObject({ depositStatus: 'settled', depositToOwnerCents: 0, depositToTenantCents: 1000000 })
  })
  it('refuses to settle while the claim window is still open', async () => {
    ready(); expect((await act('settle', ADMIN)).json.error).toBe('early')
    expect(lease().depositStatus).toBe('held')
  })
  it('a disputed deposit needs a written basis and an amount within the deposit', async () => {
    ready({ depositStatus: 'disputed', claimCents: 250000 })
    expect((await act('settle', ADMIN, { amount: 100, note: '' })).json.error).toBe('need-note')
    expect((await act('settle', ADMIN, { amount: 99999, note: 'حكم محكمة رقم ١' })).json.error).toBe('bad-amount')
    expect((await act('settle', ADMIN, { amount: -1, note: 'حكم محكمة رقم ١' })).json.error).toBe('bad-amount')
    await act('settle', ADMIN, { amount: 4000, note: 'حكم محكمة رقم ١' })
    expect(lease()).toMatchObject({ depositToOwnerCents: 400000, depositToTenantCents: 600000, settleNote: 'حكم محكمة رقم ١' })
  })
  it('owners and tenants can never settle or mark transfers', async () => {
    ready({ depositClaimUntil: '2027-03-09' })
    for (const a of ['settle', 'transferred']) for (const uid of [OWNER, TENANT, OTHER]) expect((await act(a, uid)).status).toBe(403)
    expect(lease().depositStatus).toBe('held')
  })
  it('transfer is recorded once, only for settled deposits', async () => {
    ready(); expect((await act('transferred', ADMIN)).json.error).toBe('state')
    ready({ depositStatus: 'settled', depositTransfer: 'pending' })
    await act('transferred', ADMIN, { ref: 'INSTAPAY-123' })
    expect(lease()).toMatchObject({ depositTransfer: 'done', depositRef: 'INSTAPAY-123' })
    expect((await act('transferred', ADMIN)).json.error).toBe('state')
  })
  it('unknown actions, bad ids and missing leases', async () => {
    ready()
    expect((await act('steal', OWNER)).json.error).toBe('bad-action')
    expect((await call(onRequestPost, w.env, { token: as(OWNER), body: { leaseId: '../x', action: 'claim' } })).json.error).toBe('bad-id')
    expect((await call(onRequestPost, w.env, { token: as(OWNER), body: { leaseId: 'Missing0000000000000', action: 'claim' } })).status).toBe(404)
  })
})
