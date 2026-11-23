// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost as adminDeleteUser } from '../api/admin-delete-user'
import { onRequestPost as refundRecord } from '../api/refund-record'
import { onRequestPost as reveal } from '../api/reveal'
import { onRequestPost as signUpload } from '../api/sign-upload'
import { ADMIN, OTHER, OWNER, TENANT, as, call, makeEnv, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()

describe('authentication (requireUser) on a protected endpoint', () => {
  it('rejects a request with no Authorization header', async () => {
    expect((await call(signUpload, w.env)).json.error).toBe('unauthenticated')
  })
  it('rejects a header that is not a Bearer token', async () => {
    expect((await call(signUpload, w.env, { headers: { Authorization: 'Basic abc' } })).status).toBe(401)
  })
  it('rejects garbage, expired and wrong-project tokens with distinct 401 codes', async () => {
    seedUser(w.db, TENANT)
    expect((await call(signUpload, w.env, { token: 'garbage' })).json.error).toBe('bad-token')
    expect((await call(signUpload, w.env, { token: 'expired' })).json.error).toBe('token-expired')
    expect((await call(signUpload, w.env, { token: 'wrong-project' })).json.error).toBe('project-mismatch')
  })
  it('rejects a valid token whose user has no profile (403)', async () => {
    const r = await call(signUpload, w.env, { token: as('ghostUser001') })
    expect([r.status, r.json.error]).toEqual([403, 'no-profile'])
  })
  it('rejects banned users (403)', async () => {
    seedUser(w.db, TENANT, { banned: true })
    const r = await call(signUpload, w.env, { token: as(TENANT) })
    expect([r.status, r.json.error]).toEqual([403, 'banned'])
  })
  it('accepts a valid user', async () => {
    seedUser(w.db, TENANT)
    expect((await call(signUpload, w.env, { token: as(TENANT) })).status).toBe(200)
  })
  it('fails loudly (500) rather than open when the server is missing its Firebase config', async () => {
    seedUser(w.db, TENANT)
    const r = await call(signUpload, makeEnv({ FIREBASE_SERVICE_ACCOUNT: '' }), { token: as(TENANT) })
    expect([r.status, r.json.error]).toEqual([500, 'server-misconfigured'])
  })
  it('does not leak internals in unexpected-error responses', async () => {
    seedUser(w.db, TENANT)
    const r = await call(reveal, w.env, { token: as(TENANT), body: { unitId: 'unitAAAAAA0001' } }) // unit missing -> clean 404
    expect(r.status).toBe(404)
    w.db.failCommit = true
    seedUnit(w.db); w.db.seed('contacts/unitAAAAAA0001', { phone: '0101', whatsapp: '' })
    const e = await call(reveal, w.env, { token: as(TENANT), body: { unitId: 'unitAAAAAA0001' } })
    expect(e.status).toBe(500)
    expect(e.text).not.toContain('firestore')
    expect(e.text).not.toContain('injected')
  })
})

describe('admin-only endpoints', () => {
  const cases: [string, Parameters<typeof call>[0], unknown][] = [
    ['admin-delete-user', adminDeleteUser, { uid: 'someUser0001' }],
    ['refund-record', refundRecord, { paymentId: 'leaseAAAAAAAAAA000001_0', amount: 1 }],
  ]
  it.each(cases)('%s refuses a normal user (403 forbidden) and an anonymous caller (401)', async (_name, handler, body) => {
    seedUser(w.db, OTHER)
    expect((await call(handler, w.env, { token: as(OTHER), body })).json.error).toBe('forbidden')
    expect((await call(handler, w.env, { body })).status).toBe(401)
  })
  it('a banned admin is still refused', async () => {
    seedUser(w.db, ADMIN, { role: 'admin', banned: true })
    expect((await call(adminDeleteUser, w.env, { token: as(ADMIN), body: { uid: 'someUser0001' } })).status).toBe(403)
  })
  it('role is read from the database, never from the token or the request', async () => {
    seedUser(w.db, OWNER)
    const r = await call(adminDeleteUser, w.env, { token: as(OWNER), body: { uid: 'someUser0001', role: 'admin', isAdmin: true } })
    expect(r.status).toBe(403)
  })
})

describe('malformed bodies', () => {
  it('returns 400 for invalid JSON and for ids that are path-traversal attempts', async () => {
    seedUser(w.db, TENANT)
    expect((await call(reveal, w.env, { token: as(TENANT), rawBody: '{oops' })).json.error).toBe('bad-json')
    for (const unitId of ['../users/x', 'a/b', '', 123, null, { $ne: 1 }, 'x'.repeat(41)]) {
      expect((await call(reveal, w.env, { token: as(TENANT), body: { unitId } })).status).toBe(400)
    }
  })
})
