/**
 * One shared SNAPSHOT of all active listings, so the cost of search no longer depends on how many people search or what they filter by.
 *
 * Why: reading listings per search costs Firestore reads (free plan: 50,000/day) and needs a composite index for every filter/sort combination.
 * Instead, the newest 300 active listings are read ONCE per refresh interval (using the simple status+createdAt index every project already has),
 * stored in a single server-only document, and every search (governorate, rent type, price order, paging) is answered from memory.
 *
 *   reads/day  ~=  (active listings) x (refreshes per day)  -  independent of visitors and of the number of different searches.
 *
 * The refresh interval grows with the catalogue so the cost stays under ~12,000 reads/day (see refreshMinutes).
 * With 300 or more active listings the snapshot is marked `truncated` and the caller falls back to normal indexed queries.
 */
import type { Env } from './env'
import { edgeCached } from './edgeLimit'
import { commit, getDocument, runQuery } from './firestore'
import { toWire } from './wire'

export const SNAPSHOT_LIMIT = 300
const DAILY_READ_BUDGET = 12_000

export type WireDoc = { id: string; data: Record<string, unknown> }
export interface Snapshot { builtAt: number; truncated: boolean; units: WireDoc[] }

/** Minutes between refreshes: 5 for small catalogues, longer as it grows (never more than 60). */
export const refreshMinutes = (count: number): number => Math.min(60, Math.max(5, Math.ceil((Math.max(count, 1) * 1440) / DAILY_READ_BUDGET)))

const slim = (data: Record<string, unknown>): Record<string, unknown> => {
  const d = toWire(data) as Record<string, unknown>
  // Cards never show the full description (the detail page reads the real document), and it is the biggest field.
  if (typeof d.description === 'string') d.description = d.description.slice(0, 120)
  return d
}

async function rebuild(env: Env): Promise<Snapshot> {
  const docs = await runQuery(env, { collection: 'units', where: [{ field: 'status', op: 'EQUAL', value: 'active' }], orderBy: { field: 'createdAt', dir: 'DESCENDING' }, limit: SNAPSHOT_LIMIT })
  const snap: Snapshot = { builtAt: Date.now(), truncated: docs.length >= SNAPSHOT_LIMIT, units: docs.map((d) => ({ id: d.id, data: slim(d.data) })) }
  // A JSON string, not a map/array: no per-field indexing, no index-entry limits, and the document stays far below 1 MiB.
  try { await commit(env, [{ kind: 'upsert', path: 'publicCache/listings', data: { json: JSON.stringify(snap), builtAt: new Date(snap.builtAt), count: docs.length } }]) } catch (e) { console.error('listings snapshot write failed', e) }
  return snap
}

/** Returns the stored snapshot while it is fresh, otherwise rebuilds it (a stale one is still served if the rebuild fails). */
export async function loadSnapshot(env: Env): Promise<Snapshot> {
  let stored: Snapshot | null = null
  try {
    const doc = await getDocument(env, 'publicCache/listings')
    if (doc && typeof doc.data.json === 'string') stored = JSON.parse(doc.data.json) as Snapshot
  } catch (e) { console.error('listings snapshot read failed', e) }
  if (stored && Date.now() - stored.builtAt < refreshMinutes(stored.units.length) * 60_000) return stored
  try { return await rebuild(env) } catch (e) { if (stored) return stored; throw e }
}

export type SortKey = 'newest' | 'priceAsc' | 'priceDesc'
export interface PageQuery { gov?: string; rent?: string; sort: SortKey; n: number; after: { v: number; id: string } | null; now: number }

const tsOf = (v: unknown): number | null => (v && typeof v === 'object' && typeof (v as { __ts?: unknown }).__ts === 'number' ? (v as { __ts: number }).__ts : null)

/** Filters, orders and pages the snapshot in memory. Order and cursor match the indexed queries exactly (value, then id in the same direction). */
export function pageFromSnapshot(snap: Snapshot, q: PageQuery): { docs: WireDoc[]; next: { v: number; id: string } | null } {
  const desc = q.sort !== 'priceAsc'
  const valueOf = (d: WireDoc): number => (q.sort === 'newest' ? tsOf(d.data.createdAt) ?? 0 : Number(d.data.price) || 0)
  const rows = snap.units
    .filter((d) => (!q.gov || d.data.governorateId === q.gov) && (!q.rent || d.data.rentType === q.rent))
    .filter((d) => { const exp = tsOf(d.data.expiresAt); return exp === null || exp > q.now })
    .sort((a, b) => { const c = valueOf(a) - valueOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); return desc ? -c : c })
  const start = q.after ? rows.findIndex((d) => { const c = valueOf(d) - q.after!.v || (d.id < q.after!.id ? -1 : d.id > q.after!.id ? 1 : 0); return (desc ? -c : c) > 0 }) : 0
  const rest = start < 0 ? [] : rows.slice(start)
  const docs = rest.slice(0, q.n)
  const last = docs[docs.length - 1]
  return { docs, next: rest.length > q.n && last ? { v: valueOf(last), id: last.id } : null }
}

/** The snapshot through the shared edge cache (3 min). Used by search, the landing pages and the sitemap, so they all cost one read together. */
export const getSnapshot = (env: Env): Promise<Snapshot> => edgeCached('listings-snapshot', 180, () => loadSnapshot(env))
