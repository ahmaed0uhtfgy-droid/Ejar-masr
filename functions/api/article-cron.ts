import { runArticleCron } from '../_lib/articleService'
import type { Env } from '../_lib/env'
import { errorResponse, json, requireUser } from '../_lib/http'
import { timingSafeEqual } from '../_lib/paymob'

/**
 * POST /api/article-cron  (Authorization: Bearer <CRON_SECRET>, or an admin's Firebase ID token)
 * Called every few hours by .github/workflows/articles.yml. Does nothing unless the admin turned automation on and an article is due.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const cronOk = !!env.CRON_SECRET && !!token && timingSafeEqual(token, env.CRON_SECRET)
    if (!cronOk) await requireUser(request, env, { admin: true })
    return json({ ok: true, ...(await runArticleCron(env, new Date())) })
  } catch (e) { return errorResponse(e) }
}
