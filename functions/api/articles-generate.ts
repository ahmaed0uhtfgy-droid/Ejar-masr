import { clean, fetchSuggestions, type PlanMode } from '../_lib/articleAI'
import { planArticles, writeArticle } from '../_lib/articleService'
import { overLimit } from '../_lib/edgeLimit'
import type { Env } from '../_lib/env'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { GOVS } from '../_lib/seo'

/**
 * POST /api/articles-generate (admin only)
 *   { action: 'suggest', seed }                                   -> real Google search suggestions for a phrase
 *   { action: 'plan',  topic, count (1-5), mode: 'angles'|'tweaks', govId?, typeId? } -> N distinct titles + keywords (nothing is saved)
 *   { action: 'write', item: { title?, primary, secondary[], angle, audience }, topic, govId?, typeId? } -> writes ONE article and saves it as a DRAFT
 * One article per request on purpose: each one is a single AI call, so it always finishes inside the platform's time limit; the admin screen loops.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const admin = await requireUser(request, env, { admin: true })
    const b = await readJson<Record<string, unknown>>(request)
    const topic = clean(b.topic, 120)
    const govId = typeof b.govId === 'string' && GOVS.some((g) => g.id === b.govId) ? b.govId : ''
    const typeId = typeof b.typeId === 'string' && /^[a-z0-9-]{1,30}$/.test(b.typeId) ? b.typeId : ''
    if (b.action === 'suggest') {
      const seed = clean(b.seed, 80)
      if (seed.length < 3) throw new HttpError(400, 'bad-seed', 'اكتب كلمة بحث أطول')
      return json({ suggestions: await fetchSuggestions(seed) })
    }
    // Every AI call costs money (or free-tier quota): cap what one admin account can trigger.
    if (await overLimit(`ai:${admin.uid}`, 40, 3600)) throw new HttpError(429, 'rate', 'وصلت للحد الأقصى لعمليات الكتابة في الساعة. استنى شوية')
    if (b.action === 'plan') {
      if (topic.length < 3) throw new HttpError(400, 'bad-topic', 'اكتب موضوع أو عنوان')
      const count = Math.min(5, Math.max(1, Math.round(Number(b.count) || 1)))
      const mode: PlanMode = b.mode === 'tweaks' ? 'tweaks' : 'angles'
      return json(await planArticles(env, { topic, count, mode, govId, typeId }))
    }
    if (b.action === 'write') {
      const it = (b.item ?? {}) as Record<string, unknown>
      const primary = clean(it.primary, 60)
      if (primary.length < 3) throw new HttpError(400, 'bad-keyword', 'الكلمة المفتاحية الأساسية ناقصة')
      const item = { title: clean(it.title, 120), primary, secondary: (Array.isArray(it.secondary) ? it.secondary : []).map((x) => clean(x, 60)).filter(Boolean).slice(0, 8), angle: clean(it.angle, 200), audience: clean(it.audience, 120) }
      const r = await writeArticle(env, { item, topic: topic || primary, govId, typeId, autoPublish: false, minScore: 0, now: new Date() })
      return json({ slug: r.article.slug, title: r.article.title, status: r.article.status, score: r.article.score, issues: r.article.issues, similarTo: r.article.similarTo })
    }
    throw new HttpError(400, 'bad-action', 'إجراء غير معروف')
  } catch (e) { return errorResponse(e) }
}
