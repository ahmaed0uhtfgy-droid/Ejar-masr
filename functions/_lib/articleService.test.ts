// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as ai from './articleAI'
import { DEFAULT_ARTICLE_SETTINGS, runArticleCron, writeArticle } from './articleService'
import { deleteArticle, loadDirectory, readArticle, saveArticle, type ArticleDoc } from './articleStore'
import { arabicSlug } from './articleText'
import { makeEnv, useWorld } from '../_tests/harness'

// NOTE: written without being able to run it (no network to install dependencies in the session that wrote it). Run `npm test` and fix any mismatch first.
vi.mock('./articleAI', async (orig) => ({ ...(await orig<typeof import('./articleAI')>()), callLLM: vi.fn(), fetchSuggestions: vi.fn(async () => ['شقق للايجار بالتجمع']) }))
vi.mock('./google', () => import('../_tests/fakeGoogle'))

const w = useWorld()
const callLLM = vi.mocked(ai.callLLM)
const env = () => makeEnv({ GEMINI_API_KEY: 'test-key' })
const PRIMARY = 'شقق للايجار في مدينة نصر'

beforeEach(() => {
  callLLM.mockReset()
  const s = new Map<string, { res: Response; until: number }>()
  vi.stubGlobal('caches', { default: {
    match: async (r: Request) => { const e = s.get(r.url); return e && e.until > Date.now() ? e.res.clone() : undefined },
    put: async (r: Request, x: Response) => { s.set(r.url, { res: x, until: Date.now() + Number(/max-age=(\d+)/.exec(x.headers.get('Cache-Control') ?? '')?.[1] ?? 0) * 1000 }) },
    delete: async (r: Request) => s.delete(r.url),
  } })
})
afterEach(() => { vi.unstubAllGlobals() })

/** A structurally valid model answer (not a high-quality one: it is short, so the SEO score will be low, which is exactly what the publish gate tests need). */
const fakeAnswer = (primary: string) => JSON.stringify({
  title: `${primary}: دليل عملي قبل ما توقّع العقد`,
  description: `${primary} من غير مفاجآت: إزاي تعاين الوحدة وتسأل المالك الأسئلة الصح وتفهم العقد قبل ما تدفع أي مبلغ.`,
  intro: [`لو بتدور على ${primary} فأنت محتاج خطة واضحة قبل ما تنزل المعاينة.`, 'الفقرة التانية بتشرح إيه اللي هتلاقيه في المقال.'],
  sections: [1, 2, 3, 4, 5].map((n) => ({ heading: `القسم رقم ${n} بصياغة مختلفة`, paragraphs: [`فقرة أولى في القسم ${n} فيها تفاصيل عملية للباحث عن سكن.`, `فقرة تانية في القسم ${n} فيها مثال من الحياة.`] })),
  conclusion: { heading: 'قبل ما تقرر', paragraphs: ['كلمة أخيرة مفيدة للقارئ.'] },
  faq: [1, 2, 3, 4].map((n) => ({ q: `سؤال رقم ${n} بيسأله الناس كتير؟`, a: `إجابة رقم ${n} من جملتين فيها معلومة مفيدة وواضحة للقارئ.` })),
})
const item = (primary = PRIMARY) => ({ title: '', primary, secondary: ['إيجار شقة', 'معاينة'], angle: 'دليل للمبتدئين', audience: 'مستأجر جديد' })
const write = (o: Partial<Parameters<typeof writeArticle>[1]> = {}) => writeArticle(env(), { item: item(), topic: PRIMARY, govId: '', typeId: '', autoPublish: false, minScore: 80, now: new Date(), ...o })

const doc = (slug: string, over: Partial<ArticleDoc> = {}): ArticleDoc => ({
  slug, title: `عنوان مقال ${slug} للاختبار`, description: 'وصف', body: '## عنوان\n\nنص المقال للاختبار الكامل.', primary: slug, secondary: [], faq: [], cover: null, images: [], videoId: null, videoTitle: '',
  status: 'draft', source: 'manual', topic: '', angle: '', govId: '', typeId: '', publishAt: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date(), score: 0, issues: [], similarTo: null, ai: null, ...over,
})
const seedSettings = (over: Record<string, unknown> = {}) => w.db.seed('articleMeta/settings', { ...DEFAULT_ARTICLE_SETTINGS, enabled: true, topics: [{ topic: PRIMARY, govId: '', typeId: '' }], ...over, lastRunAt: (over.lastRunAt as Date | null | undefined) ?? null })

describe('article store', () => {
  it('saves, reads back, lists in the directory, and deletes', async () => {
    await saveArticle(env(), doc('مقال-اختبار-اول'), { create: true })
    expect((await readArticle(env(), 'مقال-اختبار-اول'))?.title).toContain('مقال-اختبار-اول')
    expect((await loadDirectory(env())).entries.map((e) => e.slug)).toEqual(['مقال-اختبار-اول'])
    expect(await deleteArticle(env(), 'مقال-اختبار-اول')).toBe(true)
    expect(await readArticle(env(), 'مقال-اختبار-اول')).toBeNull()
    expect((await loadDirectory(env())).entries).toHaveLength(0)
  })
})

describe('writeArticle', () => {
  it('saves a DRAFT whose link is the search words, marked as AI-written', async () => {
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    const r = await write()
    expect(r.published).toBe(false)
    expect(r.article.status).toBe('draft')
    expect(r.article.slug).toBe(arabicSlug(PRIMARY))
    expect(r.article.source).toBe('ai')
    expect((await readArticle(env(), r.article.slug))?.title).toContain(PRIMARY)
  })
  it('adds the missing internal links by code, and trims an over-long description', async () => {
    const long = JSON.parse(fakeAnswer(PRIMARY)) as { description: string }
    long.description = `${PRIMARY} `.repeat(30)
    callLLM.mockResolvedValue(JSON.stringify({ ...JSON.parse(fakeAnswer(PRIMARY)), description: long.description }))
    const r = await write()
    expect(r.article.body).toContain('](/search)')
    expect(r.article.issues.join(' ')).not.toContain('روابط داخلية')
    expect(r.article.description.length).toBeLessThanOrEqual(165)
  })
  it('a second article on the same phrase gets its own link instead of overwriting', async () => {
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    const a = await write(); const b = await write()
    expect(b.article.slug).not.toBe(a.article.slug)
    expect((await loadDirectory(env())).entries).toHaveLength(2)
  })
  it('publishes by itself only when auto-publish is on AND every gate passes; a weak score keeps it a draft with the reason', async () => {
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    const open = await write({ autoPublish: true, minScore: 0 })
    expect(open.published).toBe(true); expect(open.article.status).toBe('published'); expect(open.article.publishedAt).not.toBeNull()
    callLLM.mockResolvedValue(fakeAnswer('إيجار شقة للعرسان'))
    const gated = await write({ item: item('إيجار شقة للعرسان'), autoPublish: true, minScore: 95 })
    expect(gated.published).toBe(false); expect(gated.article.status).toBe('draft'); expect(gated.why.join(' ')).toContain('تقييم الجودة')
  })
  it('turns unusable model output into a clean error and saves nothing', async () => {
    callLLM.mockResolvedValue('not json at all')
    const e = await write().catch((x: unknown) => x as { code: string })
    expect((e as { code: string }).code).toBe('ai-format')
    expect((await loadDirectory(env())).entries).toHaveLength(0)
  })
  it('refuses cleanly with no AI key', async () => {
    const e = await writeArticle(makeEnv(), { item: item(), topic: PRIMARY, govId: '', typeId: '', autoPublish: false, minScore: 80, now: new Date() }).catch((x: unknown) => x as { code: string })
    expect((e as { code: string }).code).toBe('ai-not-configured')
  })
})

describe('the scheduler', () => {
  const tick = () => runArticleCron(env(), new Date())
  it('does nothing while automation is off', async () => {
    seedSettings({ enabled: false })
    expect((await tick()).skipped).toBe('automation is off')
    expect(callLLM).not.toHaveBeenCalled()
  })
  it('writes ONE draft per due tick, moves to the next topic, and is not due again straight away', async () => {
    seedSettings()
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    const first = await tick()
    expect(first.error).toBeNull(); expect(first.generated).toContain('مسودة')
    expect((await loadDirectory(env())).entries).toHaveLength(1)
    expect((await tick()).skipped).toBe('not due yet')
    expect(callLLM).toHaveBeenCalledTimes(1)
  })
  it('respects the daily cap', async () => {
    seedSettings({ dayKey: new Date().toISOString().slice(0, 10), todayCount: 2, dailyMax: 2 })
    expect((await tick()).skipped).toBe('daily limit reached')
    expect(callLLM).not.toHaveBeenCalled()
  })
  it('in auto mode a below-threshold article still stays a draft (the gate holds)', async () => {
    seedSettings({ mode: 'auto', minScore: 95 })
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    await tick()
    expect((await loadDirectory(env())).entries.map((e) => e.status)).toEqual(['draft'])
  })
  it('stops after the last title (one pass) unless loop is on', async () => {
    seedSettings({ cursor: 1 }) // one topic, already written
    expect((await tick()).skipped).toBe('all topics are done')
    expect(callLLM).not.toHaveBeenCalled()
  })
  it('starts another lap with loop on', async () => {
    seedSettings({ cursor: 1, loop: true })
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    expect((await tick()).generated).not.toBeNull()
  })
  it('a failing AI call is reported, saves nothing, and gives the slot back so the next tick retries', async () => {
    seedSettings()
    callLLM.mockResolvedValue('garbage')
    const r = await tick()
    expect(r.error).toContain('ai-format')
    expect((await loadDirectory(env())).entries).toHaveLength(0)
    callLLM.mockResolvedValue(fakeAnswer(PRIMARY))
    expect((await tick()).generated).not.toBeNull()
  })
  it('publishes a scheduled article once its time has passed, and not before', async () => {
    seedSettings({ enabled: false })
    await saveArticle(env(), doc('مقال-مجدول-بعد-ساعة', { status: 'scheduled', publishAt: new Date(Date.now() + 3600_000) }), { create: true })
    await saveArticle(env(), doc('مقال-مجدول-فات-وقته', { status: 'scheduled', publishAt: new Date(Date.now() - 60_000) }), { create: true })
    expect((await tick()).published).toBe(1)
    expect((await readArticle(env(), 'مقال-مجدول-فات-وقته'))?.status).toBe('published')
    expect((await readArticle(env(), 'مقال-مجدول-بعد-ساعة'))?.status).toBe('scheduled')
  })
})
