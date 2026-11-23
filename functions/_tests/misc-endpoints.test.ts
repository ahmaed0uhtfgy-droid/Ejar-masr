// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as adminDeleteUser } from '../api/admin-delete-user'
import { onRequestGet as health } from '../api/health'
import { onRequestPost as reveal } from '../api/reveal'
import { onRequestPost as signUpload } from '../api/sign-upload'
import { onRequestPost as view } from '../api/view'
import { ADMIN, LEASE, OTHER, OWNER, TENANT, UNIT, as, call, makeEnv, seedLease, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()

/** Minimal stand-in for Cloudflare's caches.default (match/put by URL). */
function fakeCaches() {
  const store = new Map<string, Response>()
  return { default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => { store.set(r.url, res) }, delete: async (r: Request) => store.delete(r.url) } }
}
beforeEach(() => { vi.stubGlobal('caches', fakeCaches()) })
afterEach(() => { vi.unstubAllGlobals() })

describe('POST /api/sign-upload', () => {
  it('returns a Cloudinary signature the browser can use: scoped to the user folder, image types only, correct SHA-1', async () => {
    seedUser(w.db, TENANT)
    const r = await call(signUpload, w.env, { token: as(TENANT) })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ cloudName: 'democloud', apiKey: 'cloud-key-123', folder: `units/${TENANT}`, allowedFormats: 'jpg,jpeg,png,webp' })
    const expected = createHash('sha1').update(`allowed_formats=jpg,jpeg,png,webp&folder=units/${TENANT}&timestamp=${r.json.timestamp}cloud-secret-abc`).digest('hex')
    expect(r.json.signature).toBe(expected)
    expect(Math.abs(Number(r.json.timestamp) - Date.now() / 1000)).toBeLessThan(5)
  })
  it('never exposes the API secret', async () => {
    seedUser(w.db, TENANT)
    expect((await call(signUpload, w.env, { token: as(TENANT) })).text).not.toContain('cloud-secret-abc')
  })
  it('each user can only get signatures for their own folder, whatever they send', async () => {
    seedUser(w.db, TENANT); seedUser(w.db, OTHER)
    const r = await call(signUpload, w.env, { token: as(TENANT), body: { folder: `units/${OTHER}`, allowed_formats: 'exe' } })
    expect(r.json.folder).toBe(`units/${TENANT}`); expect(r.json.allowedFormats).toBe('jpg,jpeg,png,webp')
  })
})

describe('POST /api/view (anonymous view counter)', () => {
  const ip = (v: string) => ({ 'CF-Connecting-IP': v })
  const views = () => w.db.get(`unitStats/${UNIT}`)?.views
  it('counts a view once per visitor per unit, and again for a different visitor; the total is written in batches of 5', async () => {
    seedUnit(w.db)
    expect((await call(view, w.env, { body: { unitId: UNIT }, headers: ip('1.1.1.1') })).json.counted).toBe(true)
    expect((await call(view, w.env, { body: { unitId: UNIT }, headers: ip('1.1.1.1') })).json.counted).toBe(false)
    for (const v of ['2.2.2.2', '3.3.3.3', '4.4.4.4']) await call(view, w.env, { body: { unitId: UNIT }, headers: ip(v) })
    expect(views()).toBeUndefined() // 4 counted so far: still pending at the edge
    await call(view, w.env, { body: { unitId: UNIT }, headers: ip('5.5.5.5') })
    expect(views()).toBe(5)
  })
  it('does not count, or write anything for, inactive units, bad ids or junk', async () => {
    seedUnit(w.db, { status: 'hidden' })
    expect((await call(view, w.env, { body: { unitId: UNIT }, headers: ip('3.3.3.3') })).status).toBe(404)
    expect((await call(view, w.env, { body: { unitId: '../x' } })).status).toBe(400)
    expect((await call(view, w.env, { rawBody: 'nope' })).status).toBe(400)
    expect(w.db.get(`unitStats/${UNIT}`)).toBeUndefined()
  })
  it('a flood from one IP costs no database write at all (one pending count)', async () => {
    seedUnit(w.db); w.db.resetCounters()
    for (let i = 0; i < 50; i++) await call(view, w.env, { body: { unitId: UNIT }, headers: ip('9.9.9.9') })
    expect(w.db.counters.writes).toBe(0)
  })
})

describe('quota protection (nothing here may be usable to drain the free plans)', () => {
  const ip = (v: string) => ({ 'CF-Connecting-IP': v })
  it('one source cannot trigger more than 60 database-touching view calls per hour, however many units it tries', async () => {
    for (let i = 0; i < 90; i++) seedUnit(w.db, { id: `unitFlood${String(i).padStart(5, '0')}` })
    w.db.resetCounters()
    for (let i = 0; i < 90; i++) await call(view, w.env, { body: { unitId: `unitFlood${String(i).padStart(5, '0')}` }, headers: ip('6.6.6.6') })
    expect(w.db.counters.writes).toBeLessThanOrEqual(60); expect(w.db.counters.reads).toBeLessThanOrEqual(60)
    expect((await call(view, w.env, { body: { unitId: `unitFlood00000` }, headers: ip('7.7.7.7') })).json.counted).toBe(true) // other visitors are unaffected
  })
  it('the "is this unit active" lookup is shared: 20 different visitors cost ONE read, not 20', async () => {
    seedUnit(w.db); w.db.resetCounters()
    for (let i = 0; i < 20; i++) await call(view, w.env, { body: { unitId: UNIT }, headers: ip(`10.0.0.${i}`) })
    expect(w.db.counters.reads).toBe(1); expect(w.db.counters.writes).toBe(4)
  })
  it('probing ids that do not exist is remembered, so repeats cost nothing', async () => {
    w.db.resetCounters()
    for (let i = 0; i < 10; i++) await call(view, w.env, { body: { unitId: 'unitMissing0001' }, headers: ip(`11.0.0.${i}`) })
    expect(w.db.counters.reads).toBe(1)
  })
  it('any signed-in account is limited to 120 API calls per 10 minutes, checked BEFORE any database read', async () => {
    seedUser(w.db, TENANT); seedUser(w.db, OTHER)
    const hit = () => call(reveal, w.env, { token: as(TENANT), body: { unitId: UNIT } }) // missing unit: a cheap 404
    for (let i = 0; i < 120; i++) expect((await hit()).status).toBe(404)
    w.db.resetCounters()
    const r = await hit()
    expect([r.status, r.json.error]).toEqual([429, 'rate'])
    expect(w.db.counters.reads).toBe(0)
    expect((await call(reveal, w.env, { token: as(OTHER), body: { unitId: UNIT } })).status).toBe(404) // other accounts unaffected
  })
  it('sign-upload: one account gets 40 signatures per hour, not unlimited uploads', async () => {
    seedUser(w.db, TENANT)
    for (let i = 0; i < 40; i++) expect((await call(signUpload, w.env, { token: as(TENANT) })).status).toBe(200)
    const r = await call(signUpload, w.env, { token: as(TENANT) })
    expect([r.status, r.json.error]).toEqual([429, 'rate'])
    seedUser(w.db, OTHER); expect((await call(signUpload, w.env, { token: as(OTHER) })).status).toBe(200)
  })
})

describe('GET /api/health', () => {
  it('reports presence as booleans only: no secret value ever appears in the response', async () => {
    w.db.external = () => new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }))
    const r = await call(health, w.env, { method: 'GET' })
    for (const secret of ['sk_test_secret', 'test-hmac-secret', 'cloud-secret-abc', 'cloud-key-123', 'pk_test_public', 'test-cron-secret', 're_test_key', 'unused-in-tests', 'sa@test-project']) expect(r.text).not.toContain(secret)
    expect(Object.values(r.json.present as Record<string, unknown>).every((v) => typeof v === 'boolean')).toBe(true)
  })
  it('flags a project-id mismatch and missing settings', async () => {
    const r = await call(health, makeEnv({ PAYMOB_SECRET_KEY: undefined, FIREBASE_PROJECT_ID: 'other-project' }), { method: 'GET' })
    expect(r.json.projectMatches).toBe(false)
    expect((r.json.present as Record<string, boolean>).PAYMOB_SECRET_KEY).toBe(false)
  })
  it('does not crash on a malformed service account', async () => {
    const r = await call(health, makeEnv({ FIREBASE_SERVICE_ACCOUNT: '{not json' }), { method: 'GET' })
    expect([r.status, r.json.serviceAccount]).toEqual([200, 'failed'])
  })
})

describe('POST /api/admin-delete-user', () => {
  const del = (uid: unknown, token = as(ADMIN)) => call(adminDeleteUser, w.env, { token, body: { uid } })
  function ready() { seedUser(w.db, ADMIN, { role: 'admin' }); seedUser(w.db, OWNER); seedUnit(w.db); w.db.seed(`contacts/${UNIT}`, { ownerId: OWNER, phone: '0101' }); w.db.external = () => new Response('{}') }
  it('removes the profile, the Auth account, the ads and their contacts, and writes an audit entry', async () => {
    ready()
    const r = await del(OWNER)
    expect(r.json).toMatchObject({ ok: true, unitsDeleted: 1 })
    expect(w.db.get(`users/${OWNER}`)).toBeUndefined(); expect(w.db.get(`units/${UNIT}`)).toBeUndefined(); expect(w.db.get(`contacts/${UNIT}`)).toBeUndefined()
    const audit = w.db.list('auditLogs')
    expect(audit).toHaveLength(1); expect(audit[0].data).toMatchObject({ adminId: ADMIN, action: 'user.delete', targetId: OWNER })
    expect(w.db.externalCalls[0].url).toContain('accounts:delete')
  })
  it('an admin cannot delete their own account; bad uids are refused', async () => {
    ready()
    expect((await del(ADMIN)).json.error).toBe('self')
    for (const uid of ['a', '../x', 'a b', 5, null, 'x'.repeat(200)]) expect((await del(uid)).json.error).toBe('bad-uid')
    expect(w.db.get(`users/${ADMIN}`)).toBeDefined()
  })
  it('treats "user not found" in Auth as success, but a real Auth failure is reported and the profile is kept', async () => {
    ready(); w.db.external = () => new Response('{"error":{"message":"USER_NOT_FOUND"}}', { status: 400 })
    expect((await del(OWNER)).status).toBe(200)
    ready(); w.db.external = () => new Response('boom', { status: 500 })
    const r = await del(OWNER)
    expect([r.status, r.json.error]).toEqual([502, 'auth-delete'])
    expect(w.db.get(`users/${OWNER}`)).toBeDefined()
  })
  it('refuses to delete someone with a live lease or an unresolved deposit (as owner or as tenant)', async () => {
    ready()
    for (const [side, over] of [['ownerId', { status: 'active' }], ['tenantId', { status: 'active' }], ['ownerId', { status: 'requested' }], ['tenantId', { status: 'ended', depositStatus: 'held' }], ['ownerId', { status: 'ended', depositStatus: 'disputed' }], ['ownerId', { status: 'ended', depositStatus: 'settled', depositTransfer: 'pending' }]] as const) {
      w.db.docs.delete(`leases/${LEASE}`)
      seedLease(w.db, { [side]: OWNER, ...(side === 'ownerId' ? {} : { ownerId: OTHER }), ...over })
      const r = await del(OWNER)
      expect([r.status, r.json.error]).toEqual([409, 'has-leases'])
      expect(w.db.get(`users/${OWNER}`)).toBeDefined(); expect(w.db.get(`units/${UNIT}`)).toBeDefined()
    }
  })
  it('allows deleting once their leases are finished and settled, and removes their payout details', async () => {
    ready(); seedLease(w.db, { ownerId: OWNER, status: 'ended', depositStatus: 'none' })
    w.db.seed(`users/${OWNER}/payout/main`, { method: 'wallet', holder: 'x y z', account: '0101234567' })
    expect((await del(OWNER)).status).toBe(200)
    expect(w.db.get(`users/${OWNER}/payout/main`)).toBeUndefined()
  })
  it('a normal user cannot delete anyone', async () => {
    ready(); seedUser(w.db, OTHER)
    expect((await del(OWNER, as(OTHER))).status).toBe(403)
    expect(w.db.get(`users/${OWNER}`)).toBeDefined()
  })
})
