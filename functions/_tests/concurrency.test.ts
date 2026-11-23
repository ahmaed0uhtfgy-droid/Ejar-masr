// @vitest-environment node
// Races: two requests that read the same state and both try to act on it. Money and bookings must stay consistent.
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost as depositAction } from '../api/deposit-action'
import { onRequestPost as leaseRequest } from '../api/lease-request'
import { onRequestPost as leaseRespond } from '../api/lease-respond'
import { onRequestPost as payCreate } from '../api/pay-create'
import { LEASE, OTHER, OWNER, TENANT, TODAY, UNIT, as, call, seedLease, seedPayment, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const LEASE_B = 'leaseBBBBBBBBBB000002'
const accept = (leaseId: string) => call(leaseRespond, w.env, { token: as(OWNER), body: { leaseId, action: 'accept' } })
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort()
function users() { for (const u of [OWNER, TENANT, OTHER]) seedUser(w.db, u) }

describe('two requests for the same unit (double booking)', () => {
  it('an owner accepting two different requests at the same moment books the unit once, not twice', async () => {
    users(); seedUnit(w.db)
    seedLease(w.db, { id: LEASE }); seedLease(w.db, { id: LEASE_B, tenantId: OTHER })
    const rs = await Promise.all([accept(LEASE), accept(LEASE_B)])
    expect(statuses(rs)).toEqual([200, 409])
    const states = [w.db.get(`leases/${LEASE}`)?.status, w.db.get(`leases/${LEASE_B}`)?.status].sort()
    expect(states.filter((s) => s === 'active')).toHaveLength(1)
    const winner = w.db.get(`leases/${LEASE}`)?.status === 'active' ? LEASE : LEASE_B
    expect(w.db.get(`units/${UNIT}`)?.rentedLeaseId).toBe(winner)
    expect(w.db.list('payments').every((p) => p.data.leaseId === winner)).toBe(true) // the loser created no installments
    expect(rs.find((r) => r.status === 409)?.json.error).toBe('conflict')
  })
  it('accepting the very same request twice at once creates its installments once', async () => {
    users(); seedUnit(w.db); seedLease(w.db)
    const rs = await Promise.all([accept(LEASE), accept(LEASE)])
    expect(statuses(rs)).toEqual([200, 409])
    expect(w.db.list('payments')).toHaveLength(2)
  })
  it('a unit the owner flipped back to "active" while a lease is running cannot be booked again', async () => {
    users()
    seedLease(w.db, { id: LEASE_B, tenantId: OTHER, status: 'active', endDate: '2027-12-31', startDate: '2027-03-01' })
    seedUnit(w.db, { status: 'active', rentedLeaseId: LEASE_B, rentedUntil: '2027-12-31' }) // what the browser rules allow an owner to do
    seedLease(w.db, { id: LEASE })
    const r = await accept(LEASE)
    expect([r.status, r.json.error]).toEqual([409, 'unit-locked'])
    expect(w.db.get(`leases/${LEASE}`)?.status).toBe('requested')
  })
  it('but a lease that already ended (or never existed) no longer blocks the unit', async () => {
    users()
    seedLease(w.db, { id: LEASE_B, tenantId: OTHER, status: 'ended', endDate: '2027-03-01' })
    seedUnit(w.db, { status: 'active', rentedLeaseId: LEASE_B })
    seedLease(w.db, { id: LEASE })
    expect((await accept(LEASE)).status).toBe(200)
    seedLease(w.db, { id: 'leaseCCCCCCCCCC000003', tenantId: OTHER }); w.db.seed(`units/${UNIT}`, { ...w.db.get(`units/${UNIT}`), status: 'active', rentedLeaseId: 'leaseMissing00000000' })
    expect((await accept('leaseCCCCCCCCCC000003')).status).toBe(200)
  })
})

describe('deposit decisions that arrive in the same second', () => {
  const act = (action: string, uid: string, extra: Record<string, unknown> = {}) => call(depositAction, w.env, { token: as(uid), body: { leaseId: LEASE, action, ...extra } })
  it("the tenant accepting a claim and the owner withdrawing it at once: exactly one wins, the money is settled once", async () => {
    users()
    seedLease(w.db, { status: 'ended', endDate: '2027-03-09', depositMode: 'held-claim', depositCents: 1000000, depositStatus: 'claimed', claimCents: 250000 })
    const rs = await Promise.all([act('accept', TENANT), act('withdraw', OWNER)])
    expect(statuses(rs)).toEqual([200, 409])
    const l = w.db.get(`leases/${LEASE}`)!
    expect(l.depositStatus).toBe('settled')
    expect(Number(l.depositToOwnerCents) + Number(l.depositToTenantCents)).toBe(1000000)
  })
})

describe('checkout double click', () => {
  const pay = () => call(payCreate, w.env, { token: as(TENANT), body: { paymentId: `${LEASE}_0` } })
  function ready() {
    users(); seedLease(w.db, { status: 'active', contractConfirmedAt: new Date() }); seedPayment(w.db, 0)
    let order = 900
    w.db.external = () => new Response(JSON.stringify({ client_secret: `cs_${++order}`, intention_order_id: order }))
  }
  it('two simultaneous first clicks: one checkout is recorded, the other is refused, so every payable order is one we know about', async () => {
    ready()
    const rs = await Promise.all([pay(), pay()])
    expect(statuses(rs)).toEqual([200, 409])
    const p = w.db.get(`payments/${LEASE}_0`)!
    expect((p.gatewayOrderIds as string[]).length).toBe(1)
    const winnerUrl = String(rs.find((r) => r.status === 200)?.json.url)
    expect(winnerUrl).toContain(`cs_${p.gatewayOrderId}`)
  })
  it('after the conflict, retrying simply gets the recorded checkout back', async () => {
    ready()
    const rs = await Promise.all([pay(), pay()])
    const again = await pay()
    expect(again.json.reused).toBe(true)
    expect(again.json.url).toBe(rs.find((r) => r.status === 200)?.json.url)
  })
})

describe('rent requests sent in parallel by one tenant', () => {
  const body = (unitId: string) => ({ unitId, startDate: '2027-03-20', durationMonths: 6, cycleMonths: 3, phone: '01012345678', acceptedPolicy: '2027-03-01' })
  const request = (unitId: string) => call(leaseRequest, w.env, { token: as(TENANT), body: body(unitId) })
  it('five simultaneous requests for the SAME unit create exactly one request', async () => {
    users(); seedUnit(w.db)
    const rs = await Promise.all(Array.from({ length: 5 }, () => request(UNIT)))
    expect(statuses(rs)).toEqual([200, 409, 409, 409, 409])
    expect(w.db.list('leases')).toHaveLength(1)
    expect(w.db.list(`users/${OWNER}/notifications`)).toHaveLength(1) // the owner is notified once, not five times
  })
  it('simultaneous requests for different units cannot get around the open-requests cap', async () => {
    users(); w.db.seed('settings/payments', { maxOpenRequests: 2 })
    const unitIds = ['unitCap0000001', 'unitCap0000002', 'unitCap0000003', 'unitCap0000004']
    for (const id of unitIds) seedUnit(w.db, { id })
    const burst = await Promise.all(unitIds.map(request))
    expect(burst.filter((r) => r.status === 200).length).toBe(1)
    expect((await request(unitIds[1])).status).toBe(200)   // second open request: allowed
    expect((await request(unitIds[2])).json.error).toBe('too-many') // third: over the cap of 2
    expect(w.db.list('leases')).toHaveLength(2)
  })
  it('sequential requests keep working (the gate is written each time, never left locked)', async () => {
    users(); seedUnit(w.db); seedUnit(w.db, { id: 'unitSeq0000002' })
    expect((await request(UNIT)).status).toBe(200)
    expect((await request('unitSeq0000002')).status).toBe(200)
    expect((await request(UNIT)).json.error).toBe('duplicate')
  })
})

describe('sanity', () => { it('TODAY constant matches the Cairo day used by the server', () => { expect(TODAY).toBe('2027-03-10') }) })
