/** Pure helpers (unit-tested in logic.test.ts). */

export async function sha1Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cloudinary signature: sorted "k=v" pairs joined by "&", secret appended, SHA-1 hex. */
export async function cloudinarySignature(params: Record<string, string | number>, secret: string): Promise<string> {
  const str = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return sha1Hex(str + secret)
}

/** YYYY-MM-DD in Africa/Cairo, used as the daily quota bucket. */
export function cairoDayKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export const isValidDocId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9]{10,40}$/.test(s)

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export const safeJsonLd = (o: unknown): string => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

export function isExpiredDate(d: unknown, now: Date = new Date()): boolean {
  return d instanceof Date && d.getTime() <= now.getTime()
}

export function cloudinaryUrl(id: string, w = 1200, h = 630): string {
  const [cloud, ...rest] = id.split(':')
  return `https://res.cloudinary.com/${cloud}/image/upload/f_auto,q_auto,w_${w},h_${h},c_fill/${rest.join(':')}`
}
