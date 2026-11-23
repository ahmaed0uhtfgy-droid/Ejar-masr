// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/sweep'
import { ADMIN, CRON_SECRET, LEASE, OTHER, OWNER, TENANT, TODAY, UNIT, as, call, seedLease, seedPayment, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const sweep = (token = CRON_SECRET) => call(onRequestPost, w.env, { path: '/api/sweep', token })
const notes = (uid: string) => w.db.list(`users/${uid}/notifications`)
const emails = () => w.db.externalCalls.filter((c) => c.url === 'https://api.resend.com/emails')
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
function base() { for (const u of [OWNER, TENANT]) seedUser(w.db, u) }

describe('POST /api/sweep: who may run it', () => {
  it('accepts the cron secret and an admin token, nobody else', async () => {
    base(); seedUser(w.db, ADMIN, { role: 'admin' }); seedUser(w.db, OTHER)
    expect((await sweep()).status).toBe(200)
    expect((await sweep(as(ADMIN))).status).toBe(200)
    expect((await sweep(as(OTHER))).status).toBe(403)
    expect((await sweep('wrong-secret')).status).toBe(401)
    expect((await sweep(CRON_SECRET.slice(0, -1))).status).toBe(401)
    expect((await call(onRequestPost, w.env, {})).status).toBe(401)
  })
  it('an unset CRON_SECRET never lets an empty or arbitrary token through', async () => {
    base(); w.env.CRON_SECRET = undefined
    expect((await sweep('')).status).toBe(401)
    expect((await sweep('undefined')).status).toBe(401)
  })
})

describe('POST /api/sweep: ending finished leases', () => {
  it('ends a lease whose end date has passed, cancels unpaid installments, re-lists the unit and tells both sides', async () => {
    base(); seedUnit(w.db, { status: 'rented', rentedLeaseId: LEASE })
    seedLease(w.db, { status: 'active', endDate: addDays(TODAY, -1) })
    seedPayment(w.db, 0, { status: 'paid', payoutStatus: 'held' }); seedPayment(w.db, 1, { status: 'due' })
    const r = await sweep()
    expect(r.json).toMatchObject({ ok: true, ended: 1, more: false, today: TODAY })
    expect(w.db.get(`leases/${LEASE}`)?.status).toBe('ended')
    expect(w.db.get(`payments/${LEASE}_0`)?.status).toBe('paid')
    expect(w.db.get(`payments/${LEASE}_1`)?.status).toBe('cancelled')
    expect(w.db.get(`units/${UNIT}`)?.status).toBe('active')
    expect(notes(TENANT)).toHaveLength(1); expect(notes(OWNER)).toHaveLength(1)
  })
  it('does not end a lease on its last day', async () => {
    base(); seedLease(w.db, { status: 'active', endDate: TODAY, firstPaidAt: new Date(), moveInConfirmedAt: new Date() })
    expect((await sweep()).json.ended).toBe(0)
  })
  it('is idempotent: running it again does nothing more', async () => {
    base(); seedUnit(w.db, { status: 'rented', rentedLeaseId: LEASE }); seedLease(w.db, { status: 'active', endDate: addDays(TODAY, -1) })
    await sweep(); const again = await sweep()
    expect(again.json.ended).toBe(0)
    expect(notes(TENANT)).toHaveLength(1)
  })
  it('ignores leases that are not active', async () => {
    base(); seedLease(w.db, { status: 'requested', endDate: addDays(TODAY, -5) })
    expect((await sweep()).json.ended).toBe(0)
  })
})

describe('POST /api/sweep: move-in reminders', () => {
  const paidLease = (over: Record<string, unknown> = {}) => seedLease(w.db, { status: 'active', firstPaidAt: new Date(), startDate: addDays(TODAY, -2), endDate: addDays(TODAY, 100), ...over })
  it('asks the tenant once per day, by in-app notice and email', async () => {
    base(); paidLease()
    expect((await sweep()).json.moveInReminders).toBe(1)
    expect(notes(TENANT)).toHaveLength(1)
    expect(emails()).toHaveLength(1)
    expect((emails()[0].body as Record<string, unknown>).to).toEqual([`${TENANT}@example.com`])
    expect((await sweep()).json.moveInReminders).toBe(0) // same day: marker prevents a repeat
    expect(notes(TENANT)).toHaveLength(1)
  })
  it('stops after the admin-configured number of days, and skips unpaid / not-started / already confirmed leases', async () => {
    base(); paidLease({ startDate: addDays(TODAY, -20) })
    expect((await sweep()).json.moveInReminders).toBe(0)
    paidLease({ startDate: addDays(TODAY, 3) }); expect((await sweep()).json.moveInReminders).toBe(0)
    paidLease({ firstPaidAt: undefined }); expect((await sweep()).json.moveInReminders).toBe(0)
    paidLease({ moveInConfirmedAt: new Date() }); expect((await sweep()).json.moveInReminders).toBe(0)
  })
  it('works without email configured (in-app notice only)', async () => {
    base(); paidLease(); w.env.RESEND_API_KEY = undefined
    await sweep(); expect(notes(TENANT)).toHaveLength(1); expect(emails()).toHaveLength(0)
  })
  it('an email provider outage never blocks the in-app notice or crashes the job', async () => {
    base(); paidLease(); w.db.external = () => new Response('down', { status: 503 })
    const r = await sweep()
    expect(r.status).toBe(200); expect(notes(TENANT)).toHaveLength(1)
  })
})

describe('POST /api/sweep: installment reminders', () => {
  const lease = () => seedLease(w.db, { status: 'active', reminderDays: 3, firstPaidAt: new Date(), moveInConfirmedAt: new Date(), endDate: addDays(TODAY, 300) })
  const due = (offset: number, status = 'due') => seedPayment(w.db, 0, { dueDate: addDays(TODAY, offset), status })
  it.each([[3, true], [2, false], [1, true], [0, true], [4, false], [-1, true], [-2, false], [-3, false], [-4, true], [-7, true], [-13, true], [-14, false], [-16, false]])('payment due in %i days -> reminder: %s', async (offset, sent) => {
    base(); lease(); due(offset)
    expect((await sweep()).json.installmentReminders).toBe(sent ? 1 : 0)
  })
  it('also reminds about failed payments, never about paid or cancelled ones', async () => {
    base(); lease(); due(0, 'failed'); expect((await sweep()).json.installmentReminders).toBe(1)
    for (const s of ['paid', 'cancelled', 'refunded']) { base(); lease(); due(0, s); expect((await sweep()).json.installmentReminders).toBe(0) }
  })
  it('sends at most one reminder per payment per day', async () => {
    base(); lease(); due(0)
    await sweep(); await sweep()
    expect(notes(TENANT)).toHaveLength(1)
  })
  it('skips payments whose lease is not live (ended / cancelled)', async () => {
    base(); seedLease(w.db, { status: 'ended' }); due(0)
    expect((await sweep()).json.installmentReminders).toBe(0)
  })
  it("uses the owner's chosen reminder days", async () => {
    base(); seedLease(w.db, { status: 'active', reminderDays: 5, firstPaidAt: new Date(), moveInConfirmedAt: new Date(), endDate: addDays(TODAY, 300) }); due(5)
    expect((await sweep()).json.installmentReminders).toBe(1)
  })
})

describe('POST /api/sweep: scale warning', () => {
  it('reports truncated:false normally, and truncated:true when the 500-lease window is full', async () => {
    base()
    expect((await sweep()).json.truncated).toBe(false)
    for (let i = 0; i < 500; i++) seedLease(w.db, { id: `leaseFill${String(i).padStart(12, '0')}`, status: 'active', firstPaidAt: new Date(), moveInConfirmedAt: new Date(), endDate: addDays(TODAY, 100) })
    const orig = console.error; console.error = () => {}
    const r = await sweep()
    console.error = orig
    expect(r.json.truncated).toBe(true)
  })
})

describe('POST /api/sweep: free-plan limits (Cloudflare allows ~50 outbound requests per invocation)', () => {
  it('never exceeds 50 outbound requests per run, and finishes the whole backlog over repeated runs without skipping or double-notifying anyone', async () => {
    seedUser(w.db, OWNER)
    const N = 60
    for (let i = 0; i < N; i++) {
      const t = `tenantBulk${String(i).padStart(4, '0')}`
      seedUser(w.db, t)
      seedLease(w.db, { id: `leaseBulk${String(i).padStart(11, '0')}`, tenantId: t, status: 'active', firstPaidAt: new Date(), startDate: addDays(TODAY, -2), endDate: addDays(TODAY, 100) })
    }
    let runs = 0
    let more = true
    while (more && runs < 30) {
      w.db.resetCounters()
      const r = await sweep()
      expect(r.status).toBe(200)
      expect(w.db.counters.fetches).toBeLessThanOrEqual(50)
      more = r.json.more === true
      runs++
    }
    expect(more).toBe(false)
    expect(runs).toBeGreaterThan(1) // really had to be split up
    for (let i = 0; i < N; i++) expect(notes(`tenantBulk${String(i).padStart(4, '0')}`)).toHaveLength(1)
  })
  it('a backlog of expired leases is also processed within the limit', async () => {
    seedUser(w.db, OWNER)
    for (let i = 0; i < 40; i++) {
      const t = `tenantEnd${String(i).padStart(5, '0')}`
      seedUser(w.db, t)
      seedLease(w.db, { id: `leaseEnd${String(i).padStart(12, '0')}`, tenantId: t, status: 'active', endDate: addDays(TODAY, -1) })
    }
    let more = true, runs = 0
    while (more && runs < 30) { w.db.resetCounters(); const r = await sweep(); expect(w.db.counters.fetches).toBeLessThanOrEqual(50); more = r.json.more === true; runs++ }
    expect(w.db.list('leases').every((l) => l.data.status === 'ended')).toBe(true)
  })
})
