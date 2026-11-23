/** The article pipeline: settings, planning, writing one article, and the automatic scheduler. Everything an admin button or the cron calls. */
import { AiFormatError, callLLM, defaultLinks, factsText, fetchSuggestions, parseModelJson, pickProvider, planPrompt, snapshotFacts, validateArticle, validatePlan, writePrompt, WRITER_SYSTEM, autoPlaceImages, type PlanItem, type PlanMode } from './articleAI'
import { analyzeArticle, minhash, sigSimilarity } from './articleQuality'
import { arabicSlug, uniqueSlug } from './articleText'
import { loadDirectory, readArticle, saveArticle, type ArticleDoc, type DirEntry } from './articleStore'
import type { Env } from './env'
import { commitGuarded, getDocument, runQuery } from './firestore'
import { HttpError } from './http'
import { getSnapshot, type Snapshot } from './listings'
import { GOVS } from './seo'

export interface Topic { topic: string; govId: string; typeId: string }
export interface ArticleSettings {
  enabled: boolean; mode: 'review' | 'auto'; everyHours: number; dailyMax: number; minScore: number; topics: Topic[]; cursor: number; loop: boolean
  lastRunAt: number | null; lastResult: string; lastError: string; dayKey: string; todayCount: number
}

const gov = (name: string): string => GOVS.find((g) => g.name === name)?.id ?? ''
const GENERIC = [
  'نصائح لاختيار شقة للإيجار', 'أخطاء المستأجر الجديد قبل توقيع عقد الإيجار', 'الفرق بين الشقة المفروشة وغير المفروشة في الإيجار', 'إيجار شقة للعرسان', 'سكن الطلاب وإيجار الغرف',
  'إيجار يومي لشقق الصيف', 'إيجار محل تجاري', 'إيجار فيلا', 'كيف تعاين شقة قبل الإيجار', 'التأمين في عقد الإيجار', 'كيف تعلن عن شقتك للإيجار وتؤجرها بسرعة', 'تسعير الشقة للإيجار للملاك',
]
const MAJOR = ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'القليوبية', 'الشرقية', 'الغربية', 'مطروح', 'البحر الأحمر', 'جنوب سيناء']
export const DEFAULT_TOPICS: Topic[] = [
  ...GENERIC.map((topic) => ({ topic, govId: '', typeId: '' })),
  ...MAJOR.flatMap((name) => (gov(name) ? [{ topic: `شقق للايجار في ${name}`, govId: gov(name), typeId: '' }, { topic: `أفضل مناطق الإيجار في ${name}`, govId: gov(name), typeId: '' }] : [])),
]
const ANGLES = ['دليل للمبتدئين خطوة بخطوة', 'الأخطاء الشائعة وكيف تتجنبها', 'ميزانية واضحة وحسابات عملية', 'أسئلة تسألها قبل ما توقّع', 'مقارنة بين الخيارات المتاحة', 'قصة موقف حقيقي ثم الدروس المستفادة', 'قائمة فحص للمعاينة', 'نصائح للمفاوضة على السعر']
const AUDIENCES = ['مستأجر جديد', 'عرسان', 'طلاب وموظفين', 'عائلة صغيرة', 'ملاك يفكرون في التأجير']

export const DEFAULT_ARTICLE_SETTINGS: ArticleSettings = { enabled: false, mode: 'review', everyHours: 24, dailyMax: 2, minScore: 80, topics: DEFAULT_TOPICS, cursor: 0, loop: false, lastRunAt: null, lastResult: '', lastError: '', dayKey: '', todayCount: 0 }
const num = (v: unknown, lo: number, hi: number, d: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d }

export function normalizeSettings(d: Record<string, unknown> | undefined): ArticleSettings {
  const x = d ?? {}
  const topics = (Array.isArray(x.topics) ? x.topics : DEFAULT_TOPICS).flatMap((t): Topic[] => {
    const o = (t ?? {}) as Record<string, unknown>
    const topic = typeof o.topic === 'string' ? o.topic.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    if (topic.length < 3) return []
    const g = typeof o.govId === 'string' && GOVS.some((v) => v.id === o.govId) ? o.govId : ''
    const ty = typeof o.typeId === 'string' && /^[a-z0-9-]{1,30}$/.test(o.typeId) ? o.typeId : ''
    return [{ topic, govId: g, typeId: ty }]
  }).slice(0, 300)
  return {
    enabled: x.enabled === true, mode: x.mode === 'auto' ? 'auto' : 'review', everyHours: num(x.everyHours, 1, 168, 24), dailyMax: num(x.dailyMax, 1, 8, 2), minScore: num(x.minScore, 60, 95, 80),
    topics: topics.length ? topics : DEFAULT_TOPICS, cursor: num(x.cursor, 0, 1_000_000, 0), loop: x.loop === true, lastRunAt: x.lastRunAt instanceof Date ? x.lastRunAt.getTime() : null,
    lastResult: String(x.lastResult ?? '').slice(0, 300), lastError: String(x.lastError ?? '').slice(0, 300), dayKey: String(x.dayKey ?? ''), todayCount: num(x.todayCount, 0, 1000, 0),
  }
}
export async function loadSettings(env: Env): Promise<{ settings: ArticleSettings; updateTime?: string; exists: boolean }> {
  const d = await getDocument(env, 'articleMeta/settings')
  return { settings: normalizeSettings(d?.data), updateTime: d?.updateTime, exists: !!d }
}
const settingsData = (s: ArticleSettings): Record<string, unknown> => ({ ...s, lastRunAt: s.lastRunAt ? new Date(s.lastRunAt) : null })

// ---------- planning ----------
export async function planArticles(env: Env, o: { topic: string; count: number; mode: PlanMode; govId?: string; typeId?: string }): Promise<{ items: PlanItem[]; suggestions: string[] }> {
  if (!pickProvider(env)) throw new HttpError(503, 'ai-not-configured', 'مفيش مفتاح AI مضبوط')
  const [suggestions, dir, snap] = await Promise.all([fetchSuggestions(o.topic), loadDirectory(env), getSnapshot(env).catch(() => null)])
  const facts = snap ? factsText(snapshotFacts(snap, o.govId, o.typeId)) : 'لا تتوفر بيانات.'
  const prompt = planPrompt({ topic: o.topic, count: o.count, mode: o.mode, suggestions, existingTitles: dir.entries.map((e) => e.title), facts })
  let raw = await callLLM(env, { system: WRITER_SYSTEM, user: prompt, maxTokens: 2500, temperature: 0.9 })
  try { return { items: validatePlan(parseModelJson(raw), o.count), suggestions } } catch (e) {
    if (!(e instanceof AiFormatError)) throw e
    raw = await callLLM(env, { system: WRITER_SYSTEM, user: `${prompt}\n\nالرد السابق لم يكن JSON صالحًا. أعد الرد كـ JSON فقط بالشكل المطلوب.`, maxTokens: 2500, temperature: 0.5 })
    try { return { items: validatePlan(parseModelJson(raw), o.count), suggestions } } catch { throw new HttpError(502, 'ai-format', 'الـ AI رجّع رد بصيغة غير صالحة. جرّب تاني') }
  }
}

// ---------- writing one article ----------
export interface WriteParams { item: PlanItem; topic: string; govId: string; typeId: string; autoPublish: boolean; minScore: number; now: Date }
export interface WriteResult { article: ArticleDoc; entry: DirEntry; published: boolean; why: string[] }

/** Real photos of real listings in the article's governorate: relevant, free, and each one links to the listing. */
function listingImages(snap: Snapshot | null, govId: string, typeId: string) {
  if (!snap) return []
  const pick = (strict: boolean) => snap.units.filter((u) => (!govId || u.data.governorateId === govId) && (!strict || !typeId || u.data.typeId === typeId) && Array.isArray(u.data.images) && (u.data.images as unknown[]).length > 0)
    .sort((a, b) => ((b.data.createdAt as { __ts?: number } | undefined)?.__ts ?? 0) - ((a.data.createdAt as { __ts?: number } | undefined)?.__ts ?? 0))
  const units = pick(true).length >= 3 ? pick(true) : pick(false)
  return units.slice(0, 3).map((u) => ({ id: String((u.data.images as unknown[])[0]), alt: `${String(u.data.typeName ?? 'وحدة')} للإيجار في ${String(u.data.areaName ?? '')} - ${String(u.data.governorateName ?? '')}`.replace(/\s+-\s*$/, ''), href: `/unit/${u.id}` }))
}

/** Models often skip the required internal links; the quality gate needs at least two. Added by code, so it never depends on the model. */
export function ensureInternalLinks(body: string, links: { path: string; hint: string }[]): string {
  const have = [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].length
  if (have >= 2) return body
  const extra = links.filter((l) => !body.includes(`](${l.path})`)).slice(0, 3)
  if (!extra.length) return body
  return `${body.trimEnd()}\n\n## روابط تفيدك في بحثك\n\n${extra.map((l) => `- [${l.hint}](${l.path})`).join('\n')}\n`
}
/** Search results cut descriptions around 160 characters: trim a long one at a word boundary instead of letting it be penalised. */
export function fitDescription(d: string): string {
  const s = d.replace(/\s+/g, ' ').trim()
  if (s.length <= 165) return s
  const cut = s.slice(0, 160)
  return `${cut.slice(0, Math.max(100, cut.lastIndexOf(' '))).replace(/[\s،,.:؛-]+$/, '')}…`
}

export async function writeArticle(env: Env, p: WriteParams): Promise<WriteResult> {
  const prov = pickProvider(env)
  if (!prov) throw new HttpError(503, 'ai-not-configured', 'مفيش مفتاح AI مضبوط')
  const [dir, snap] = await Promise.all([loadDirectory(env), getSnapshot(env).catch(() => null)])
  const g = GOVS.find((x) => x.id === p.govId)
  const typeLabel = p.typeId ? String((snap?.units.find((u) => u.data.typeId === p.typeId)?.data.typeName) ?? '') : ''
  const siblings = dir.entries.filter((e) => e.status !== 'draft' || e.topic === p.topic).sort((a, b) => (b.topic === p.topic ? 1 : 0) - (a.topic === p.topic ? 1 : 0)).slice(0, 12).map((e) => `- /blog/${e.slug} : ${e.title}`)
  const prompt = writePrompt({ item: p.item, topic: p.topic, facts: snap ? factsText(snapshotFacts(snap, p.govId, p.typeId)) : 'لا تتوفر بيانات.', links: defaultLinks(g?.slug, g?.name, p.typeId || undefined, typeLabel || undefined), siblings, today: p.now.toISOString().slice(0, 10) })
  let written
  try { written = validateArticle(parseModelJson(await callLLM(env, { system: WRITER_SYSTEM, user: prompt, maxTokens: 8000, temperature: 0.85 }))) } catch (e) {
    if (!(e instanceof AiFormatError)) throw e
    try { written = validateArticle(parseModelJson(await callLLM(env, { system: WRITER_SYSTEM, user: `${prompt}\n\nتنبيه: التزم بالهيكل كاملًا (مقدمة، 5 أقسام على الأقل، خاتمة، أسئلة شائعة) وأخرج JSON صالحًا فقط.`, maxTokens: 8000, temperature: 0.6 }))) } catch { throw new HttpError(502, 'ai-format', 'الـ AI رجّع مقال ناقص أو بصيغة غير صالحة. جرّب تاني') }
  }
  const photos = listingImages(snap, p.govId, p.typeId)
  const cover = photos[0] ?? null
  const bodyImages = photos.slice(1)
  const body = ensureInternalLinks(autoPlaceImages(written.body, bodyImages.length), defaultLinks(g?.slug, g?.name, p.typeId || undefined, typeLabel || undefined))
  const description = fitDescription(written.description)
  const taken = async (x: string) => dir.entries.some((e) => e.slug === x)
  const firstChoice = arabicSlug(p.item.primary) // the words people search for
  const slug = firstChoice && !(await taken(firstChoice)) ? firstChoice : await uniqueSlug(arabicSlug(written.title) || firstChoice, taken) // then the title, then -2, -3
  const quality = analyzeArticle({ title: written.title, description, slug, body, primary: p.item.primary, secondary: p.item.secondary, faq: written.faq, images: [...(cover ? [cover] : []), ...bodyImages] })
  const sig = minhash(body)
  const near = dir.entries.filter((e) => e.slug !== slug).map((e) => ({ slug: e.slug, score: Math.round(sigSimilarity(sig, e.sig) * 100) / 100 })).sort((a, b) => b.score - a.score)[0]
  const similarTo = near && near.score >= 0.2 ? near : null
  const issues = [...quality.issues]
  if (similarTo) issues.push(`شبه مقال موجود (${similarTo.slug}) بنسبة ${Math.round(similarTo.score * 100)}%`)
  const why: string[] = []
  if (quality.score < p.minScore) why.push(`تقييم الجودة ${quality.score} أقل من ${p.minScore}`)
  if (similarTo && similarTo.score >= 0.35) why.push('مقال مشابه لمقال موجود')
  if (quality.stats.banned.length) why.push('فيه عبارات تبان مكتوبة آليًا')
  const published = p.autoPublish && why.length === 0
  const article: ArticleDoc = {
    slug, title: written.title, description, body, primary: p.item.primary, secondary: p.item.secondary, faq: written.faq, cover, images: bodyImages, videoId: null, videoTitle: '',
    status: published ? 'published' : 'draft', source: 'ai', topic: p.topic, angle: p.item.angle, govId: p.govId, typeId: p.typeId, publishAt: null, publishedAt: published ? p.now : null,
    createdAt: p.now, updatedAt: p.now, score: quality.score, issues, similarTo, ai: { provider: prov.provider, model: prov.model },
  }
  const entry = await saveArticle(env, article, { create: true })
  return { article, entry, published, why }
}

// ---------- the scheduler ----------
const dayKey = (d: Date): string => d.toISOString().slice(0, 10)
export interface CronResult { published: number; generated: string | null; skipped: string | null; error: string | null }

/**
 * One scheduler tick (called every few hours by a GitHub Action). It publishes scheduled articles whose time has come and, if automation is on and an
 * article is due, writes ONE new article (one AI call, so it always fits in a request). Frequency, daily cap, topics and review/auto mode are all
 * admin settings, so changing them never needs a code or workflow change.
 */
export async function runArticleCron(env: Env, now: Date): Promise<CronResult> {
  const res: CronResult = { published: 0, generated: null, skipped: null, error: null }
  // 1) scheduled articles whose time has come
  const scheduled = await runQuery(env, { collection: 'articles', where: [{ field: 'status', op: 'EQUAL', value: 'scheduled' }], limit: 50 })
  for (const d of scheduled) {
    const publishAt = d.data.publishAt instanceof Date ? d.data.publishAt.getTime() : 0
    if (publishAt && publishAt <= now.getTime()) {
      const a = await readArticle(env, d.id)
      if (a) { await saveArticle(env, { ...a, status: 'published', publishedAt: now, updatedAt: now }, { create: false }); res.published++ }
    }
  }
  // 2) automatic writing
  const { settings, updateTime, exists } = await loadSettings(env)
  if (!settings.enabled) { res.skipped = 'automation is off'; return res }
  if (!pickProvider(env)) { res.skipped = 'no AI key configured'; return res }
  const today = dayKey(now)
  const todayCount = settings.dayKey === today ? settings.todayCount : 0
  if (todayCount >= settings.dailyMax) { res.skipped = 'daily limit reached'; return res }
  if (!settings.loop && settings.cursor >= settings.topics.length) { res.skipped = 'all topics are done'; return res } // one pass over the list, then stop (turn on "loop" to start over with new angles)
  if (settings.lastRunAt && now.getTime() - settings.lastRunAt < settings.everyHours * 3600_000 * 0.9) { res.skipped = 'not due yet'; return res }
  // claim this run first (guarded): a second cron tick that overlaps sees a fresh lastRunAt and stops
  const claimed: ArticleSettings = { ...settings, lastRunAt: now.getTime(), dayKey: today, todayCount }
  try { await commitGuarded(env, [exists ? { kind: 'upsert', path: 'articleMeta/settings', data: settingsData(claimed) } : { kind: 'create', path: 'articleMeta/settings', data: settingsData(claimed) }], { 'articleMeta/settings': updateTime }) } catch { res.skipped = 'another run is in progress'; return res }
  const t = settings.topics[settings.cursor % settings.topics.length]
  const lap = Math.floor(settings.cursor / settings.topics.length)
  try {
    const suggestions = await fetchSuggestions(t.topic)
    const item: PlanItem = { title: '', primary: t.topic, secondary: suggestions.filter((s) => s !== t.topic).slice(0, 6), angle: ANGLES[(settings.cursor + lap) % ANGLES.length], audience: AUDIENCES[settings.cursor % AUDIENCES.length] }
    const r = await writeArticle(env, { item, topic: t.topic, govId: t.govId, typeId: t.typeId, autoPublish: settings.mode === 'auto', minScore: settings.minScore, now })
    res.generated = `${r.article.slug} (${r.published ? 'منشور' : 'مسودة'}${r.why.length ? `: ${r.why.join('، ')}` : ''})`
    const after = await loadSettings(env)
    await commitGuarded(env, [{ kind: 'upsert', path: 'articleMeta/settings', data: settingsData({ ...after.settings, cursor: settings.cursor + 1, todayCount: todayCount + 1, lastResult: res.generated, lastError: '' }) }], {})
  } catch (e) {
    res.error = e instanceof HttpError ? `${e.code}: ${e.message}` : 'unexpected error'
    console.error('article cron failed', e)
    // give the slot back so the next tick retries (the topic cursor did not move)
    const after = await loadSettings(env).catch(() => null)
    if (after) await commitGuarded(env, [{ kind: 'upsert', path: 'articleMeta/settings', data: settingsData({ ...after.settings, lastRunAt: settings.lastRunAt, lastError: res.error.slice(0, 300) }) }], {}).catch(() => undefined)
  }
  return res
}
