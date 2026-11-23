// Run with: npm run test:rules  (needs Java + the Firestore emulator via firebase-tools).
// Covers the money-related collections: leases, payments, payout details, counters, favorites, notifications.
import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment
const profile = (over: Record<string, unknown> = {}) => ({ displayName: 'Test', email: 't@example.com', role: 'user', accountType: 'owner', banned: false, verified: false, createdAt: Timestamp.now(), ...over })
const lease = { unitId: 'u1', ownerId: 'owner', tenantId: 'tenant', status: 'active', price: 5000, total: 30000 }
const payment = (over: Record<string, unknown> = {}) => ({ leaseId: 'l1', ownerId: 'owner', tenantId: 'tenant', status: 'paid', amountCents: 1500000, netCents: 1500000, payoutStatus: 'pending', ...over })

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'ejar-masr-test', firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 } })
})
afterAll(async () => { await env.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    for (const u of ['owner', 'tenant', 'stranger']) await setDoc(doc(db, `users/${u}`), profile())
    await setDoc(doc(db, 'users/banned'), profile({ banned: true }))
    await setDoc(doc(db, 'users/admin'), profile({ role: 'admin' }))
    await setDoc(doc(db, 'leases/l1'), lease)
    await setDoc(doc(db, 'payments/p_held'), payment({ payoutStatus: 'held' }))
    await setDoc(doc(db, 'payments/p_pending'), payment())
    await setDoc(doc(db, 'payments/p_paid'), payment({ payoutStatus: 'paid' }))
    await setDoc(doc(db, 'unitStats/u1'), { ownerId: 'owner', views: 3, reveals: 1 })
    await setDoc(doc(db, 'revealLogs/x'), { uid: 'tenant', unitId: 'u1' })
    await setDoc(doc(db, 'users/tenant/payout/main'), { method: 'wallet', holder: 'Test User', account: '01012345678' })
    await setDoc(doc(db, 'users/tenant/notifications/n1'), { type: 'lease', read: false, text: 'x' })
  })
})
const as = (uid: string) => env.authenticatedContext(uid).firestore()
const anon = () => env.unauthenticatedContext().firestore()

describe('leases', () => {
  it('are readable by the tenant, the owner and an admin only', async () => {
    for (const uid of ['tenant', 'owner', 'admin']) await assertSucceeds(getDoc(doc(as(uid), 'leases/l1')))
    await assertFails(getDoc(doc(as('stranger'), 'leases/l1')))
    await assertFails(getDoc(doc(anon(), 'leases/l1')))
  })
  it('can NOT be listed in bulk by a user (queries must be scoped to their own id)', async () => {
    await assertFails(getDocs(collection(as('stranger'), 'leases')))
  })
  it('can never be written from the browser, by anyone, admins included', async () => {
    for (const uid of ['tenant', 'owner', 'admin', 'stranger']) {
      await assertFails(setDoc(doc(as(uid), 'leases/new'), lease))
      await assertFails(updateDoc(doc(as(uid), 'leases/l1'), { status: 'ended' }))
      await assertFails(deleteDoc(doc(as(uid), 'leases/l1')))
    }
  })
})

describe('payments', () => {
  it('are readable by the tenant, the owner and an admin only', async () => {
    for (const uid of ['tenant', 'owner', 'admin']) await assertSucceeds(getDoc(doc(as(uid), 'payments/p_paid')))
    await assertFails(getDoc(doc(as('stranger'), 'payments/p_paid')))
    await assertFails(getDoc(doc(anon(), 'payments/p_paid')))
  })
  it('a tenant or owner can not mark a payment paid, change an amount, or release escrow', async () => {
    for (const uid of ['tenant', 'owner']) {
      await assertFails(updateDoc(doc(as(uid), 'payments/p_held'), { status: 'paid' }))
      await assertFails(updateDoc(doc(as(uid), 'payments/p_held'), { amountCents: 1 }))
      await assertFails(updateDoc(doc(as(uid), 'payments/p_held'), { payoutStatus: 'pending' }))
      await assertFails(updateDoc(doc(as(uid), 'payments/p_pending'), { payoutStatus: 'paid' }))
      await assertFails(deleteDoc(doc(as(uid), 'payments/p_held')))
    }
  })
  it('nobody can create a payment from the browser', async () => {
    for (const uid of ['tenant', 'owner', 'admin']) await assertFails(setDoc(doc(as(uid), 'payments/forged'), payment({ status: 'paid' })))
  })
  it('the admin can record a transfer of RELEASED money (pending -> paid) and nothing else', async () => {
    await assertSucceeds(updateDoc(doc(as('admin'), 'payments/p_pending'), { payoutStatus: 'paid', payoutAt: Timestamp.now(), payoutRef: 'INSTAPAY-1' }))
  })
  it('the admin can NOT pay out money that is still held in escrow (only the tenant releases it)', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'payments/p_held'), { payoutStatus: 'paid' }))
  })
  it('the admin can not change amounts or status, undo a payout, or delete a payment', async () => {
    await assertFails(updateDoc(doc(as('admin'), 'payments/p_pending'), { payoutStatus: 'paid', amountCents: 5 }))
    await assertFails(updateDoc(doc(as('admin'), 'payments/p_pending'), { status: 'refunded' }))
    await assertFails(updateDoc(doc(as('admin'), 'payments/p_paid'), { payoutStatus: 'pending' }))
    await assertFails(deleteDoc(doc(as('admin'), 'payments/p_paid')))
  })
})

describe('server-only counters and logs', () => {
  it('reveal logs are admin-read and never client-written', async () => {
    await assertSucceeds(getDoc(doc(as('admin'), 'revealLogs/x')))
    await assertFails(getDoc(doc(as('tenant'), 'revealLogs/x')))
    await assertFails(setDoc(doc(as('admin'), 'revealLogs/y'), { uid: 'x' }))
    await assertFails(setDoc(doc(as('tenant'), 'revealCounts/tenant_2027-03-10'), { count: 0 }))
  })
  it('unit stats: the owner and admin read them; nobody writes them (no faking view counts)', async () => {
    await assertSucceeds(getDoc(doc(as('owner'), 'unitStats/u1')))
    await assertSucceeds(getDoc(doc(as('admin'), 'unitStats/u1')))
    await assertFails(getDoc(doc(as('stranger'), 'unitStats/u1')))
    await assertFails(updateDoc(doc(as('owner'), 'unitStats/u1'), { views: 999999 }))
  })
})

describe('payout details (where the owner receives rent)', () => {
  const ok = { method: 'wallet', holder: 'Test User', account: '01012345678' }
  it('are private to their user and admins', async () => {
    await assertSucceeds(getDoc(doc(as('tenant'), 'users/tenant/payout/main')))
    await assertSucceeds(getDoc(doc(as('admin'), 'users/tenant/payout/main')))
    await assertFails(getDoc(doc(as('stranger'), 'users/tenant/payout/main')))
    await assertFails(getDoc(doc(anon(), 'users/tenant/payout/main')))
  })
  it('can be saved only in the strict shape, only by their user, only as "main"', async () => {
    await assertSucceeds(setDoc(doc(as('owner'), 'users/owner/payout/main'), ok))
    await assertFails(setDoc(doc(as('stranger'), 'users/owner/payout/main'), ok))
    await assertFails(setDoc(doc(as('owner'), 'users/owner/payout/other'), ok))
    await assertFails(setDoc(doc(as('owner'), 'users/owner/payout/main'), { ...ok, extra: 'x' }))
    await assertFails(setDoc(doc(as('owner'), 'users/owner/payout/main'), { ...ok, method: 'paypal' }))
    await assertFails(setDoc(doc(as('owner'), 'users/owner/payout/main'), { ...ok, account: '123' }))
    await assertFails(setDoc(doc(as('banned'), 'users/banned/payout/main'), ok))
  })
})

describe('favorites and notifications', () => {
  it('favorites belong to their user; a banned user cannot add', async () => {
    await assertSucceeds(setDoc(doc(as('tenant'), 'users/tenant/favorites/u1'), { addedAt: Timestamp.now() }))
    await assertFails(setDoc(doc(as('stranger'), 'users/tenant/favorites/u2'), { addedAt: Timestamp.now() }))
    await assertFails(getDoc(doc(as('stranger'), 'users/tenant/favorites/u1')))
    await assertFails(setDoc(doc(as('banned'), 'users/banned/favorites/u1'), { addedAt: Timestamp.now() }))
  })
  it('notifications: read and mark-read by their user only; users can not forge system notices', async () => {
    await assertSucceeds(getDoc(doc(as('tenant'), 'users/tenant/notifications/n1')))
    await assertFails(getDoc(doc(as('stranger'), 'users/tenant/notifications/n1')))
    await assertSucceeds(updateDoc(doc(as('tenant'), 'users/tenant/notifications/n1'), { read: true }))
    await assertFails(updateDoc(doc(as('tenant'), 'users/tenant/notifications/n1'), { text: 'You won!' }))
    await assertFails(setDoc(doc(as('tenant'), 'users/tenant/notifications/n2'), { type: 'payment', text: 'Your rent was refunded', read: false }))
    await assertFails(setDoc(doc(as('stranger'), 'users/tenant/notifications/n3'), { type: 'saved-search', read: false }))
  })
})

describe('audit log and privilege escalation', () => {
  it('audit entries are admin-only, attributed to the admin, and immutable', async () => {
    await assertSucceeds(setDoc(doc(as('admin'), 'auditLogs/a1'), { adminId: 'admin', action: 'user.ban' }))
    await assertFails(setDoc(doc(as('admin'), 'auditLogs/a2'), { adminId: 'someone-else', action: 'x' }))
    await assertFails(setDoc(doc(as('tenant'), 'auditLogs/a3'), { adminId: 'tenant', action: 'x' }))
    await assertFails(updateDoc(doc(as('admin'), 'auditLogs/a1'), { action: 'edited' }))
    await assertFails(deleteDoc(doc(as('admin'), 'auditLogs/a1')))
  })
  it('a user can not make themselves admin, verified or unbanned', async () => {
    await assertFails(updateDoc(doc(as('tenant'), 'users/tenant'), { role: 'admin' }))
    await assertFails(updateDoc(doc(as('tenant'), 'users/tenant'), { verified: true }))
    await assertFails(updateDoc(doc(as('banned'), 'users/banned'), { banned: false }))
  })
  it('an unknown collection is closed to everyone', async () => {
    await assertFails(getDoc(doc(as('admin'), 'secrets/x')))
    await assertFails(setDoc(doc(as('admin'), 'secrets/x'), { a: 1 }))
  })
})

describe('sign-up email must match the sign-in token', () => {
  const create = (uid: string, claims: Record<string, unknown>, email: string) =>
    setDoc(doc(env.authenticatedContext(uid, claims).firestore(), `users/${uid}`), profile({ email, createdAt: serverTimestamp() }))
  it('accepts the real email, in any letter case', async () => {
    await assertSucceeds(create('n1', { email: 'Sara@Example.com' }, 'sara@example.com'))
    await assertSucceeds(create('n2', { email: 'sara@example.com' }, 'SARA@EXAMPLE.COM'))
  })
  it("refuses somebody else's email (the site would send reminders to a stranger)", async () => {
    await assertFails(create('n3', { email: 'me@example.com' }, 'victim@example.com'))
    await assertFails(create('n4', {}, 'victim@example.com'))
  })
})

describe('server-only collections', () => {
  it('checkout sessions (they hold payment secrets) are unreachable from any browser, admins included', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'checkoutSessions/p_1'), { url: 'https://pay/?clientSecret=x', tenantId: 'tenant' }) })
    for (const uid of ['tenant', 'owner', 'admin']) {
      await assertFails(getDoc(doc(as(uid), 'checkoutSessions/p_1')))
      await assertFails(setDoc(doc(as(uid), 'checkoutSessions/p_2'), { url: 'x' }))
    }
    await assertFails(getDoc(doc(anon(), 'checkoutSessions/p_1')))
  })
})
