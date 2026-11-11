import type { Env } from './env'
import { HttpError } from './http'

const BASE = 'https://accept.paymob.com'

export const paymobConfigured = (env: Env): boolean =>
  Boolean(env.PAYMOB_SECRET_KEY && env.PAYMOB_PUBLIC_KEY && env.PAYMOB_INTEGRATION_IDS && env.PAYMOB_HMAC_SECRET)

export interface IntentionInput {
  amountCents: number; title: string; reference: string; paymentId: string
  name: string; email: string; phone: string; notificationUrl: string; redirectionUrl: string
}

/** Creates a Paymob payment intention (Unified Checkout) and returns the hosted checkout URL + Paymob's order id. */
export async function createIntention(env: Env, i: IntentionInput): Promise<{ url: string; orderId: string }> {
  const ids = (env.PAYMOB_INTEGRATION_IDS ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0)
  const [first, ...rest] = (i.name || 'Tenant').trim().split(/\s+/)
  const res = await fetch(`${BASE}/v1/intention/`, {
    method: 'POST',
    headers: { Authorization: `Token ${env.PAYMOB_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: i.amountCents, currency: 'EGP', payment_methods: ids,
      items: [{ name: i.title.slice(0, 50), amount: i.amountCents, description: i.title.slice(0, 100), quantity: 1 }],
      billing_data: {
        first_name: first || 'Tenant', last_name: rest.join(' ') || 'NA', email: i.email || 'na@example.com', phone_number: i.phone,
        apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', city: 'NA', state: 'NA', country: 'EG',
      },
      special_reference: i.reference, extras: { paymentId: i.paymentId },
      notification_url: i.notificationUrl, redirection_url: i.redirectionUrl,
    }),
  })
  if (!res.ok) {
    console.error('paymob intention failed', res.status, await res.text().catch(() => ''))
    throw new HttpError(502, 'gateway', 'بوابة الدفع مش متاحة دلوقتي، حاول بعد شوية')
  }
  const d = (await res.json()) as { client_secret?: string; id?: string; intention_order_id?: number | string }
  if (!d.client_secret) throw new HttpError(502, 'gateway', 'بوابة الدفع رجّعت رد غير متوقع')
  const url = `${BASE}/unifiedcheckout/?publicKey=${encodeURIComponent(env.PAYMOB_PUBLIC_KEY ?? '')}&clientSecret=${encodeURIComponent(d.client_secret)}`
  return { url, orderId: String(d.intention_order_id ?? '') }
}

type Obj = Record<string, unknown>
const at = (o: Obj, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Obj)[k] : undefined), o)
const str = (v: unknown): string => (v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))

export const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure', 'is_auth',
  'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type',
  'source_data.type', 'success',
] as const

export async function hmacSha512Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Verifies a "Transaction processed" callback (obj = body.obj) against the ?hmac= query value. */
export async function verifyCallbackHmac(obj: Obj, hmac: string, secret: string): Promise<boolean> {
  if (!hmac || !secret) return false
  const expected = await hmacSha512Hex(HMAC_FIELDS.map((f) => str(at(obj, f))).join(''), secret)
  return timingSafeEqual(expected, hmac.toLowerCase())
}
