export function errCode(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) return String((e as { code: unknown }).code)
  return ''
}

/** Firestore Spark daily quota exhausted -> operations are rejected with resource-exhausted. */
export function isQuotaError(e: unknown): boolean {
  const c = errCode(e)
  if (c.includes('resource-exhausted')) return true
  return e instanceof Error && /quota/i.test(e.message)
}

/** Short technical reason (error code + message) shown under generic errors so a screenshot is enough to diagnose. */
export function errDetail(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  return `${errCode(e)} ${msg}`.trim().replace(/\s+/g, ' ').slice(0, 900)
}

export function isPermissionError(e: unknown): boolean {
  return errCode(e).includes('permission-denied')
}
