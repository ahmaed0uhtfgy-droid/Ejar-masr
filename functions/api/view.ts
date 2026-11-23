import type { Env } from '../_lib/env'
import { commit, getDocument } from '../_lib/firestore'
import { errorResponse, json, readJson } from '../_lib/http'
import { batchCount, edgeCached, overLimit } from '../_lib/edgeLimit'
import { isValidDocId } from '../_lib/logic'

/**
 * POST /api/view { unitId } - anonymous view counter. Built so it can never be used to drain the free Firestore quota:
 *  1. one source (IP) may trigger at most 60 database-touching calls per hour, then gets {counted:false} without any database access;
 *  2. one count per (IP, unit) per 6 h;
 *  3. the "is this unit active?" lookup is shared by all visitors for 10 minutes (one read serves everybody);
 *  4. counts are written in batches of 5 (the dashboard number can lag by up to 4 views per data center).
 * All three use the edge cache, which costs no quota. The browser also skips the call when it already counted the unit recently.
 */
const VIEW_BATCH = 5

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { unitId } = await readJson<{ unitId?: unknown }>(request)
    if (!isValidDocId(unitId)) return json({ ok: false }, 400)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (await overLimit(`view:${ip}`, 60, 3600)) return json({ ok: true, counted: false })

    const cache = caches.default
    const key = new Request(`https://views.internal/${encodeURIComponent(ip)}/${unitId}`)
    if (await cache.match(key)) return json({ ok: true, counted: false })
    await cache.put(key, new Response('1', { headers: { 'Cache-Control': 'max-age=21600' } }))

    const unit = await edgeCached(`unitlite:${unitId}`, 600, async () => {
      const u = await getDocument(env, `units/${unitId}`)
      return { active: !!u && u.data.status === 'active', ownerId: String(u?.data.ownerId ?? '') }
    })
    if (!unit.active) return json({ ok: false }, 404)
    // Views are written to the database in batches of 5: a fifth of the writes against the 20,000/day free quota.
    const pending = await batchCount(`views:${unitId}`, VIEW_BATCH)
    if (pending > 0) await commit(env, [{ kind: 'upsert', path: `unitStats/${unitId}`, data: { ownerId: unit.ownerId }, increments: { views: pending } }])
    return json({ ok: true, counted: true })
  } catch (e) { return errorResponse(e) }
}
