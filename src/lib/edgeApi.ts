import { Timestamp } from 'firebase/firestore'

/**
 * Helpers for the public, edge-cached endpoints (/api/units, /api/settings).
 * These endpoints exist to save the free Firestore read quota. They must NEVER make the site slower or less reliable, so:
 *  - every call has a short timeout,
 *  - after one failure the browser stops trying the API for 2 minutes and reads Firestore directly (the previous behaviour),
 *  - callers always keep their direct-Firestore fallback.
 */
const TIMEOUT_MS = 4000
const COOL_OFF_MS = 120_000
let downUntil = 0

export const edgeAvailable = (): boolean => Date.now() >= downUntil
export const markEdgeDown = (): void => { downUntil = Date.now() + COOL_OFF_MS }
/** For tests. */
export const resetEdge = (): void => { downUntil = 0 }

export async function fetchEdge<T>(path: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(path, { signal: ctl.signal })
    if (!res.ok) throw new Error(`edge ${res.status}`)
    return (await res.json()) as T
  } finally { clearTimeout(timer) }
}

/** The server sends dates as { __ts: epochMillis }; turn them back into Firestore Timestamps so existing mappers keep working unchanged. */
export function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.__ts === 'number' && Object.keys(o).length === 1) return Timestamp.fromMillis(o.__ts)
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]))
  }
  return v
}
