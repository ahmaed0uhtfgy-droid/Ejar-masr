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

export function isPermissionError(e: unknown): boolean {
  return errCode(e).includes('permission-denied')
}
