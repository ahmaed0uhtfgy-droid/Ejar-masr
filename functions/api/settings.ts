import type { Env } from '../_lib/env'
import { edgeCached } from '../_lib/edgeLimit'
import { getDocument } from '../_lib/firestore'
import { errorResponse } from '../_lib/http'
import { toWire } from '../_lib/wire'

/**
 * GET /api/settings - the two public settings documents (app settings + extra locations), cached at the edge for 10 minutes.
 * Every first-time visitor used to cost 2 Firestore reads; now all visitors together cost 2 reads per 10 minutes per data center.
 * Both documents are already world-readable in the security rules, so this exposes nothing new.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  try {
    const body = await edgeCached('public-settings', 600, async () => {
      const [app, loc] = await Promise.all([getDocument(env, 'settings/app'), getDocument(env, 'settings/locations')])
      return { app: app ? toWire(app.data) : null, locations: loc ? toWire(loc.data.items ?? []) : [] }
    })
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' } })
  } catch (e) { return errorResponse(e) }
}
