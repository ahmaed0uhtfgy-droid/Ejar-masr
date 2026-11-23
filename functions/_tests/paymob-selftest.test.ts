// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { onRequestPost } from '../api/paymob-selftest'
import { ADMIN, OTHER, as, call, makeEnv, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const run = (uid = ADMIN, env = w.env) => call(onRequestPost, env, { token: as(uid), body: {} })
const intentions = () => w.db.externalCalls.filter((c) => c.url.includes('/v1/intention/'))

describe('POST /api/paymob-selftest', () => {
  it('admin only', async () => {
    seedUser(w.db, ADMIN, { role: 'admin' }); seedUser(w.db, OTHER)
    expect((await run(OTHER)).status).toBe(403)
    expect((await call(onRequestPost, w.env, { body: {} })).status).toBe(401)
    expect(intentions()).toHaveLength(0)
  })
  it('everything configured and Paymob answers with an order id: all checks pass, nothing is charged', async () => {
    seedUser(w.db, ADMIN, { role: 'admin' })
    w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs', intention_order_id: 4242 }))
    const r = await run()
    expect(r.json.ok).toBe(true)
    expect((r.json.checks as { ok: boolean; detail?: string }[]).every((c) => c.ok)).toBe(true)
    expect(JSON.stringify(r.json.checks)).toContain('4242')
    expect(intentions()).toHaveLength(1)
  })
  it('a missing setting is reported by name and Paymob is not even called', async () => {
    seedUser(w.db, ADMIN, { role: 'admin' })
    const r = await run(ADMIN, makeEnv({ PAYMOB_HMAC_SECRET: undefined }))
    expect(r.json.ok).toBe(false)
    expect(JSON.stringify(r.json.checks)).toContain('PAYMOB_HMAC_SECRET')
    expect(intentions()).toHaveLength(0)
  })
  it('Paymob rejecting the keys, or answering without an order id, fails the check with a reason', async () => {
    seedUser(w.db, ADMIN, { role: 'admin' })
    const orig = console.error; console.error = () => {}
    w.db.external = () => new Response('unauthorized', { status: 401 })
    expect((await run()).json.ok).toBe(false)
    w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs' }))
    const r = await run()
    console.error = orig
    expect(r.json.ok).toBe(false)
    expect(JSON.stringify(r.json.checks)).toContain('غير متوقع')
  })
  it('never leaks a secret in its answer', async () => {
    seedUser(w.db, ADMIN, { role: 'admin' })
    w.db.external = () => new Response(JSON.stringify({ client_secret: 'cs_super_secret', intention_order_id: 1 }))
    const text = (await run()).text
    for (const secret of ['sk_test_secret', 'test-hmac-secret', 'cs_super_secret', 'pk_test_public']) expect(text).not.toContain(secret)
  })
})
