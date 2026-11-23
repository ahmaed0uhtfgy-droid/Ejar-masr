import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { db } from './firebase'
import { edgeAvailable, fetchEdge, markEdgeDown } from './edgeApi'

const KEY = 'ejar:active-count:v1'
const TTL_MS = 10 * 60 * 1000

/**
 * Number of active listings for the home page statistic.
 * It used to be one Firestore aggregation read per home visit (uncacheable, and the biggest unbounded cost of the page). Now:
 *  1. remembered 10 minutes in the browser,
 *  2. taken from the edge-cached /api/units answer (the same URL the "latest units" strip already fetched, so it costs no extra request),
 *  3. only if that has no total (300+ listings) does it fall back to the aggregation read.
 */
export async function activeUnitCount(): Promise<number> {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { at: number; n: number } | null
    if (c && typeof c.n === 'number' && Date.now() - c.at < TTL_MS) return c.n
  } catch { /* storage may be blocked */ }
  let n: number | null = null
  if (edgeAvailable()) {
    try {
      const r = await fetchEdge<{ total?: number }>('/api/units?sort=newest&n=16')
      if (typeof r.total === 'number') n = r.total
    } catch { markEdgeDown() }
  }
  if (n === null) n = (await getCountFromServer(query(collection(db, 'units'), where('status', '==', 'active')))).data().count
  try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), n })) } catch { /* ignore */ }
  return n
}
