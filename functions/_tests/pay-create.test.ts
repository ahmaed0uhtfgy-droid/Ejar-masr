// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/pay-create'
import { LEASE, OTHER, OWNER, TENANT, as, call, seedLease, seedPayment, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const PAY0 = `${LEASE}_0`
const PAY1 = `${LEASE}_1`
const pay = (paymentId: unknown = PAY0, uid = TENANT, extra: Record<string, unknown> = {}) => call(onRequestPost, w.env, { token: as(uid), body: { paymentId, ...extra } })
function ready(leaseOver: Record<string, unknown> = {}, payOver: Record<string, unknown> = {}) {
  seedUser(w.db, TENANT, { email: 'tenant@example.com' }); seedUser(w.db, OWNER); seedUser(w.db, OTHER)
  seedLease(w.db, { status: 'active', contractConfirmedAt: new Date(), ...leaseOver })
  seedPayment(w.db, 0, payOver)
  seedPayment(w.db, 1, { dueDate: '2027-06-20' })
  w.db.external = (url) => url.endsWith('/v1/intention/') ? new Response(JSON.stringify({ client_secret: 'cs_abc', id: 'int_1', intention_order_id: 777 })) : new Response('{}')
}
const paymobCall = () => w.db.externalCalls.find((c) => c.url.includes('/v1/intention/'))

describe('POST /api/pay-create', () => {
  it('creates a checkout for the stored amount and returns the hosted URL', async () => {
    ready()
    const r = await pay()
    expect(r.status).toBe(200)
    expect(String(r.json.url)).toContain('https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test_public&clientSecret=cs_abc')
    const body = paymobCall()?.body as Record<string, unknown>
    expect(body).toMatchObject({ amount: 1500000, currency: 'EGP', payment_methods: [4000001, 4000002], notification_url: 'https://site.test/api/pay-webhook' })
    expect((paymobCall()?.init?.headers as Record<string, string>).Authorization).toBe('Token sk_test_secret')
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ status: 'pending', gatewayOrderId: '777', gatewayOrderIds: ['777'] })
  })
  it('the amount can never be influenced by the client', async () => {
    ready()
    await pay(PAY0, TENANT, { amount: 1, amountCents: 100, price: 1 })
    expect((paymobCall()?.body as Record<string, unknown>).amount).toBe(1500000)
  })
  it('a second click / tab within 10 minutes gets the SAME checkout, so one installment cannot be charged twice', async () => {
    ready()
    const first = await pay()
    w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs_2', intention_order_id: 778 }))
    const second = await pay()
    expect(second.json.url).toBe(first.json.url)
    expect(second.json.reused).toBe(true)
    expect(w.db.externalCalls.filter((c) => c.url.includes('/v1/intention/'))).toHaveLength(1)
    expect(w.db.get(`payments/${PAY0}`)?.gatewayOrderId).toBe('777')
  })
  it('the checkout secret is stored only in the server-only collection, never on the payment the owner can read', async () => {
    ready(); await pay()
    expect(JSON.stringify(w.db.get(`payments/${PAY0}`))).not.toContain('cs_abc')
    expect(String(w.db.get(`checkoutSessions/${PAY0}`)?.url)).toContain('cs_abc')
  })
  it('after 10 minutes a fresh checkout is created, and every attempt stays recognised (an old tab may still pay)', async () => {
    ready()
    await pay()
    vi.setSystemTime(new Date(Date.now() + 11 * 60_000))
    w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs_2', intention_order_id: 778 }))
    await pay()
    expect(w.db.get(`payments/${PAY0}`)).toMatchObject({ gatewayOrderId: '778', gatewayOrderIds: ['777', '778'] })
  })
  it('a failed attempt can be retried', async () => { ready({}, { status: 'failed' }); expect((await pay()).status).toBe(200) })

  describe('rejects', () => {
    it('anonymous callers and bad ids', async () => {
      ready()
      expect((await call(onRequestPost, w.env, { body: { paymentId: PAY0 } })).status).toBe(401)
      for (const id of ['x', '../payments/a_0', `${LEASE}_`, `${LEASE}_1234`, 5, null]) expect((await pay(id)).json.error).toBe('bad-id')
    })
    it("someone else's installment: answers 404, same as a missing one, so ids cannot be probed", async () => {
      ready()
      expect((await pay(PAY0, OTHER)).status).toBe(404)
      expect((await pay(PAY0, OWNER)).status).toBe(404)
      expect((await pay('Missing000000000000_0')).status).toBe(404)
      expect(paymobCall()).toBeUndefined()
    })
    it('payments disabled by the admin / gateway not configured (503)', async () => {
      ready(); w.db.seed('settings/payments', { paymentsEnabled: false })
      expect((await pay()).json.error).toBe('disabled')
    })
    it('gateway not configured', async () => {
      ready(); w.env.PAYMOB_SECRET_KEY = undefined
      expect((await pay()).json.error).toBe('not-configured')
    })
    it('an installment that is already paid (409, no new checkout)', async () => {
      ready({}, { status: 'paid' })
      const r = await pay()
      expect([r.status, r.json.error]).toEqual([409, 'state'])
      expect(paymobCall()).toBeUndefined()
    })
    it.each(['cancelled', 'refunded'])('an installment that is %s', async (status) => { ready({}, { status }); expect((await pay()).status).toBe(409) })
    it('a lease that is not active', async () => { ready({ status: 'ended' }); expect((await pay()).json.error).toBe('lease') })
    it('paying before BOTH sides confirmed the contract', async () => {
      ready({ contractConfirmedAt: undefined })
      expect((await pay()).json.error).toBe('contract')
      expect(paymobCall()).toBeUndefined()
    })
    it('skipping an earlier unpaid installment', async () => {
      ready()
      expect((await pay(PAY1)).json.error).toBe('pay-earlier')
    })
    it('allows the next installment once earlier ones are paid, cancelled or refunded', async () => {
      ready({}, { status: 'paid' })
      expect((await pay(PAY1)).status).toBe(200)
    })
    it('a stored amount below 1 EGP or fractional cents', async () => {
      ready({}, { amountCents: 50 }); expect((await pay()).json.error).toBe('bad-amount')
      ready({}, { amountCents: 1500000.5 }); expect((await pay()).json.error).toBe('bad-amount')
    })
    it('a gateway outage (502) leaves the payment untouched', async () => {
      ready(); w.db.external = () => new Response('boom', { status: 500 })
      expect((await pay()).status).toBe(502)
      expect(w.db.get(`payments/${PAY0}`)?.status).toBe('due')
    })
    it('a gateway reply without an order id (502): it could never be matched to a callback', async () => {
      ready(); w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs_abc' }))
      expect((await pay()).status).toBe(502)
      expect(w.db.get(`payments/${PAY0}`)?.status).toBe('due')
    })
  })
})
