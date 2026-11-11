import { useEffect, useState } from 'react'
import { Timestamp, collection, doc, getDoc, getDocs, query, where, type DocumentData } from 'firebase/firestore'
import { db } from './firebase'
import type { Lease, Payment } from './types'

const d = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const n = (v: unknown): number | null => (typeof v === 'number' ? v : null)

export function mapLease(id: string, x: DocumentData): Lease {
  return {
    id, unitId: x.unitId ?? '', unitTitle: x.unitTitle ?? '',
    ownerId: x.ownerId ?? '', ownerName: x.ownerName ?? '', tenantId: x.tenantId ?? '', tenantName: x.tenantName ?? '', tenantPhone: x.tenantPhone ?? '', note: x.note ?? '',
    rentType: x.rentType === 'daily' ? 'daily' : 'monthly', price: Number(x.price ?? 0), startDate: x.startDate ?? '', endDate: x.endDate ?? '',
    durationMonths: n(x.durationMonths), cycleMonths: n(x.cycleMonths), days: n(x.days),
    total: Number(x.total ?? 0), installments: Number(x.installments ?? 1), status: x.status ?? 'requested', createdAt: d(x.createdAt),
    reminderDays: n(x.reminderDays), firstPaidAt: d(x.firstPaidAt), moveInConfirmedAt: d(x.moveInConfirmedAt), moveInIssue: x.moveInIssue === true, endedAt: d(x.endedAt),
    depositMode: x.depositMode === 'held-claim' || x.depositMode === 'held-auto' ? x.depositMode : 'none', depositCents: Number(x.depositCents ?? 0), depositStatus: x.depositStatus ?? 'none',
    depositClaimUntil: x.depositClaimUntil ?? '', claimCents: Number(x.claimCents ?? 0), claimReason: x.claimReason ?? '',
    depositToOwnerCents: Number(x.depositToOwnerCents ?? 0), depositToTenantCents: Number(x.depositToTenantCents ?? 0), depositTransfer: x.depositTransfer ?? '', depositRef: x.depositRef ?? '',
  }
}

export function mapPayment(id: string, x: DocumentData): Payment {
  return {
    id, leaseId: x.leaseId ?? '', index: Number(x.index ?? 0), unitId: x.unitId ?? '', ownerId: x.ownerId ?? '', tenantId: x.tenantId ?? '',
    amount: Number(x.amount ?? 0), depositCents: Number(x.depositCents ?? 0), feeCents: Number(x.feeCents ?? 0), netCents: Number(x.netCents ?? 0),
    from: x.from ?? '', to: x.to ?? '', dueDate: x.dueDate ?? '', status: x.status ?? 'due', payoutStatus: x.payoutStatus ?? 'none',
    paidAt: d(x.paidAt), payoutAt: d(x.payoutAt), payoutRef: x.payoutRef ?? '',
  }
}

const byNewest = (a: Lease, b: Lease) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
const byIndex = (a: Payment, b: Payment) => a.index - b.index

export interface RentalsData { leases: Lease[]; payments: Record<string, Payment[]> }

/** role decides which equality filter is used; the security rules only allow queries filtered by your own uid. */
export async function loadRentals(uid: string, role: 'tenantId' | 'ownerId'): Promise<RentalsData> {
  const [ls, ps] = await Promise.all([
    getDocs(query(collection(db, 'leases'), where(role, '==', uid))),
    getDocs(query(collection(db, 'payments'), where(role, '==', uid))),
  ])
  const payments: Record<string, Payment[]> = {}
  for (const p of ps.docs.map((x) => mapPayment(x.id, x.data()))) (payments[p.leaseId] ??= []).push(p)
  for (const k of Object.keys(payments)) payments[k].sort(byIndex)
  return { leases: ls.docs.map((x) => mapLease(x.id, x.data())).sort(byNewest), payments }
}

/** 'YYYY-MM-DD' -> localized date without timezone shifts. */
export function fmtYmd(s: string): string {
  const [y, m, day] = s.split('-').map(Number)
  if (!y || !m || !day) return s
  return new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(y, m - 1, day))
}
export const todayYmd = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export interface PayPublicSettings { paymentsEnabled: boolean; platformFeePercent: number; maxLeaseMonths: number; cycles: number[]; defaultReminderDays: number; depositClaimDays: number }
export const PAY_PUBLIC_DEFAULTS: PayPublicSettings = { paymentsEnabled: true, platformFeePercent: 0, maxLeaseMonths: 24, cycles: [1, 3, 6, 12], defaultReminderDays: 3, depositClaimDays: 3 }

/** Public payment settings (settings/payments, readable by everyone). 1 read, cached for the session. */
let paySettingsPromise: Promise<PayPublicSettings> | null = null
export function loadPaySettings(): Promise<PayPublicSettings> {
  paySettingsPromise ??= getDoc(doc(db, 'settings', 'payments')).then((s) => {
    const x = s.data() ?? {}
    const cyc = Array.isArray(x.cycles) ? (x.cycles as unknown[]).map(Number).filter((c) => [1, 3, 6, 12].includes(c)) : []
    return {
      paymentsEnabled: x.paymentsEnabled !== false, platformFeePercent: Number(x.platformFeePercent ?? 0),
      maxLeaseMonths: Math.min(60, Math.max(1, Number(x.maxLeaseMonths ?? 24))), cycles: cyc.length ? cyc : PAY_PUBLIC_DEFAULTS.cycles,
      defaultReminderDays: Number(x.defaultReminderDays ?? 3), depositClaimDays: Number(x.depositClaimDays ?? 3),
    }
  }).catch(() => PAY_PUBLIC_DEFAULTS)
  return paySettingsPromise
}
export function resetPaySettings(): void { paySettingsPromise = null }
export function usePaySettings(): PayPublicSettings {
  const [s, setS] = useState(PAY_PUBLIC_DEFAULTS)
  useEffect(() => { let alive = true; void loadPaySettings().then((v) => alive && setS(v)); return () => { alive = false } }, [])
  return s
}
