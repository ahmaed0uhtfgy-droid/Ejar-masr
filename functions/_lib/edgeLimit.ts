/**
 * Free, database-less rate limiting built on Cloudflare's per-data-center cache (Cache API).
 * It costs no Firestore reads/writes and no extra Function requests, so it protects the daily quotas instead of using them.
 *
 * Best-effort by design: counters live per data center and the read-then-write is not atomic, so a determined attacker spread over many
 * locations gets somewhat more than `max`. That is fine: the goal is to stop one source from draining a daily quota, not exact accounting.
 * If the cache is unavailable it fails OPEN (never blocks real users because of an infrastructure problem).
 */
export async function overLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  if (typeof caches === 'undefined') return false
  try {
    const bucket = Math.floor(Date.now() / 1000 / windowSec) // fixed window: every bucket is independent
    const req = new Request(`https://limits.internal/${encodeURIComponent(key)}/${bucket}`)
    const hit = await caches.default.match(req)
    const n = hit ? Number(await hit.text()) || 0 : 0
    if (n >= max) return true
    await caches.default.put(req, new Response(String(n + 1), { headers: { 'Cache-Control': `max-age=${windowSec}` } }))
    return false
  } catch { return false }
}

/** Small JSON value cached at the edge for `ttlSec` (used to avoid repeating the same Firestore read for many visitors). */
export async function edgeCached<T>(key: string, ttlSec: number, load: () => Promise<T>, cacheIf: (v: T) => boolean = () => true): Promise<T> {
  if (typeof caches === 'undefined') return load()
  const req = new Request(`https://cache.internal/${encodeURIComponent(key)}`)
  try {
    const hit = await caches.default.match(req)
    if (hit) return (await hit.json()) as T
  } catch { /* fall through to a fresh load */ }
  const value = await load()
  if (cacheIf(value)) { try { await caches.default.put(req, new Response(JSON.stringify(value), { headers: { 'Cache-Control': `max-age=${ttlSec}` } })) } catch { /* ignore */ } }
  return value
}

/**
 * Counts events at the edge and tells the caller when to write them to the database in one go.
 * Returns 0 while the pending count is below `flushAt`, and the accumulated count when it is reached (then it starts over).
 * Used for view counters: 1 database write per `flushAt` views instead of 1 per view. Best-effort (counts pending for more than 30 minutes
 * are dropped, and concurrent requests can lose a count): fine for analytics, never use it for money.
 */
export async function batchCount(key: string, flushAt: number): Promise<number> {
  if (typeof caches === 'undefined') return 1 // no cache available: behave like "write every time"
  try {
    const req = new Request(`https://batch.internal/${encodeURIComponent(key)}`)
    const hit = await caches.default.match(req)
    const n = (hit ? Number(await hit.text()) || 0 : 0) + 1
    if (n >= flushAt) { await caches.default.delete(req); return n }
    await caches.default.put(req, new Response(String(n), { headers: { 'Cache-Control': 'max-age=1800' } }))
    return 0
  } catch { return 1 }
}

/** Forget a cached value on this data center right away (other data centers still expire it on their own within the TTL). */
export async function edgePurge(key: string): Promise<void> {
  if (typeof caches === 'undefined') return
  try { await caches.default.delete(new Request(`https://cache.internal/${encodeURIComponent(key)}`)) } catch { /* ignore */ }
}
