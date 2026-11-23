// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { cairoDayKey } from '../_lib/logic'
import { onRequestPost } from '../api/reveal'
import { OWNER, TENANT, UNIT, as, call, seedUnit, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const reveal = (uid = TENANT, unitId: unknown = UNIT) => call(onRequestPost, w.env, { token: as(uid), body: { unitId } })
function ready(limit?: number) {
  seedUser(w.db, TENANT); seedUser(w.db, OWNER)
  seedUnit(w.db)
  w.db.seed(`contacts/${UNIT}`, { ownerId: OWNER, phone: '01099998888', whatsapp: '01099998888' })
  if (limit !== undefined) w.db.seed('settings/app', { dailyRevealLimit: limit })
}

describe('POST /api/reveal (contact details are only given out through this endpoint)', () => {
  it('returns the contacts and the remaining daily quota, and logs the reveal', async () => {
    ready()
    const r = await reveal()
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ phone: '01099998888', whatsapp: '01099998888', remaining: 19 })
    const day = cairoDayKey()
    expect(w.db.get(`revealLogs/${TENANT}_${UNIT}_${day}`)).toMatchObject({ uid: TENANT, unitId: UNIT, ownerId: OWNER })
    expect(w.db.get(`revealCounts/${TENANT}_${day}`)?.count).toBe(1)
    expect(w.db.get(`unitStats/${UNIT}`)?.reveals).toBe(1)
  })
  it('revealing the same unit again the same day does not use more quota', async () => {
    ready()
    await reveal()
    const r = await reveal()
    expect(r.json.remaining).toBe(19)
    expect(w.db.get(`revealCounts/${TENANT}_${cairoDayKey()}`)?.count).toBe(1)
    expect(w.db.get(`unitStats/${UNIT}`)?.reveals).toBe(1)
  })
  it('enforces the per-user daily limit from admin settings (429) but still re-serves already revealed units', async () => {
    ready(2)
    for (const id of ['unitBBBBBB0001', 'unitBBBBBB0002']) {
      seedUnit(w.db, { id }); w.db.seed(`contacts/${id}`, { ownerId: OWNER, phone: '0100000000' + id.slice(-1), whatsapp: '' })
      expect((await reveal(TENANT, id)).status).toBe(200)
    }
    const blocked = await reveal(TENANT, UNIT)
    expect([blocked.status, blocked.json.error]).toEqual([429, 'limit'])
    expect((await reveal(TENANT, 'unitBBBBBB0001')).status).toBe(200)
  })
  it('an account younger than 24 h gets a smaller allowance (8), which stops mass sign-ups from scraping numbers', async () => {
    seedUser(w.db, TENANT, { createdAt: new Date(Date.now() - 3600_000) }); seedUser(w.db, OWNER); seedUnit(w.db)
    w.db.seed(`contacts/${UNIT}`, { ownerId: OWNER, phone: '01099998888', whatsapp: '' })
    for (let i = 0; i < 8; i++) { seedUnit(w.db, { id: `unitNew00000${i}` }); w.db.seed(`contacts/unitNew00000${i}`, { ownerId: OWNER, phone: '0100000000' + i, whatsapp: '' }); expect((await reveal(TENANT, `unitNew00000${i}`)).status).toBe(200) }
    expect((await reveal(TENANT, UNIT)).json.error).toBe('limit')
  })
  it('the same account gets the normal allowance once it is a day old', async () => {
    seedUser(w.db, TENANT, { createdAt: new Date(Date.now() - 25 * 3600_000) }); seedUser(w.db, OWNER); seedUnit(w.db)
    w.db.seed(`contacts/${UNIT}`, { ownerId: OWNER, phone: '01099998888', whatsapp: '' })
    expect((await reveal()).json.remaining).toBe(19)
  })
  it('a burst of PARALLEL requests cannot slip past the daily limit (the counter is written atomically)', async () => {
    ready(5)
    w.db.seed(`revealCounts/${TENANT}_${cairoDayKey()}`, { count: 1 }) // already used one today: exercises the update path, not just first-time creation
    const unitIds = Array.from({ length: 30 }, (_, i) => `unitBurst${String(i).padStart(5, '0')}`)
    for (const id of unitIds) { seedUnit(w.db, { id }); w.db.seed(`contacts/${id}`, { ownerId: OWNER, phone: '01011112222', whatsapp: '' }) }
    const rs = await Promise.all(unitIds.map((id) => reveal(TENANT, id)))
    const ok = rs.filter((r) => r.status === 200).length
    expect(ok).toBeGreaterThanOrEqual(1)
    expect(ok).toBeLessThanOrEqual(4) // limit 5, one already used
    expect(Number(w.db.get(`revealCounts/${TENANT}_${cairoDayKey()}`)?.count)).toBe(1 + ok) // what was handed out is exactly what was counted
    expect(w.db.list('revealLogs')).toHaveLength(ok)
    expect(rs.every((r) => [200, 409, 429].includes(r.status))).toBe(true)
  })
  it('quota is per user', async () => {
    ready(1)
    seedUser(w.db, 'otherUser001')
    expect((await reveal(TENANT)).status).toBe(200)
    expect((await reveal('otherUser001')).status).toBe(200)
  })
  it('refuses hidden, removed, rented and expired units', async () => {
    ready()
    for (const [id, over, status] of [['unitCCCCCC0001', { status: 'hidden' }, 404], ['unitCCCCCC0002', { status: 'removed' }, 404], ['unitCCCCCC0003', { status: 'rented' }, 404], ['unitCCCCCC0004', { expiresAt: new Date(Date.now() - 1000) }, 410]] as const) {
      seedUnit(w.db, { id, ...over }); w.db.seed(`contacts/${id}`, { ownerId: OWNER, phone: '01011112222', whatsapp: '' })
      expect((await reveal(TENANT, id)).status).toBe(status)
    }
    expect(w.db.list('revealLogs')).toHaveLength(0)
  })
  it('404 when the unit has no contact record, and does not charge quota for it', async () => {
    seedUser(w.db, TENANT); seedUnit(w.db)
    expect((await reveal()).json.error).toBe('no-contact')
    expect(w.db.get(`revealCounts/${TENANT}_${cairoDayKey()}`)).toBeUndefined()
  })
  it('needs a logged-in user', async () => {
    ready()
    expect((await call(onRequestPost, w.env, { body: { unitId: UNIT } })).status).toBe(401)
  })
})
