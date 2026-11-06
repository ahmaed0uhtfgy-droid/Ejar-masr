const nf = new Intl.NumberFormat('ar-EG')
export const fmtNum = (n: number): string => nf.format(n)

export function fmtPrice(price: number, rentType: 'monthly' | 'daily'): string {
  return `${nf.format(price)} جنيه / ${rentType === 'monthly' ? 'شهر' : 'يوم'}`
}

export function fmtDate(d: Date | null): string {
  if (!d) return ''
  return new Intl.DateTimeFormat('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }).format(d)
}

export function isExpired(expiresAt: Date | null, now: Date = new Date()): boolean {
  return !!expiresAt && expiresAt.getTime() <= now.getTime()
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86400000)
}

/** Egyptian mobile/landline normaliser for wa.me links (country code 20). */
export function toWhatsAppNumber(raw: string): string {
  let n = raw.replace(/[^\d+]/g, '')
  if (n.startsWith('+')) n = n.slice(1)
  if (n.startsWith('00')) n = n.slice(2)
  if (n.startsWith('0')) n = '20' + n.slice(1)
  return n
}

export const PHONE_RE = /^[0-9+ ]{8,20}$/
