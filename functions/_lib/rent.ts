/** Pure rent-schedule helpers. Shared by Pages Functions and the browser (no runtime deps). Dates are Cairo calendar days as 'YYYY-MM-DD'. */

export type RentType = 'monthly' | 'daily'
export const CYCLES = [1, 3, 6, 12] as const
export const MAX_MONTHS = 24
export const MAX_DAYS = 90
export const MAX_START_AHEAD_DAYS = 180

export interface Terms { rentType: RentType; price: number; startDate: string; durationMonths?: number; days?: number; cycleMonths?: number }
export interface ScheduleItem { index: number; from: string; to: string; dueDate: string; amount: number }
export interface Limits { maxMonths: number; cycles: number[] }
export const DEFAULT_LIMITS: Limits = { maxMonths: MAX_MONTHS, cycles: [...CYCLES] }
export type TermsResult = { ok: true; endDate: string; total: number; schedule: ScheduleItem[] } | { ok: false; message: string }

export function parseYmd(s: unknown): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const y = Number(s.slice(0, 4)), m = Number(s.slice(5, 7)), d = Number(s.slice(8, 10))
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? { y, m, d } : null
}
const fmt = (t: Date) => t.toISOString().slice(0, 10)

export function addDaysYmd(s: string, days: number): string {
  const p = parseYmd(s)!
  return fmt(new Date(Date.UTC(p.y, p.m - 1, p.d + days)))
}

/** Adds calendar months and clamps the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsYmd(s: string, months: number): string {
  const p = parseYmd(s)!
  const total = p.y * 12 + (p.m - 1) + months
  const y = Math.floor(total / 12), m = total % 12
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return fmt(new Date(Date.UTC(y, m, Math.min(p.d, last))))
}

export const toCents = (egp: number): number => Math.round(egp * 100)
/** Platform fee in cents, rounded; pct is clamped to 0..30. */
export function feeCents(amountCents: number, pct: number): number {
  const p = Number.isFinite(pct) ? Math.min(30, Math.max(0, pct)) : 0
  return Math.round((amountCents * p) / 100)
}

export function buildTerms(t: Terms, today: string, limits: Limits = DEFAULT_LIMITS): TermsResult {
  if (!parseYmd(t.startDate)) return { ok: false, message: 'تاريخ البداية غير صحيح' }
  if (t.startDate < today) return { ok: false, message: 'تاريخ البداية لازم يكون النهارده أو بعده' }
  if (t.startDate > addDaysYmd(today, MAX_START_AHEAD_DAYS)) return { ok: false, message: 'تاريخ البداية بعيد قوي' }
  if (!(t.price > 0)) return { ok: false, message: 'سعر الوحدة غير صحيح' }

  if (t.rentType === 'daily') {
    const n = t.days
    if (!Number.isInteger(n) || n! < 1 || n! > MAX_DAYS) return { ok: false, message: `عدد الأيام لازم يكون من ١ لـ ${MAX_DAYS}` }
    const end = addDaysYmd(t.startDate, n!)
    const amount = Math.round(t.price * n! * 100) / 100
    return { ok: true, endDate: end, total: amount, schedule: [{ index: 0, from: t.startDate, to: end, dueDate: t.startDate, amount }] }
  }

  const months = t.durationMonths, cycle = t.cycleMonths
  if (!Number.isInteger(months) || months! < 1 || months! > limits.maxMonths) return { ok: false, message: `مدة العقد لازم تكون من ١ لـ ${limits.maxMonths} شهر` }
  if (!limits.cycles.includes(cycle as number)) return { ok: false, message: 'دورة الدفع غير صحيحة' }
  if (months! % cycle! !== 0) return { ok: false, message: 'مدة العقد لازم تقبل القسمة على دورة الدفع' }
  const schedule: ScheduleItem[] = []
  for (let i = 0; i < months! / cycle!; i++) {
    const from = addMonthsYmd(t.startDate, i * cycle!)
    schedule.push({ index: i, from, to: addMonthsYmd(t.startDate, (i + 1) * cycle!), dueDate: from, amount: Math.round(t.price * cycle! * 100) / 100 })
  }
  return { ok: true, endDate: addMonthsYmd(t.startDate, months!), total: schedule.reduce((s, x) => s + x.amount, 0), schedule }
}

/** Valid payment cycles for a contract length (e.g. 6 months -> 1, 3, 6). */
export const validCycles = (months: number, allowed: readonly number[] = CYCLES): number[] => allowed.filter((c) => months % c === 0)

/** Whole days from a to b (b - a), both 'YYYY-MM-DD'. */
export function daysBetween(a: string, b: string): number {
  const pa = parseYmd(a)!, pb = parseYmd(b)!
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000)
}
