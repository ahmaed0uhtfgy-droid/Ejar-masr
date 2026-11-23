import type { Env } from '../_lib/env'
import { edgeCached, overLimit } from '../_lib/edgeLimit'
import { runQuery } from '../_lib/firestore'
import { HttpError, errorResponse } from '../_lib/http'
import { isValidDocId } from '../_lib/logic'
import { getSnapshot, pageFromSnapshot } from '../_lib/listings'
import { toWire } from '../_lib/wire'

/**
 * GET /api/units?gov=&rent=&sort=newest|priceAsc|priceDesc&n=24&after=<cursor>
 * Public, read-only page of ACTIVE listings. Answered from one shared snapshot of the active listings (see _lib/listings.ts), itself cached at the
 * edge, so the Firestore cost does not grow with visitors or with the variety of searches. This is what keeps the free daily read quota
 * (50,000) from running out. The browser falls back to reading Firestore directly if this endpoint ever fails.
 *
 * Only whitelisted, validated parameters are accepted (an attacker cannot mint unlimited cache keys), and a single IP can cause at most
 * 100 uncached lookups per 10 minutes (cheap now, but they still cost CPU).
 */
const SORTS = { newest: { field: 'createdAt', dir: 'DESCENDING' }, priceAsc: { field: 'price', dir: 'ASCENDING' }, priceDesc: { field: 'price', dir: 'DESCENDING' } } as const
type SortKey = keyof typeof SORTS
const ID = /^[A-Za-z0-9_-]{1,64}$/

function parseCursor(raw: string | null): { v: number; id: string } | null {
  if (!raw) return null
  try {
    const o = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))) as { v?: unknown; id?: unknown }
    if (typeof o.v === 'number' && Number.isFinite(o.v) && isValidDocId(o.id)) return { v: o.v, id: o.id as string }
  } catch { /* fall through */ }
  throw new HttpError(400, 'bad-cursor', 'cursor غير صحيح')
}
const encodeCursor = (c: { v: number; id: string }): string => btoa(JSON.stringify(c)).replace(/\+/g, '-').replace(/\//g, '_')

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const u = new URL(request.url)
    const gov = u.searchParams.get('gov') ?? ''
    const rent = u.searchParams.get('rent') ?? ''
    const sort = (u.searchParams.get('sort') ?? 'newest') as SortKey
    const n = Math.min(48, Math.max(6, Number.parseInt(u.searchParams.get('n') ?? '24', 10) || 24))
    if (gov && !ID.test(gov)) throw new HttpError(400, 'bad-gov', 'المحافظة غير صحيحة')
    if (rent && rent !== 'monthly' && rent !== 'daily') throw new HttpError(400, 'bad-rent', 'نوع الإيجار غير صحيح')
    if (!(sort in SORTS)) throw new HttpError(400, 'bad-sort', 'الترتيب غير صحيح')
    const after = parseCursor(u.searchParams.get('after'))
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'

    const key = `units:${gov}|${rent}|${sort}|${n}|${after ? `${after.v}:${after.id}` : ''}`
    const page = await edgeCached(key, 180, async () => {
      if (await overLimit(`units-miss:${ip}`, 100, 600)) throw new HttpError(429, 'rate', 'طلبات كتير، جرّب بعد شوية')
      // Normal case: answer from the shared snapshot (no per-search database cost, no extra indexes needed).
      const snap = await getSnapshot(env)
      if (!snap.truncated) {
        const r = pageFromSnapshot(snap, { gov: gov || undefined, rent: rent || undefined, sort, n, after, now: Date.now() })
        return { docs: r.docs, next: r.next ? encodeCursor(r.next) : null, total: snap.units.length } // total = all active listings (the home page statistic, so it needs no database read of its own)
      }
      // 300+ active listings: the snapshot cannot hold them all, use real queries (this needs the composite indexes in firestore.indexes.json).
      const where = [{ field: 'status', op: 'EQUAL' as const, value: 'active' }]
      if (gov) where.push({ field: 'governorateId', op: 'EQUAL', value: gov })
      if (rent) where.push({ field: 'rentType', op: 'EQUAL', value: rent })
      const s = SORTS[sort]
      const docs = await runQuery(env, { collection: 'units', where, orderBy: { field: s.field, dir: s.dir }, limit: n, ...(after ? { startAfter: { value: s.field === 'createdAt' ? new Date(after.v) : after.v, id: after.id } } : {}) })
      const last = docs[docs.length - 1]
      const lastVal = last ? (s.field === 'createdAt' ? (last.data.createdAt instanceof Date ? last.data.createdAt.getTime() : 0) : Number(last.data.price)) : 0
      return { docs: docs.map((d) => ({ id: d.id, data: toWire(d.data) })), next: docs.length === n && last ? encodeCursor({ v: lastVal, id: last.id }) : null }
    })
    return new Response(JSON.stringify(page), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' } })
  } catch (e) { return errorResponse(e) }
}
