// Run with: npm run test:rules  (needs Java + the Firestore emulator via firebase-tools). NOT run in the authoring sandbox.
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

let env: RulesTestEnvironment
const profile = (over: Record<string, unknown> = {}) => ({ displayName: 'Test', email: 't@example.com', role: 'user', accountType: 'owner', banned: false, verified: false, createdAt: Timestamp.now(), ...over })
const unit = (ownerId: string, over: Record<string, unknown> = {}) => ({
  title: 'شقة للإيجار بالمعادي', description: 'وصف', typeId: 'apartment', typeName: 'شقة', rentType: 'monthly', price: 3000, deposit: null,
  governorateId: 'g1', governorateName: 'القاهرة', areaId: 'c1', areaName: 'مدينة نصر', localityId: null, localityName: '', address: '', lat: null, lng: null,
  rooms: 2, bathrooms: 1, area: 90, floor: 1, furnished: false, amenities: [], studentHousing: false, audience: 'all', images: ['c:img1'],
  ownerId, ownerName: 'Test', ownerType: 'owner', ownerVerified: false, status: 'active', hiddenByAdmin: false, durationMode: 'default', expiresAt: null, ...over,
})

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'ejar-masr-test', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } })
})
afterAll(async () => { await env.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/alice'), profile())
    await setDoc(doc(db, 'users/bob'), profile())
    await setDoc(doc(db, 'users/banned'), profile({ banned: true }))
    await setDoc(doc(db, 'users/admin'), profile({ role: 'admin' }))
    await setDoc(doc(db, 'settings/app'), { minImages: 1, maxImages: 3, defaultAdDays: 0 })
    await setDoc(doc(db, 'units/u1'), { ...unit('alice'), createdAt: Timestamp.now() })
    await setDoc(doc(db, 'contacts/u1'), { ownerId: 'alice', phone: '01012345678', whatsapp: '' })
  })
})

const as = (uid: string) => env.authenticatedContext(uid).firestore()

describe('units', () => {
  it('are publicly readable', async () => { await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'units/u1'))) })
  it('owner can create unit + contacts in one batch', async () => {
    const db = as('bob'); const b = writeBatch(db)
    b.set(doc(db, 'units/u2'), { ...unit('bob'), createdAt: serverTimestamp() })
    b.set(doc(db, 'contacts/u2'), { ownerId: 'bob', phone: '01012345678', whatsapp: '' })
    await assertSucceeds(b.commit())
  })
  it('banned users cannot create', async () => { await assertFails(setDoc(doc(as('banned'), 'units/u3'), { ...unit('banned'), createdAt: serverTimestamp() })) })
  it('cannot create for someone else or auto-publish as hidden-by-admin', async () => {
    await assertFails(setDoc(doc(as('bob'), 'units/u4'), { ...unit('alice'), createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(as('bob'), 'units/u5'), { ...unit('bob', { hiddenByAdmin: true }), createdAt: serverTimestamp() }))
  })
  it('enforces the admin-configured image limits', async () => {
    await assertFails(setDoc(doc(as('bob'), 'units/u6'), { ...unit('bob', { images: [] }), createdAt: serverTimestamp() }))
    await assertFails(setDoc(doc(as('bob'), 'units/u7'), { ...unit('bob', { images: ['a', 'b', 'c', 'd'] }), createdAt: serverTimestamp() }))
  })
  it('only the owner (or admin) can update; owner cannot touch protected fields', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'units/u1'), { price: 1 }))
    await assertSucceeds(updateDoc(doc(as('alice'), 'units/u1'), { price: 3500 }))
    await assertFails(updateDoc(doc(as('alice'), 'units/u1'), { ownerVerified: true }))
    await assertFails(updateDoc(doc(as('alice'), 'units/u1'), { expiresAt: Timestamp.fromDate(new Date('2099-01-01')) }))
    await assertSucceeds(updateDoc(doc(as('admin'), 'units/u1'), { status: 'removed', hiddenByAdmin: true }))
  })
  it('owner cannot re-activate an ad the admin hid', async () => {
    await env.withSecurityRulesDisabled(async (c) => { await updateDoc(doc(c.firestore(), 'units/u1'), { status: 'hidden', hiddenByAdmin: true }) })
    await assertFails(updateDoc(doc(as('alice'), 'units/u1'), { status: 'active' }))
  })
  it('banned owner cannot delete; owner can', async () => {
    await assertSucceeds(deleteDoc(doc(as('alice'), 'units/u1')))
  })
})

describe('contacts', () => {
  it('are not readable by other users or visitors', async () => {
    await assertFails(getDoc(doc(as('bob'), 'contacts/u1')))
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'contacts/u1')))
  })
  it('are readable by the owner and the admin', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'contacts/u1')))
    await assertSucceeds(getDoc(doc(as('admin'), 'contacts/u1')))
  })
})

describe('users', () => {
  it('cannot escalate role, unban or self-verify', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'users/bob'), { role: 'admin' }))
    await assertFails(updateDoc(doc(as('banned'), 'users/banned'), { banned: false }))
    await assertFails(updateDoc(doc(as('bob'), 'users/bob'), { verified: true }))
    await assertSucceeds(updateDoc(doc(as('bob'), 'users/bob'), { displayName: 'New' }))
  })
  it('cannot sign up as admin', async () => {
    await assertFails(setDoc(doc(as('carol'), 'users/carol'), profile({ role: 'admin', createdAt: serverTimestamp() })))
    await assertSucceeds(setDoc(doc(as('carol'), 'users/carol'), profile({ createdAt: serverTimestamp() })))
  })
  it('admin can ban and verify', async () => { await assertSucceeds(updateDoc(doc(as('admin'), 'users/bob'), { banned: true, verified: true })) })
})

describe('server-only and admin-only collections', () => {
  it('clients cannot write reveal counters or stats', async () => {
    await assertFails(setDoc(doc(as('alice'), 'revealCounts/alice_2026-11-06'), { count: 0 }))
    await assertFails(setDoc(doc(as('alice'), 'unitStats/u1'), { views: 999, ownerId: 'alice' }))
  })
  it('settings: public read, admin write', async () => {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'settings/app')))
    await assertFails(setDoc(doc(as('alice'), 'settings/app'), { minImages: 0 }))
    await assertSucceeds(setDoc(doc(as('admin'), 'settings/app'), { minImages: 1, maxImages: 5, defaultAdDays: 30 }))
  })
  it('reports: one per user per ad, banned cannot report, only admin reads', async () => {
    const r = { unitId: 'u1', unitTitle: 't', reporterId: 'bob', reason: 'scam', note: '', status: 'new', createdAt: serverTimestamp() }
    await assertSucceeds(setDoc(doc(as('bob'), 'reports/bob_u1'), r))
    await assertFails(setDoc(doc(as('bob'), 'reports/other_u1'), r))
    await assertFails(setDoc(doc(as('banned'), 'reports/banned_u1'), { ...r, reporterId: 'banned' }))
    await assertFails(getDoc(doc(as('bob'), 'reports/bob_u1')))
  })
  it('audit log is append-only for admins', async () => {
    const entry = { adminId: 'admin', action: 'x', targetType: 'unit', targetId: 'u1', createdAt: serverTimestamp() }
    await assertFails(setDoc(doc(as('alice'), 'auditLogs/a1'), { ...entry, adminId: 'alice' }))
    await assertSucceeds(setDoc(doc(as('admin'), 'auditLogs/a1'), entry))
    await assertFails(updateDoc(doc(as('admin'), 'auditLogs/a1'), { action: 'y' }))
    await assertFails(deleteDoc(doc(as('admin'), 'auditLogs/a1')))
  })
})
