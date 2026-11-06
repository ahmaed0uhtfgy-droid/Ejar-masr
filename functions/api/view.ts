import type { Env } from '../_lib/env'
import { commit, getDocument } from '../_lib/firestore'
import { errorResponse, json, readJson } from '../_lib/http'
import { isValidDocId } from '../_lib/logic'

/**
 * POST /api/view { unitId } - anonymous view counter.
 * Throttled to one count per (IP, unit) per 6h through the edge cache of the current data center. This is a best-effort
 * guard for the 20k/day Spark write quota, not a guarantee; disable via settings.trackViews if abused.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const { unitId } = await readJson<{ unitId?: unknown }>(request)
    if (!isValidDocId(unitId)) return json({ ok: false }, 400)
    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const cache = caches.default
    const key = new Request(`https://views.internal/${encodeURIComponent(ip)}/${unitId}`)
    if (await cache.match(key)) return json({ ok: true, counted: false })
    await cache.put(key, new Response('1', { headers: { 'Cache-Control': 'max-age=21600' } }))

    const unit = await getDocument(env, `units/${unitId}`)
    if (!unit || unit.data.status !== 'active') return json({ ok: false }, 404)
    await commit(env, [{ kind: 'upsert', path: `unitStats/${unitId}`, data: { ownerId: unit.data.ownerId ?? '' }, increments: { views: 1 } }])
    return json({ ok: true, counted: true })
  } catch (e) { return errorResponse(e) }
}
