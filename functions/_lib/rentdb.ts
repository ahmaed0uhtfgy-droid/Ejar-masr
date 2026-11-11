import type { Env } from './env'
import { getDocument, type Write } from './firestore'
import type { Limits } from './rent'

export function newId(len = 20): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return [...crypto.getRandomValues(new Uint8Array(len))].map((b) => chars[b % chars.length]).join('')
}

/** Idempotent in-app notification (deterministic id, upsert), written with the service account. */
export function notifyWrite(uid: string, key: string, title: string, body: string, unitId: string | null): Write {
  return { kind: 'upsert', path: `users/${uid}/notifications/${key}`, data: { type: 'system', title, body, unitId, read: false, createdAt: new Date() } }
}

/** Admin-controlled settings, stored in settings/payments (separate from settings/app, which the admin settings tab overwrites). */
export interface PaySettings {
  paymentsEnabled: boolean
  platformFeePercent: number
  depositClaimDays: number // owner can claim the deposit for this many days after the lease ends
  maxLeaseMonths: number
  cycles: number[]
  defaultReminderDays: number
  maxOpenRequests: number
  moveInReminderDays: number // how long to keep asking the tenant "did you receive the unit?"
}
export const PAY_DEFAULTS: PaySettings = {
  paymentsEnabled: true, platformFeePercent: 0, depositClaimDays: 3, maxLeaseMonths: 24, cycles: [1, 3, 6, 12],
  defaultReminderDays: 3, maxOpenRequests: 5, moveInReminderDays: 14,
}
const clamp = (v: unknown, min: number, max: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d }

export function normalizePaySettings(d: Record<string, unknown> | undefined): PaySettings {
  const cyc = Array.isArray(d?.cycles) ? (d!.cycles as unknown[]).map(Number).filter((c) => [1, 3, 6, 12].includes(c)) : []
  return {
    paymentsEnabled: d?.paymentsEnabled !== false,
    platformFeePercent: clamp(d?.platformFeePercent, 0, 30, PAY_DEFAULTS.platformFeePercent),
    depositClaimDays: Math.round(clamp(d?.depositClaimDays, 0, 30, PAY_DEFAULTS.depositClaimDays)),
    maxLeaseMonths: Math.round(clamp(d?.maxLeaseMonths, 1, 60, PAY_DEFAULTS.maxLeaseMonths)),
    cycles: cyc.length ? cyc : PAY_DEFAULTS.cycles,
    defaultReminderDays: Math.round(clamp(d?.defaultReminderDays, 1, 30, PAY_DEFAULTS.defaultReminderDays)),
    maxOpenRequests: Math.round(clamp(d?.maxOpenRequests, 1, 20, PAY_DEFAULTS.maxOpenRequests)),
    moveInReminderDays: Math.round(clamp(d?.moveInReminderDays, 1, 60, PAY_DEFAULTS.moveInReminderDays)),
  }
}

let cache: { at: number; s: PaySettings } | null = null
export async function paySettings(env: Env): Promise<PaySettings> {
  if (cache && Date.now() - cache.at < 30_000) return cache.s
  const d = await getDocument(env, 'settings/payments')
  const s = normalizePaySettings(d?.data)
  cache = { at: Date.now(), s }
  return s
}
export const limitsOf = (s: PaySettings): Limits => ({ maxMonths: s.maxLeaseMonths, cycles: s.cycles })

export const PHONE_RE = /^[0-9+ ]{8,20}$/
export type DepositMode = 'none' | 'held-claim' | 'held-auto'
export const depositModeOf = (v: unknown): DepositMode => (v === 'held-claim' || v === 'held-auto' ? v : 'none')
