// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/lease-request'
import { OTHER, OWNER, TENANT, UNIT, as, call, seedLease, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const good = { unitId: UNIT, startDate: '2027-03-20', durationMonths: 6, cycleMonths: 3, phone: '01012345678', acceptedPolicy: '2027-03-01' }
const req = (body: Record<string, unknown> = good, uid = TENANT) => call(onRequestPost, w.env, { token: as(uid), body })
function ready(unitOver: Record<string, unknown> = {}) { seedUser(w.db, TENANT); seedUser(w.db, OWNER); seedUnit(w.db, unitOver) }
const leases = () => w.db.list('leases')

describe('POST /api/lease-request', () => {
  it('creates a "requested" lease with terms computed on the server and notifies the owner', async () => {
    ready()
    const r = await req()
    expect(r.status).toBe(200)
    const [l] = leases()
    expect(l.id).toBe(r.json.leaseId)
    expect(l.data).toMatchObject({ status: 'requested', tenantId: TENANT, ownerId: OWNER, unitId: UNIT, total: 30000, installments: 2, endDate: '2027-09-20', depositCents: 1000000, depositStatus: 'unpaid', depositMode: 'held-claim' })
    expect(w.db.list(`users/${OWNER}/notifications`)).toHaveLength(1)
  })
  it('takes the price from the listing, never from the request', async () => {
    ready()
    await req({ ...good, price: 1, total: 1, depositCents: 0, feePercent: 0, status: 'active' })
    expect(leases()[0].data).toMatchObject({ price: 5000, total: 30000, status: 'requested' })
  })
  it('snapshots the admin fee settings at request time', async () => {
    ready(); w.db.seed('settings/payments', { platformFeePercent: 5, feePayer: 'split' })
    await req()
    expect(leases()[0].data).toMatchObject({ feePercent: 5, feePayer: 'split' })
  })
  it('daily rentals are a single payment with no deposit', async () => {
    ready({ rentType: 'daily', price: 800 })
    await req({ unitId: UNIT, startDate: '2027-03-20', days: 5, phone: '01012345678', acceptedPolicy: '2027-03-01' })
    expect(leases()[0].data).toMatchObject({ rentType: 'daily', total: 4000, installments: 1, depositCents: 0, depositMode: 'none', days: 5 })
  })
  it('a unit with deposit mode "none" asks for no deposit', async () => {
    ready({ depositMode: 'none' })
    await req()
    expect(leases()[0].data.depositCents).toBe(0)
  })

  describe('rejects', () => {
    it('anonymous callers', async () => { ready(); expect((await call(onRequestPost, w.env, { body: good })).status).toBe(401) })
    it('payments switched off by the admin (503)', async () => {
      ready(); w.db.seed('settings/payments', { paymentsEnabled: false })
      expect((await req()).status).toBe(503)
      expect(leases()).toHaveLength(0)
    })
    it('a bad unit id', async () => { ready(); expect((await req({ ...good, unitId: '../x' })).json.error).toBe('bad-id') })
    it('a missing policy acceptance (when the policy page is on)', async () => {
      ready()
      expect((await req({ ...good, acceptedPolicy: undefined })).json.error).toBe('policy')
      expect((await req({ ...good, acceptedPolicy: 'yes' })).json.error).toBe('policy')
    })
    it('policy acceptance is not required when the admin hid the policy page', async () => {
      ready(); w.db.seed('settings/policyPage', { visible: false })
      expect((await req({ ...good, acceptedPolicy: undefined })).status).toBe(200)
    })
    it.each(['abc', '123', '', '0101-234-5678', '1'.repeat(21)])('phone %j', async (phone) => {
      ready(); expect((await req({ ...good, phone })).json.error).toBe('bad-phone')
    })
    it('units that are not available: missing, hidden, rented, expired', async () => {
      seedUser(w.db, TENANT)
      expect((await req()).status).toBe(404)
      for (const over of [{ status: 'hidden' }, { status: 'rented' }, { status: 'removed' }, { expiresAt: new Date(Date.now() - 1000) }]) {
        seedUnit(w.db, over); expect((await req()).status).toBe(404)
      }
      expect(leases()).toHaveLength(0)
    })
    it('renting your own unit', async () => { ready(); seedUser(w.db, OWNER); expect((await req(good, OWNER)).json.error).toBe('own-unit') })
    it('a second open request on the same unit', async () => {
      ready(); await req()
      const r = await req()
      expect([r.status, r.json.error]).toEqual([409, 'duplicate'])
      expect(leases()).toHaveLength(1)
    })
    it('a different tenant may request the same unit', async () => { ready(); seedUser(w.db, OTHER); await req(); expect((await req(good, OTHER)).status).toBe(200) })
    it('more open requests than the admin limit (429)', async () => {
      ready(); w.db.seed('settings/payments', { maxOpenRequests: 2 })
      for (const i of [1, 2]) seedLease(w.db, { id: `leaseOpen00000000000${i}`, unitId: `unitDDDDDD000${i}`, status: i === 1 ? 'requested' : 'active' })
      expect((await req()).status).toBe(429)
    })
    it('finished leases do not count towards the open-request limit', async () => {
      ready(); w.db.seed('settings/payments', { maxOpenRequests: 1 })
      seedLease(w.db, { id: 'leaseOld0000000000001', unitId: UNIT, status: 'ended' })
      expect((await req()).status).toBe(200)
    })
    it.each([
      ['start date in the past', { startDate: '2027-03-09' }],
      ['impossible date', { startDate: '2027-02-31' }],
      ['not a date', { startDate: 'tomorrow' }],
      ['start more than 180 days ahead', { startDate: '2028-03-20' }],
      ['duration that the cycle does not divide', { durationMonths: 5, cycleMonths: 3 }],
      ['a cycle the admin does not allow', { cycleMonths: 2, durationMonths: 6 }],
      ['zero months', { durationMonths: 0 }],
      ['more months than the maximum', { durationMonths: 36, cycleMonths: 12 }],
      ['negative months', { durationMonths: -6 }],
      ['fractional months', { durationMonths: 1.5, cycleMonths: 1 }],
      ['text instead of numbers', { durationMonths: 'six' }],
    ])('%s', async (_n, over) => {
      ready(); const r = await req({ ...good, ...over })
      expect([r.status, r.json.error]).toEqual([400, 'bad-terms'])
      expect(leases()).toHaveLength(0)
    })
    it('daily rentals outside 1..90 days', async () => {
      ready({ rentType: 'daily', price: 800 })
      for (const days of [0, 91, -1, 2.5]) expect((await req({ unitId: UNIT, startDate: '2027-03-20', days, phone: '01012345678', acceptedPolicy: '2027-03-01' })).status).toBe(400)
    })
    it('a listing with an absurd deposit (overflow) instead of producing an unpayable installment', async () => {
      for (const deposit of [1e15, 10_000_001]) { ready({ deposit }); const r = await req(); expect([r.status, r.json.error]).toEqual([400, 'bad-deposit']) }
      ready({ deposit: 10_000_000 }); expect((await req()).status).toBe(200)
    })
    it('a listing whose price is corrupt (zero / negative / not a number)', async () => {
      for (const price of [0, -5, 'free']) { ready({ price }); expect((await req()).status).toBe(400) }
    })
  })
})
