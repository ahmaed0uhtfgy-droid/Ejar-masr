/**
 * Shared helpers for the API integration tests (functions/_tests/*.test.ts).
 *
 * Every test gets: a brand-new in-memory database (FakeFirestore), a fixed clock, and a fully configured Env.
 * Nothing here can reach the real Firebase / Paymob / Resend: global fetch is replaced for the duration of each test.
 */
import { afterEach, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { Env } from '../_lib/env'
import { FakeFirestore } from './fakeFirestore'

/** Fixed "now": 12:00 in Cairo (UTC+2 on this date), so Cairo day = UTC day and nothing can roll over mid-test. */
export const NOW = '2027-03-10T10:00:00.000Z'
export const TODAY = '2027-03-10'
export const HMAC_SECRET = 'test-hmac-secret'
export const CRON_SECRET = 'test-cron-secret-0123456789'

export const OWNER = 'ownerUid0001'
export const TENANT = 'tenantUid001'
export const OTHER = 'otherUid0001'
export const ADMIN = 'adminUid0001'
export const UNIT = 'unitAAAAAA0001'
export const LEASE = 'leaseAAAAAAAAAA000001'

export type Handler = PagesFunction<Env>

export function makeEnv(over: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('<html lang="ar" dir="rtl"><head><title>x</title><meta name="description" content="x" /></head><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } }) } as unknown as Fetcher,
    FIREBASE_PROJECT_ID: 'test-project',
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'test-project', client_email: 'sa@test-project.iam.gserviceaccount.com', private_key: 'unused-in-tests' }),
    CLOUDINARY_CLOUD_NAME: 'democloud', CLOUDINARY_API_KEY: 'cloud-key-123', CLOUDINARY_API_SECRET: 'cloud-secret-abc',
    SITE_URL: 'https://site.test',
    PAYMOB_SECRET_KEY: 'sk_test_secret', PAYMOB_PUBLIC_KEY: 'pk_test_public', PAYMOB_INTEGRATION_IDS: '4000001, 4000002', PAYMOB_HMAC_SECRET: HMAC_SECRET,
    CRON_SECRET, RESEND_API_KEY: 're_test_key', EMAIL_FROM: 'Test <noreply@site.test>',
    ...over,
  }
}

export interface World { db: FakeFirestore; env: Env }

/** Registers beforeEach/afterEach that give every test an isolated world. Call once at the top of a test file. */
export function useWorld(): World {
  const w = { db: new FakeFirestore(), env: makeEnv() } as World
  let restore = (): void => {}
  let clock = new Date(NOW).getTime()
  let first = true
  beforeEach(() => {
    // The clock only ever moves FORWARD, 150 s per test: the modules cache settings for 30-60 s, and this makes those caches expire between
    // tests (even after a test that jumped the clock ahead) without leaving the same Cairo day (a file has far fewer than 100 tests).
    vi.useFakeTimers({ toFake: ['Date'] })
    clock = first ? clock : clock + 150_000
    first = false
    vi.setSystemTime(new Date(clock))
    w.db = new FakeFirestore()
    w.env = makeEnv()
    restore = w.db.install()
  })
  afterEach(() => { clock = Math.max(clock, Date.now()); restore(); vi.useRealTimers() })
  return w
}

export interface CallOpts { method?: string; path?: string; token?: string; body?: unknown; rawBody?: string; headers?: Record<string, string>; query?: string; params?: Record<string, string | string[]> }

/** Invokes a Pages Function exactly as the platform would (a real Request in, a real Response out). */
export async function call(handler: Handler, env: Env, o: CallOpts = {}): Promise<{ res: Response; status: number; json: Record<string, unknown>; text: string }> {
  const headers: Record<string, string> = { ...(o.headers ?? {}) }
  if (o.token) headers.Authorization = `Bearer ${o.token}`
  const hasBody = o.body !== undefined || o.rawBody !== undefined
  if (hasBody) headers['Content-Type'] ??= 'application/json'
  const request = new Request(`https://site.test${o.path ?? '/api/x'}${o.query ?? ''}`, {
    method: o.method ?? 'POST', headers, body: hasBody ? (o.rawBody ?? JSON.stringify(o.body)) : undefined,
  })
  const res = await handler({ request, env, params: o.params ?? {} } as unknown as Parameters<Handler>[0])
  const text = await res.clone().text()
  let json: Record<string, unknown> = {}
  try { json = JSON.parse(text) as Record<string, unknown> } catch { /* not JSON */ }
  return { res, status: res.status, json, text }
}

export const as = (uid: string): string => `uid:${uid}`

// ---------- seeders ----------
export function seedUser(db: FakeFirestore, uid: string, over: Record<string, unknown> = {}): void {
  db.seed(`users/${uid}`, { displayName: `User ${uid}`, email: `${uid}@example.com`, role: 'user', accountType: 'owner', banned: false, verified: false, createdAt: new Date(new Date(NOW).getTime() - 30 * 86400_000), ...over })
}

export function seedUnit(db: FakeFirestore, over: Record<string, unknown> = {}): void {
  const id = String(over.id ?? UNIT)
  db.seed(`units/${id}`, {
    title: 'شقة للإيجار بالمعادي', rentType: 'monthly', price: 5000, deposit: 10000, depositMode: 'held-claim', status: 'active', ownerId: OWNER, ownerName: 'مالك',
    expiresAt: null, hiddenByAdmin: false, ...over, id: undefined,
  })
}

export function seedLease(db: FakeFirestore, over: Record<string, unknown> = {}): string {
  const id = String(over.id ?? LEASE)
  db.seed(`leases/${id}`, {
    unitId: UNIT, unitTitle: 'شقة للإيجار بالمعادي', ownerId: OWNER, ownerName: 'مالك', tenantId: TENANT, tenantName: 'مستأجر', tenantPhone: '01012345678', note: '',
    rentType: 'monthly', price: 5000, startDate: '2027-03-20', endDate: '2027-09-20', durationMonths: 6, cycleMonths: 3, days: null, total: 30000, installments: 2,
    feePercent: 0, feePayer: 'owner', cancelFeePercent: 0, depositMode: 'none', depositCents: 0, depositStatus: 'none', status: 'requested', createdAt: new Date(NOW), updatedAt: new Date(NOW),
    ...over, id: undefined,
  })
  return id
}

export function seedPayment(db: FakeFirestore, index: number, over: Record<string, unknown> = {}): string {
  const leaseId = String(over.leaseId ?? LEASE)
  const id = `${leaseId}_${index}`
  db.seed(`payments/${id}`, {
    leaseId, index, unitId: UNIT, ownerId: OWNER, tenantId: TENANT, amount: 15000, amountCents: 1500000, depositCents: 0, feeCents: 0, tenantFeeCents: 0, netCents: 1500000,
    from: '2027-03-20', to: '2027-06-20', dueDate: '2027-03-20', status: 'due', payoutStatus: 'none', createdAt: new Date(NOW), ...over,
  })
  return id
}

// ---------- Paymob callbacks ----------
/** The field order Paymob documents for the "Transaction processed" HMAC. Kept here independently of production code on purpose. */
export const PAYMOB_DOCUMENTED_ORDER = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure', 'is_auth', 'is_capture',
  'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
] as const

type Obj = Record<string, unknown>
const dig = (o: Obj, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Obj)[k] : undefined), o)

/** Builds a Paymob "Transaction processed" callback for a payment and signs it the way Paymob does (independent HMAC-SHA512 via node:crypto). */
export function paymobCallback(paymentId: string, over: Obj = {}, opts: { orderId?: number; secret?: string } = {}): { body: { type: string; obj: Obj }; hmac: string; obj: Obj } {
  const obj: Obj = {
    id: 987654, pending: false, amount_cents: 1500000, success: true, is_auth: false, is_capture: false, is_standalone_payment: true, is_voided: false, is_refunded: false,
    is_3d_secure: true, integration_id: 4000001, has_parent_transaction: false, created_at: '2027-03-10T10:00:00.000000', currency: 'EGP', error_occured: false, owner: 3333,
    order: { id: opts.orderId ?? 55001, merchant_order_id: `${paymentId}-abc123` }, source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' },
    payment_key_claims: { extra: { paymentId } }, ...over,
  }
  const text = PAYMOB_DOCUMENTED_ORDER.map((f) => { const v = dig(obj, f); return v === undefined || v === null ? '' : String(v) }).join('')
  const hmac = createHmac('sha512', opts.secret ?? HMAC_SECRET).update(text).digest('hex')
  return { body: { type: 'TRANSACTION', obj }, hmac, obj }
}

/** Deep-ish clone so a test can mutate an attacker's copy of a signed payload. */
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
