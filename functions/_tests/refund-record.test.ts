// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/refund-record'
import { ADMIN, LEASE, OWNER, TENANT, as, call, seedLease, seedPayment, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const PAY0 = `${LEASE}_0`
const refund = (body: Record<string, unknown>, uid = ADMIN) => call(onRequestPost, w.env, { token: as(uid), body })
function ready(payOver: Record<string, unknown> = {}) {
  seedUser(w.db, ADMIN, { role: 'admin' }); seedUser(w.db, TENANT); seedUser(w.db, OWNER)
  seedLease(w.db, { status: 'active', depositStatus: 'held' })
  seedPayment(w.db, 0, { status: 'paid', payoutStatus: 'held', ...payOver })
}

describe('POST /api/refund-record (admin records a manual Paymob refund)', () => {
  it('records a refund of held money, cancels the payout, tells both sides', async () => {
    ready()
    expect((await refund({ paymentId: PAY0, amount: 15000, note: 'المستأجر لم يستلم' })).status).toBe(200)
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ status: 'refunded', payoutStatus: 'cancelled', refundCents: 1500000, refundNote: 'المستأجر لم يستلم' })
    expect(w.db.list(`users/${TENANT}/notifications`)).toHaveLength(1)
    expect(w.db.list(`users/${OWNER}/notifications`)).toHaveLength(1)
  })
  it('clears a held deposit on the lease when the payment carried one', async () => {
    ready({ depositCents: 1000000 }); await refund({ paymentId: PAY0, amount: 100 })
    expect(w.db.get(`leases/${LEASE}`)?.depositStatus).toBe('none')
  })
  it('NEVER touches money that was already released or paid out to the owner', async () => {
    for (const payoutStatus of ['pending', 'paid', 'none', 'cancelled']) {
      ready({ payoutStatus })
      const r = await refund({ paymentId: PAY0, amount: 100 })
      expect([r.status, r.json.error]).toEqual([409, 'state'])
      expect(w.db.get(`payments/${PAY0}`)?.status).toBe('paid')
    }
  })
  it('refuses unpaid, already refunded or missing payments', async () => {
    ready({ status: 'due', payoutStatus: 'none' }); expect((await refund({ paymentId: PAY0, amount: 1 })).status).toBe(409)
    ready({ status: 'refunded' }); expect((await refund({ paymentId: PAY0, amount: 1 })).status).toBe(409)
    expect((await refund({ paymentId: `${LEASE}_9`, amount: 1 })).status).toBe(404)
  })
  it.each([[-1], [15000.01], ['abc'], [null], [undefined]])('refuses refund amount %j', async (amount) => {
    ready(); expect((await refund({ paymentId: PAY0, amount })).json.error).toBe('bad-amount')
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('paid')
  })
  it('refuses malformed payment ids', async () => {
    ready()
    for (const paymentId of ['x', `${LEASE}_`, '../a_0', 'a'.repeat(50) + '_0', 7]) expect((await refund({ paymentId, amount: 1 })).json.error).toBe('bad-id')
  })
  it('is admin-only', async () => {
    ready()
    for (const uid of [TENANT, OWNER]) expect((await refund({ paymentId: PAY0, amount: 1 }, uid)).status).toBe(403)
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('paid')
  })
})
