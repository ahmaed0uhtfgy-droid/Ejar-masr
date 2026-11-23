// @vitest-environment node
// Free-plan guard: how many database reads/writes and outbound requests each user action costs.
// The limits that matter on the free plans are DAILY quotas (Firestore: 50,000 reads / 20,000 writes; Cloudflare Functions: 100,000 requests),
// so a code change that quietly doubles the cost of a popular action is a performance regression even if every test still passes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as leaseRequest } from '../api/lease-request'
import { onRequestPost as payCreate } from '../api/pay-create'
import { onRequestPost as payWebhook } from '../api/pay-webhook'
import { onRequestPost as reveal } from '../api/reveal'
import { onRequestPost as view } from '../api/view'
import { onRequestGet as sitemap } from '../sitemap.xml'
import { LEASE, OWNER, TENANT, UNIT, as, call, paymobCallback, seedLease, seedPayment, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
beforeEach(() => { const s = new Map<string, Response>(); vi.stubGlobal('caches', { default: { match: async (r: Request) => s.get(r.url)?.clone(), put: async (r: Request, x: Response) => { s.set(r.url, x) }, delete: async (r: Request) => s.delete(r.url) } }) })
afterEach(() => { vi.unstubAllGlobals() })
const cost = () => ({ reads: w.db.counters.reads, writes: w.db.counters.writes, requests: w.db.counters.fetches })

describe('cost of one user action (reads / writes / outbound requests)', () => {
  it('reveal contact details: first time', async () => {
    seedUser(w.db, TENANT); seedUser(w.db, OWNER); seedUnit(w.db); w.db.seed(`contacts/${UNIT}`, { ownerId: OWNER, phone: '0101', whatsapp: '' })
    w.db.resetCounters(); await call(reveal, w.env, { token: as(TENANT), body: { unitId: UNIT } })
    console.log('COST reveal-first', JSON.stringify(cost()))
    expect(cost().writes).toBeLessThanOrEqual(4); expect(cost().reads).toBeLessThanOrEqual(8); expect(cost().requests).toBeLessThanOrEqual(12)
  })
  it('reveal contact details: repeat on the same unit the same day', async () => {
    seedUser(w.db, TENANT); seedUser(w.db, OWNER); seedUnit(w.db); w.db.seed(`contacts/${UNIT}`, { ownerId: OWNER, phone: '0101', whatsapp: '' })
    await call(reveal, w.env, { token: as(TENANT), body: { unitId: UNIT } })
    w.db.resetCounters(); await call(reveal, w.env, { token: as(TENANT), body: { unitId: UNIT } })
    console.log('COST reveal-repeat', JSON.stringify(cost()))
    expect(cost().writes).toBe(0)
  })
  it('anonymous unit view: counted vs not counted', async () => {
    seedUnit(w.db); w.db.resetCounters()
    await call(view, w.env, { body: { unitId: UNIT }, headers: { 'CF-Connecting-IP': '5.5.5.5' } })
    console.log('COST view-counted', JSON.stringify(cost()))
    const first = cost(); w.db.resetCounters()
    await call(view, w.env, { body: { unitId: UNIT }, headers: { 'CF-Connecting-IP': '5.5.5.5' } })
    console.log('COST view-repeat', JSON.stringify(cost()))
    expect(first.writes).toBe(0); expect(cost().writes).toBe(0) // batched: written once per 5 views
  })
  it('rent request, checkout, and payment confirmation', async () => {
    seedUser(w.db, TENANT, { email: 't@example.com' }); seedUser(w.db, OWNER); seedUnit(w.db)
    w.db.resetCounters()
    await call(leaseRequest, w.env, { token: as(TENANT), body: { unitId: UNIT, startDate: '2027-03-20', durationMonths: 6, cycleMonths: 3, phone: '01012345678', acceptedPolicy: '2027-03-01' } })
    console.log('COST lease-request', JSON.stringify(cost()))
    expect(cost().writes).toBeLessThanOrEqual(3)

    seedLease(w.db, { status: 'active', contractConfirmedAt: new Date() }); seedPayment(w.db, 0, { status: 'due' })
    w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs', intention_order_id: 55001 }))
    w.db.resetCounters(); await call(payCreate, w.env, { token: as(TENANT), body: { paymentId: `${LEASE}_0` } })
    console.log('COST pay-create', JSON.stringify(cost()))
    expect(cost().writes).toBeLessThanOrEqual(2)

    const cb = paymobCallback(`${LEASE}_0`, {}, { orderId: 55001 })
    w.db.resetCounters(); await call(payWebhook, w.env, { query: `?hmac=${cb.hmac}`, body: cb.body })
    console.log('COST pay-webhook', JSON.stringify(cost()))
    expect(cost().requests).toBeLessThanOrEqual(10)
  })
  it('a forged webhook costs nothing but CPU: no database access at all', async () => {
    w.db.resetCounters()
    for (let i = 0; i < 20; i++) await call(payWebhook, w.env, { query: `?hmac=${'0'.repeat(128)}`, body: { type: 'TRANSACTION', obj: { id: i, order: { id: i } } } })
    expect(cost()).toEqual({ reads: 0, writes: 0, requests: 0 })
  })
  it('anonymous calls to protected endpoints cost nothing (rejected before any read)', async () => {
    w.db.resetCounters()
    for (const h of [reveal, leaseRequest, payCreate]) await call(h, w.env, { body: {} })
    expect(cost()).toEqual({ reads: 0, writes: 0, requests: 0 })
  })
  it('the sitemap is rebuilt from the database at most once per cache period, whatever the traffic', async () => {
    for (let i = 0; i < 5; i++) seedUnit(w.db, { id: `unitSitemap${i}0000` })
    w.db.resetCounters(); await call(sitemap, w.env, { method: 'GET', path: '/sitemap.xml' })
    console.log('COST sitemap-cold', JSON.stringify(cost()))
    w.db.resetCounters()
    for (let i = 0; i < 200; i++) await call(sitemap, w.env, { method: 'GET', path: '/sitemap.xml' })
    expect(cost().reads).toBe(0)
  })
})
