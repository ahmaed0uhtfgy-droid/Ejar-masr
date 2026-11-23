// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { HMAC_FIELDS, hmacSha512Hex, paymobConfigured, timingSafeEqual, verifyCallbackHmac } from './paymob'
import type { Env } from './env'

const sign = (obj: Record<string, unknown>, secret: string) => {
  const dig = (o: Record<string, unknown>, p: string) => p.split('.').reduce<unknown>((a, k) => (a && typeof a === 'object' ? (a as Record<string, unknown>)[k] : undefined), o)
  return createHmac('sha512', secret).update(HMAC_FIELDS.map((f) => { const v = dig(obj, f); return v === undefined || v === null ? '' : String(v) }).join('')).digest('hex')
}
const obj = { amount_cents: 100, created_at: 'x', currency: 'EGP', error_occured: false, has_parent_transaction: false, id: 1, integration_id: 2, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: 9 }, owner: 3, pending: false, source_data: { pan: '1234', sub_type: 'Visa', type: 'card' }, success: true }

describe('hmacSha512Hex', () => {
  it('matches node:crypto (RFC 4231 test case 2)', async () => {
    expect(await hmacSha512Hex('what do ya want for nothing?', 'Jefe')).toBe('164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737')
  })
})

describe('timingSafeEqual', () => {
  it('compares strings and rejects different lengths', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
    expect(timingSafeEqual('', '')).toBe(true)
  })
})

describe('verifyCallbackHmac', () => {
  it('accepts a correct signature, case-insensitively', async () => {
    const h = sign(obj, 's3cret')
    expect(await verifyCallbackHmac(obj, h, 's3cret')).toBe(true)
    expect(await verifyCallbackHmac(obj, h.toUpperCase(), 's3cret')).toBe(true)
  })
  it('rejects empty or missing hmac / secret (an unset secret must never validate anything)', async () => {
    expect(await verifyCallbackHmac(obj, '', 's3cret')).toBe(false)
    expect(await verifyCallbackHmac(obj, sign(obj, ''), '')).toBe(false)
    expect(await verifyCallbackHmac(obj, 'zz', 's3cret')).toBe(false)
  })
  it.each([['amount_cents', 99999], ['success', false], ['id', 2], ['order', { id: 10 }], ['currency', 'USD'], ['pending', true]])('rejects when %s is changed', async (k, v) => {
    expect(await verifyCallbackHmac({ ...obj, [k]: v }, sign(obj, 's3cret'), 's3cret')).toBe(false)
  })
  it('does not depend on fields Paymob does not sign (documents the limitation the webhook guards against)', async () => {
    expect(await verifyCallbackHmac({ ...obj, merchant_order_id: 'anything' }, sign(obj, 's3cret'), 's3cret')).toBe(true)
  })
})

describe('paymobConfigured', () => {
  const full = { PAYMOB_SECRET_KEY: 'a', PAYMOB_PUBLIC_KEY: 'b', PAYMOB_INTEGRATION_IDS: '1', PAYMOB_HMAC_SECRET: 'c' } as Env
  it('needs all four settings', () => {
    expect(paymobConfigured(full)).toBe(true)
    for (const k of Object.keys(full)) expect(paymobConfigured({ ...full, [k]: '' } as Env)).toBe(false)
  })
})
