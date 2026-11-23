import { analyzeArticle, minhash, sigSimilarity } from '../_lib/articleQuality'
import { arabicSlug, isValidSlug, uniqueSlug, youtubeId, type ArticleImage } from '../_lib/articleText'
import { deleteArticle, loadDirectory, readArticle, saveArticle, type ArticleDoc, type ArticleStatus } from '../_lib/articleStore'
import { DEFAULT_ARTICLE_SETTINGS, loadSettings, normalizeSettings } from '../_lib/articleService'
import { callLLM, clean, pickProvider } from '../_lib/articleAI'
import { renderArticle } from '../_lib/articlePages'
import type { Env } from '../_lib/env'
import { commitGuarded } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { GOVS } from '../_lib/seo'

const IMG_ID = /^[A-Za-z0-9_-]{1,60}:[A-Za-z0-9/_.-]{1,200}$/
const SAFE_PATH = /^\/(?!\/)[^\s"'<>\\]{0,200}$/
const plain = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/\u0000/g, '').trim().slice(0, max) : '')
function image(v: unknown): ArticleImage | null {
  const o = (v ?? {}) as Record<string, unknown>
  if (typeof o.id !== 'string' || !IMG_ID.test(o.id)) return null
  const href = typeof o.href === 'string' && SAFE_PATH.test(o.href) ? o.href : undefined
  return { id: o.id, alt: clean(o.alt, 160), ...(href ? { href } : {}) }
}
const iso = (d: Date | null): string | null => (d ? d.toISOString() : null)
export const publicShape = (a: ArticleDoc) => ({ ...a, publishAt: iso(a.publishAt), publishedAt: iso(a.publishedAt), createdAt: iso(a.createdAt), updatedAt: iso(a.updatedAt) })

/**
 * POST /api/articles-admin (admin only). Actions: list | get | save | preview | ai-check | publish | unpublish | schedule | delete | settings | settings-save
 * Every field is validated and size-limited here; the body is stored as the restricted markdown and only ever rendered by the safe renderer.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env, { admin: true })
    const b = await readJson<Record<string, unknown>>(request)
    const slugOf = (v: unknown): string => { const s = plain(v, 90); if (!isValidSlug(s)) throw new HttpError(400, 'bad-slug', 'رابط المقال غير صحيح'); return s }
    const now = new Date()

    switch (b.action) {
      case 'list': {
        const dir = await loadDirectory(env)
        return json({ entries: dir.entries.map(({ sig: _sig, ...e }) => { void _sig; return e }) })
      }
      case 'get': {
        const a = await readArticle(env, slugOf(b.slug))
        if (!a) throw new HttpError(404, 'not-found', 'المقال مش موجود')
        return json({ article: publicShape(a) })
      }
      case 'save': {
        const title = plain(b.title, 120)
        const body = typeof b.body === 'string' ? b.body.replace(/\u0000/g, '').slice(0, 40_000) : ''
        if (title.length < 8) throw new HttpError(400, 'bad-title', 'العنوان قصير')
        if (body.trim().length < 20) throw new HttpError(400, 'bad-body', 'المقال فاضي')
        const primary = plain(b.primary, 60)
        const prevSlug = typeof b.prevSlug === 'string' && b.prevSlug ? slugOf(b.prevSlug) : ''
        const previous = prevSlug ? await readArticle(env, prevSlug) : null
        if (prevSlug && !previous) throw new HttpError(404, 'not-found', 'المقال مش موجود')
        const dir = await loadDirectory(env)
        const taken = async (s: string) => dir.entries.some((e) => e.slug === s && e.slug !== prevSlug)
        let slug = plain(b.slug, 90)
        if (slug) { slug = arabicSlug(slug, 90); if (!isValidSlug(slug)) throw new HttpError(400, 'bad-slug', 'رابط المقال غير صحيح'); if (await taken(slug)) throw new HttpError(409, 'slug-taken', 'الرابط ده مستخدم في مقال تاني') }
        else slug = prevSlug || await uniqueSlug(arabicSlug(primary || title), taken)
        const govId = typeof b.govId === 'string' && GOVS.some((g) => g.id === b.govId) ? b.govId : ''
        const typeId = typeof b.typeId === 'string' && /^[a-z0-9-]{1,30}$/.test(b.typeId) ? b.typeId : ''
        const rawVideo = plain(b.video, 200)
        const videoId = rawVideo ? youtubeId(rawVideo) : null
        if (rawVideo && !videoId) throw new HttpError(400, 'bad-video', 'رابط الفيديو غير صحيح (يوتيوب فقط)')
        const faq = (Array.isArray(b.faq) ? b.faq : []).flatMap((f) => { const o = (f ?? {}) as Record<string, unknown>; const q = plain(o.q, 200); const a = plain(o.a, 800); return q && a ? [{ q, a }] : [] }).slice(0, 10)
        const images = (Array.isArray(b.images) ? b.images : []).flatMap((i) => { const x = image(i); return x ? [x] : [] }).slice(0, 12)
        const cover = image(b.cover)
        const secondary = (Array.isArray(b.secondary) ? b.secondary : []).map((x) => plain(x, 60)).filter(Boolean).slice(0, 10)
        const description = plain(b.description, 220)
        const q = analyzeArticle({ title, description, slug, body, primary, secondary, faq, images: [...(cover ? [cover] : []), ...images] })
        const sig = minhash(body)
        const near = dir.entries.filter((e) => e.slug !== slug && e.slug !== prevSlug).map((e) => ({ slug: e.slug, score: Math.round(sigSimilarity(sig, e.sig) * 100) / 100 })).sort((x, y) => y.score - x.score)[0]
        const similarTo = near && near.score >= 0.2 ? near : null
        const issues = [...q.issues, ...(similarTo ? [`شبه مقال موجود (${similarTo.slug}) بنسبة ${Math.round(similarTo.score * 100)}%`] : [])]
        const article: ArticleDoc = {
          slug, title, description, body, primary, secondary, faq, cover, images, videoId, videoTitle: plain(b.videoTitle, 120),
          status: previous?.status ?? 'draft', source: previous?.source ?? 'manual', topic: plain(b.topic, 120) || previous?.topic || '', angle: previous?.angle ?? '', govId, typeId,
          publishAt: previous?.publishAt ?? null, publishedAt: previous?.publishedAt ?? null, createdAt: previous?.createdAt ?? now, updatedAt: now,
          score: q.score, issues, similarTo, ai: previous?.ai ?? null,
        }
        await saveArticle(env, article, { create: !previous, prevSlug: previous && previous.slug !== slug ? previous.slug : undefined })
        return json({ slug, score: q.score, issues, similarTo })
      }
      case 'publish': case 'unpublish': case 'schedule': {
        const a = await readArticle(env, slugOf(b.slug))
        if (!a) throw new HttpError(404, 'not-found', 'المقال مش موجود')
        let status: ArticleStatus = 'draft'
        let publishAt: Date | null = null
        if (b.action === 'publish') status = 'published'
        if (b.action === 'schedule') {
          publishAt = new Date(String(b.publishAt))
          if (Number.isNaN(publishAt.getTime()) || publishAt.getTime() <= now.getTime()) throw new HttpError(400, 'bad-date', 'اختار تاريخ ووقت في المستقبل')
          status = 'scheduled'
        }
        await saveArticle(env, { ...a, status, publishAt, publishedAt: status === 'published' ? (a.publishedAt ?? now) : a.publishedAt, updatedAt: now }, { create: false })
        return json({ status })
      }
      case 'preview': { // the exact HTML visitors will get, with a "not published yet" banner and noindex; the admin screen shows it in a sandboxed frame
        const a = await readArticle(env, slugOf(b.slug))
        if (!a) throw new HttpError(404, 'not-found', 'المقال مش موجود')
        return json({ html: renderArticle(env, a, { listings: [], articles: [] }, { preview: true }) })
      }
      case 'ai-check': { // setup diagnostic: which provider/model is configured, which models the key can really use, and how fast a tiny call is
        const p = pickProvider(env)
        if (!p) throw new HttpError(503, 'ai-not-configured', 'مفيش مفتاح AI مضبوط. ضيف GEMINI_API_KEY أو ANTHROPIC_API_KEY في Cloudflare')
        let models: string[] = []
        if (p.provider === 'gemini') {
          try {
            const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': p.key } })
            if (r.ok) models = (((await r.json()) as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }).models ?? []).filter((m) => m.supportedGenerationMethods?.includes('generateContent')).map((m) => String(m.name).replace(/^models\//, ''))
          } catch { /* the list is a convenience; the timed call below is the real test */ }
        }
        const t0 = Date.now()
        let ok = false; let error = ''
        try { await callLLM(env, { system: 'Reply with the single word OK.', user: 'ping', maxTokens: 200, temperature: 0, timeoutMs: 25_000 }); ok = true } catch (e) { error = e instanceof Error ? e.message : 'failed' }
        return json({ provider: p.provider, model: p.model, ok, ms: Date.now() - t0, error, models: models.slice(0, 80) })
      }
      case 'delete': {
        if (!(await deleteArticle(env, slugOf(b.slug)))) throw new HttpError(404, 'not-found', 'المقال مش موجود')
        return json({ ok: true })
      }
      case 'settings': {
        const { settings } = await loadSettings(env)
        return json({ settings, defaults: DEFAULT_ARTICLE_SETTINGS.topics.length })
      }
      case 'settings-save': {
        const cur = await loadSettings(env)
        const next = normalizeSettings({ ...(b.settings as Record<string, unknown>), cursor: cur.settings.cursor, lastRunAt: cur.settings.lastRunAt ? new Date(cur.settings.lastRunAt) : null, lastResult: cur.settings.lastResult, lastError: cur.settings.lastError, dayKey: cur.settings.dayKey, todayCount: cur.settings.todayCount })
        const data = { ...next, lastRunAt: next.lastRunAt ? new Date(next.lastRunAt) : null }
        await commitGuarded(env, [cur.exists ? { kind: 'upsert', path: 'articleMeta/settings', data } : { kind: 'create', path: 'articleMeta/settings', data }], { 'articleMeta/settings': cur.updateTime })
        return json({ settings: next })
      }
      default: throw new HttpError(400, 'bad-action', 'إجراء غير معروف')
    }
  } catch (e) { return errorResponse(e) }
}
