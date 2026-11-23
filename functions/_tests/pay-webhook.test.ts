// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { HMAC_FIELDS } from '../_lib/paymob'
import { onRequestPost } from '../api/pay-webhook'
import { LEASE, OWNER, PAYMOB_DOCUMENTED_ORDER, TENANT, call, clone, paymobCallback, seedLease, seedPayment, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const PAY0 = `${LEASE}_0`
const PAY1 = `${LEASE}_1`

function world(payOver: Record<string, unknown> = {}, leaseOver: Record<string, unknown> = {}) {
  seedUser(w.db, OWNER); seedUser(w.db, TENANT)
  seedLease(w.db, { status: 'active', contractConfirmedAt: new Date(), ...leaseOver })
  seedPayment(w.db, 0, { status: 'pending', gatewayOrderId: '55001', ...payOver })
  seedPayment(w.db, 1, { status: 'due', dueDate: '2027-06-20', gatewayOrderId: '' })
}
const send = (cb: { body: unknown; hmac: string }) => call(onRequestPost, w.env, { path: '/api/pay-webhook', query: `?hmac=${cb.hmac}`, body: cb.body })
const notes = (uid: string) => w.db.list(`users/${uid}/notifications`)

describe('HMAC field list', () => {
  it('matches the order Paymob documents', () => { expect([...HMAC_FIELDS]).toEqual([...PAYMOB_DOCUMENTED_ORDER]) })
})

describe('POST /api/pay-webhook: a genuine successful payment', () => {
  it('marks the payment paid, holds the money in escrow and notifies both sides', async () => {
    world()
    const r = await send(paymobCallback(PAY0))
    expect(r.status).toBe(200)
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ status: 'paid', payoutStatus: 'held', gatewayTxnId: '987654' })
    expect(w.db.get(`leases/${LEASE}`)?.firstPaidAt).toBeInstanceOf(Date)
    expect(notes(TENANT)).toHaveLength(1)
    expect(notes(OWNER)).toHaveLength(1)
  })
  it('holds the deposit on the lease when the installment includes one', async () => {
    world({ depositCents: 1000000 })
    await send(paymobCallback(PAY0))
    expect(w.db.get(`leases/${LEASE}`)?.depositStatus).toBe('held')
  })
  it('queues the payout straight away if the tenant already confirmed move-in', async () => {
    world({}, { moveInConfirmedAt: new Date() })
    await send(paymobCallback(PAY0))
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ payoutStatus: 'pending' })
    expect(w.db.get(`payments/${PAY0}`)?.releasedAt).toBeInstanceOf(Date)
  })
  it('has nothing to pay out when the net amount is zero', async () => {
    world({ netCents: 0 })
    await send(paymobCallback(PAY0))
    expect(w.db.get(`payments/${PAY0}`)?.payoutStatus).toBe('none')
  })
  it('is idempotent: Paymob delivering the same callback twice changes nothing and sends no second notification', async () => {
    world()
    const cb = paymobCallback(PAY0)
    await send(cb)
    const second = await send(cb)
    expect(second.json.duplicate).toBe(true)
    expect(notes(TENANT)).toHaveLength(1)
  })
})

describe('POST /api/pay-webhook: forged or invalid callbacks never change money state', () => {
  it('rejects a missing HMAC', async () => {
    world()
    const cb = paymobCallback(PAY0)
    const r = await call(onRequestPost, w.env, { body: cb.body })
    expect(r.status).toBe(401)
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending')
  })
  it('rejects an HMAC made with the wrong secret', async () => {
    world()
    expect((await send(paymobCallback(PAY0, {}, { secret: 'attacker-guess' }))).status).toBe(401)
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending')
  })
  it('rejects a payload altered after signing (e.g. success flipped, amount lowered)', async () => {
    world()
    const cb = paymobCallback(PAY0, { success: false })
    const forged = clone(cb.body); forged.obj.success = true
    expect((await send({ body: forged, hmac: cb.hmac })).status).toBe(401)
    const cheap = paymobCallback(PAY0, { amount_cents: 100 })
    const lowered = clone(cheap.body); lowered.obj.amount_cents = 1500000
    expect((await send({ body: lowered, hmac: cheap.hmac })).status).toBe(401)
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending')
  })
  it('ignores a correctly signed callback whose amount differs from what we stored', async () => {
    world()
    await send(paymobCallback(PAY0, { amount_cents: 100 }))
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending')
  })
  it('ignores a correctly signed callback in another currency', async () => {
    world()
    await send(paymobCallback(PAY0, { currency: 'USD' }))
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending')
  })
  it('does not treat a still-pending transaction as paid', async () => {
    world()
    await send(paymobCallback(PAY0, { pending: true, success: true }))
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending')
  })
  it('answers 400 to a body that is not JSON and ignores non-transaction events', async () => {
    world()
    expect((await call(onRequestPost, w.env, { rawBody: 'not json' })).status).toBe(400)
    const r = await call(onRequestPost, w.env, { body: { type: 'TOKEN', obj: { id: 1 } } })
    expect(r.json.ignored).toBe(true)
  })
  it('ignores callbacks for payments that do not exist', async () => {
    world()
    const r = await send(paymobCallback('Zzzzzzzzzzzzzzzzzzzz_0', {}, { orderId: 1 }))
    expect(r.status).toBe(200)
    expect(r.json.ignored).toBe(true)
  })
})

describe('POST /api/pay-webhook: SECURITY replay of one real payment onto another installment', () => {
  // Paymob signs amount, transaction id, order id, etc. but NOT merchant_order_id / extras. Those are the fields the webhook uses to
  // decide WHICH installment to mark paid, so a tenant who really paid installment 0 could re-send that signed payload, retargeted at
  // installment 1 (same amount), and get it marked paid for free.
  it('a real, signed payment for installment 0 cannot be re-pointed at installment 1', async () => {
    world()
    const real = paymobCallback(PAY0)
    expect((await send(real)).status).toBe(200)

    const replay = clone(real.body)
    ;(replay.obj.order as Record<string, unknown>).merchant_order_id = `${PAY1}-evil99`
    ;((replay.obj.payment_key_claims as Record<string, unknown>).extra as Record<string, unknown>).paymentId = PAY1
    await send({ body: replay, hmac: real.hmac }) // HMAC is still valid: none of the edited fields are signed

    expect(w.db.get(`payments/${PAY1}`)?.status).toBe('due')
    expect(w.db.get(`payments/${PAY1}`)?.payoutStatus).toBe('none')
  })
  it('a payment made through an older checkout of the same installment is still accepted', async () => {
    // pay-create can be called twice for one installment (second tab / retry); both Paymob orders must stay valid.
    world({ gatewayOrderId: '55002', gatewayOrderIds: ['55001', '55002'] })
    await send(paymobCallback(PAY0, {}, { orderId: 55001 }))
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('paid')
  })
})

describe('POST /api/pay-webhook: charged twice for one installment', () => {
  it('a second, different successful charge is recorded on the payment so it can be refunded; the first stays authoritative', async () => {
    world({ gatewayOrderId: '55002', gatewayOrderIds: ['55001', '55002'] })
    await send(paymobCallback(PAY0, { id: 111 }, { orderId: 55001 }))
    const r = await send(paymobCallback(PAY0, { id: 222 }, { orderId: 55002 }))
    expect(r.json.duplicate).toBe(true)
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ status: 'paid', gatewayTxnId: '111', extraCharges: ['222'] })
    expect(notes(TENANT)).toHaveLength(1) // still one "paid" notice
  })
  it('re-delivery of that same second charge is not recorded twice', async () => {
    world({ gatewayOrderId: '55002', gatewayOrderIds: ['55001', '55002'] })
    await send(paymobCallback(PAY0, { id: 111 }, { orderId: 55001 }))
    const second = paymobCallback(PAY0, { id: 222 }, { orderId: 55002 })
    await send(second); await send(second)
    expect(w.db.get(`payments/${PAY0}`)?.extraCharges).toEqual(['222'])
  })
})

describe('POST /api/pay-webhook: a paid callback we cannot match is never lost silently', () => {
  it('a signed SUCCESS callback for an order we do not know leaves a server-only record for manual reconciliation', async () => {
    world()
    const cb = paymobCallback(PAY0, { id: 777 }, { orderId: 99999 })
    const r = await send(cb)
    expect(r.json.ignored).toBe(true)
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('pending') // still not marked paid
    expect(w.db.get('unmatchedCallbacks/777')).toMatchObject({ paymentId: PAY0, orderId: '99999', amountCents: 1500000, knownOrders: ['55001'] })
    await send(cb) // Paymob retries: no error, still one record
    expect(w.db.list('unmatchedCallbacks')).toHaveLength(1)
  })
  it('a signed success callback that points at no payment at all is recorded too', async () => {
    world()
    await send(paymobCallback('Zzzzzzzzzzzzzzzzzzzz_0', { id: 888 }, { orderId: 1 }))
    expect(w.db.get('unmatchedCallbacks/888')).toBeDefined()
  })
  it('declined, pending and unsigned callbacks leave no record', async () => {
    world()
    await send(paymobCallback(PAY0, { id: 1, success: false }, { orderId: 99999 }))
    await send(paymobCallback(PAY0, { id: 2, pending: true }, { orderId: 99999 }))
    await send(paymobCallback(PAY0, { id: 3 }, { orderId: 99999, secret: 'wrong' }))
    expect(w.db.list('unmatchedCallbacks')).toHaveLength(0)
  })
})

describe('POST /api/pay-webhook: failures and refunds', () => {
  it('marks a declined payment failed so the tenant can retry', async () => {
    world()
    await send(paymobCallback(PAY0, { success: false, pending: false }))
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('failed')
  })
  it('a late "declined" callback never downgrades a payment that is already paid', async () => {
    world({ status: 'paid', payoutStatus: 'held' })
    await send(paymobCallback(PAY0, { success: false, pending: false }))
    expect(w.db.get(`payments/${PAY0}`)?.status).toBe('paid')
  })
  it('records a refund/void from Paymob and cancels the payout', async () => {
    world({ status: 'paid', payoutStatus: 'held' })
    await send(paymobCallback(PAY0, { is_refunded: true }))
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ status: 'refunded', payoutStatus: 'cancelled' })
  })
  it('keeps payoutStatus "paid" if the money had already been transferred to the owner', async () => {
    world({ status: 'paid', payoutStatus: 'paid' })
    await send(paymobCallback(PAY0, { is_voided: true }))
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ status: 'refunded', payoutStatus: 'paid' })
  })
  it('answers 500 (so Paymob retries) when the database write fails', async () => {
    world()
    w.db.failCommit = true
    expect((await send(paymobCallback(PAY0))).status).toBe(500)
  })
})
