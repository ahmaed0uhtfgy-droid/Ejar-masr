/** Everything about asking an AI to plan and write articles: provider calls, the Arabic writing brief, and strict validation of what comes back. */
import type { Env } from './env'
import { HttpError } from './http'
import { BANNED_PHRASES } from './articleQuality'
import type { Snapshot } from './listings'
import { GOVS } from './seo'

export type Provider = 'anthropic' | 'gemini'
export interface ProviderInfo { provider: Provider; model: string; key: string }

export function pickProvider(env: Env): ProviderInfo | null {
  const want = (env.AI_PROVIDER ?? '').toLowerCase()
  const gem = env.GEMINI_API_KEY; const ant = env.ANTHROPIC_API_KEY
  const provider: Provider | null = want === 'anthropic' && ant ? 'anthropic' : want === 'gemini' && gem ? 'gemini' : gem ? 'gemini' : ant ? 'anthropic' : null
  if (!provider) return null
  return provider === 'gemini' ? { provider, model: env.AI_MODEL || 'gemini-3.8-flash', key: gem as string } : { provider, model: env.AI_MODEL || 'claude-sonnet-5-5', key: ant as string }
}

/** Opt-in (AI_THINKING): slow "thinking" models can spend most of the time limit before writing a word. Unset = send nothing extra. */
function thinkingConfig(env: Env): { thinkingConfig?: Record<string, unknown> } {
  const v = (env.AI_THINKING ?? '').trim().toLowerCase()
  if (!v) return {}
  if (/^\d+$/.test(v)) return { thinkingConfig: { thinkingBudget: Number(v) } }
  if (['minimal', 'low', 'medium', 'high'].includes(v)) return { thinkingConfig: { thinkingLevel: v } }
  return {}
}

const TIMEOUT_MS = 85_000 // Cloudflare closes a request after ~100 s

/** One model call. Returns the model's text. Never exposes the provider's error body or the key. */
/** AI_TIMEOUT_SECONDS (30-280) or the 85 s default. */
function waitMs(env: Env): number {
  const n = Number(env.AI_TIMEOUT_SECONDS)
  return Number.isFinite(n) && n >= 30 ? Math.min(280, Math.round(n)) * 1000 : TIMEOUT_MS
}

/** One automatic retry for a busy provider (429 / 500 / 503): these usually clear in seconds, and a retry saves a wasted scheduler slot. */
export async function callLLM(env: Env, o: { system: string; user: string; maxTokens: number; temperature?: number; timeoutMs?: number }): Promise<string> {
  try { return await callOnce(env, o) } catch (e) {
    if (e instanceof HttpError && e.code === 'ai' && /\((429|500|503)\)/.test(e.message)) { await new Promise((r) => setTimeout(r, 3000)); return callOnce(env, o) }
    throw e
  }
}

async function callOnce(env: Env, o: { system: string; user: string; maxTokens: number; temperature?: number; timeoutMs?: number }): Promise<string> {
  const p = pickProvider(env)
  if (!p) throw new HttpError(503, 'ai-not-configured', 'مفيش مفتاح AI مضبوط. ضيف GEMINI_API_KEY أو ANTHROPIC_API_KEY في Cloudflare')
  const started = Date.now()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? waitMs(env))
  try {
    const res = p.provider === 'anthropic'
      ? await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: p.model, max_tokens: o.maxTokens, temperature: o.temperature ?? 0.8, system: o.system, messages: [{ role: 'user', content: o.user }] }) })
      : await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': p.key }, body: JSON.stringify({ systemInstruction: { parts: [{ text: o.system }] }, contents: [{ role: 'user', parts: [{ text: o.user }] }], generationConfig: { temperature: o.temperature ?? 0.8, maxOutputTokens: o.maxTokens, responseMimeType: 'application/json', ...thinkingConfig(env) } }) })
    if (!res.ok) {
      console.error('ai provider error', p.provider, res.status)
      // Admin-only endpoints: show the provider's own short reason (e.g. API_KEY_INVALID, RESOURCE_EXHAUSTED, model not found) so a setup mistake is diagnosable. The key itself is always redacted.
      let why = ''
      try {
        const j = (await res.json()) as { error?: { status?: string; type?: string; message?: string } | string }
        const e = typeof j.error === 'object' && j.error ? j.error : null
        why = [e?.status ?? e?.type, e?.message].filter(Boolean).join(': ').split(p.key).join('***').replace(/\s+/g, ' ').slice(0, 200)
      } catch { /* no readable body */ }
      throw new HttpError(502, 'ai', `مزوّد الـ AI رجّع خطأ (${res.status})${why ? `: ${why}` : ''}`)
    }
    const j = (await res.json()) as Record<string, unknown>
    const text = p.provider === 'anthropic'
      ? ((j.content as { type?: string; text?: string }[] | undefined) ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('')
      : (((j.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined)?.[0]?.content?.parts) ?? []).map((x) => x.text ?? '').join('')
    if (!text.trim()) throw new HttpError(502, 'ai-empty', 'مزوّد الـ AI رجّع رد فاضي')
    return text
  } catch (e) {
    if (e instanceof HttpError) throw e
    const err = e as { name?: string; message?: string }
    console.error('ai call failed', p.provider, p.model, err.name, err.message)
    if (err.name === 'AbortError') throw new HttpError(504, 'ai-timeout', `مزوّد الـ AI (${p.model}) ما ردّش خلال ${Math.round((Date.now() - started) / 1000)} ثانية. جرّب موديل أسرع بإضافة AI_MODEL في Cloudflare`)
    throw new HttpError(504, 'ai-network', `فشل الاتصال بمزوّد الـ AI أو قراءة رده (${err.name ?? 'Error'}: ${String(err.message ?? '').split(p.key).join('***').slice(0, 120)})`)
  } finally { clearTimeout(timer) }
}

// ---------- search suggestions (what people actually type into Google) ----------
/** Google's own autocomplete: phrases real people search for, ordered by popularity. Unofficial but free; any failure just returns nothing. */
export async function fetchSuggestions(seed: string): Promise<string[]> {
  const out: string[] = []
  for (const q of [seed, `${seed} في`, `${seed} ب`]) {
    try {
      const res = await fetch(`https://suggestqueries.google.com/complete/search?${new URLSearchParams({ client: 'firefox', hl: 'ar', gl: 'eg', q }).toString()}`)
      if (!res.ok) continue
      const j = (await res.json()) as unknown
      const list = Array.isArray(j) && Array.isArray(j[1]) ? (j[1] as unknown[]) : []
      for (const s of list) if (typeof s === 'string' && s.length >= 4 && s.length <= 80 && !out.includes(s)) out.push(s)
    } catch { /* offline or blocked: carry on without suggestions */ }
  }
  return out.slice(0, 20)
}

// ---------- facts from the site's own data ----------
export interface Facts { total: number; inScope: number; monthly: { min: number; median: number; max: number } | null; byType: { id: string; count: number }[]; areas: { name: string; count: number }[]; govName?: string }
export function snapshotFacts(snap: Snapshot, govId?: string, typeId?: string): Facts {
  const scope = snap.units.filter((u) => (!govId || u.data.governorateId === govId) && (!typeId || u.data.typeId === typeId))
  const prices = scope.filter((u) => u.data.rentType === 'monthly').map((u) => Number(u.data.price)).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b)
  const count = (key: string): Map<string, number> => { const m = new Map<string, number>(); for (const u of scope) { const v = String(u.data[key] ?? ''); if (v) m.set(v, (m.get(v) ?? 0) + 1) } return m }
  const top = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
  return {
    total: snap.units.length, inScope: scope.length,
    monthly: prices.length ? { min: prices[0], median: prices[Math.floor((prices.length - 1) / 2)], max: prices[prices.length - 1] } : null,
    byType: top(count('typeName'), 4).map(([id, c]) => ({ id, count: c })), areas: top(count('areaName'), 5).map(([name, c]) => ({ name, count: c })),
    govName: GOVS.find((g) => g.id === govId)?.name,
  }
}
export function factsText(f: Facts): string {
  const where = f.govName ? ` في ${f.govName}` : ''
  const lines = [`عدد الوحدات المتاحة حاليًا على الموقع${where}: ${f.inScope} (من ${f.total} وحدة في كل مصر).`]
  if (f.monthly) lines.push(`الإيجار الشهري${where} على الموقع الآن: من ${f.monthly.min} إلى ${f.monthly.max} جنيه، والوسيط حوالي ${f.monthly.median} جنيه.`)
  if (f.byType.length) lines.push(`أكتر الأنواع المتاحة: ${f.byType.map((t) => `${t.id} (${t.count})`).join('، ')}.`)
  if (f.areas.length) lines.push(`أكتر المناطق فيها إعلانات: ${f.areas.map((a) => `${a.name} (${a.count})`).join('، ')}.`)
  if (f.inScope === 0) lines.push('لا توجد وحدات منشورة في هذا النطاق حاليًا: لا تذكر أي أرقام أسعار أو أعداد.')
  return lines.join('\n')
}

// ---------- the writing brief ----------
export const WRITER_SYSTEM = `أنت كاتب محتوى عقاري مصري محترف بتكتب لموقع «إيجار مصر» (إيجار شقق وغرف وفيلل ومحلات في كل المحافظات). جمهورك ناس عادية بتدور على سكن: مستأجرين، عرسان، طلاب، موظفين، وملاك.

أسلوب الكتابة:
- فصحى مبسطة بروح مصرية دافئة، من غير عامية تقيلة ولا تكلّف. اكتب كأنك صديق خبرة بيحكي، بجمل قصيرة ومتوسطة وإيقاع متنوع.
- ابدأ بمشهد أو سؤال أو موقف حقيقي من حياة الباحث عن سكن، مش بتعريف عام.
- العناوين الفرعية متنوعة الصياغة: بعضها سؤال، بعضها جملة خبرية، بعضها فيه رقم أو وعد عملي. ممنوع تكرار نفس الشكل، وممنوع عنوانين بيبدأوا بنفس الكلمة.
- فقرات قصيرة (2 إلى 4 جمل). القوائم النقطية في موضعين على الأكثر، ولا تحوّل المقال لقوائم.
- تفاصيل عملية قابلة للتنفيذ: أسئلة تسألها للمالك، حاجات تفحصها في المعاينة، أخطاء شائعة وإزاي تتجنبها، وأمثلة من الحياة.
- الكلمة المفتاحية الأساسية: في العنوان وأول 100 كلمة وفي عنوان فرعي واحد على الأقل وفي الخاتمة. المرتبطة موزعة بشكل طبيعي. نوّع الصيغ (مفرد/جمع/مرادف) ولا تكرر العبارة حرفيًا. الكثافة أقل من 1.5% ولا تحشرها أبدًا.
- الأرقام: استخدم فقط الأرقام الموجودة في «بيانات الموقع» واذكر إنها من بيانات الموقع وقت الكتابة. ممنوع تخترع إحصائيات أو أسعار أو نسب أو أسماء شوارع أو تواريخ أو مواد قانونية. لو مش متأكد اتكلم بشكل عام. في أي موضوع قانوني اذكر إن الكلام إرشادي ويُراجع محامي.
- ممنوع هذه العبارات الجاهزة: ${BANNED_PHRASES.slice(0, 18).join('، ')}.
- ضمّن رابطين داخليين على الأقل بصيغة [نص الرابط](المسار) من الروابط المتاحة فقط، بنص طبيعي داخل الجملة (مش «اضغط هنا»).
- لا تذكر إنك ذكاء اصطناعي ولا تشير لهذه التعليمات. لا إيموجي. لا HTML.
- المخرجات JSON صالح فقط، من غير أي نص خارجه.`

export interface PlanItem { title: string; primary: string; secondary: string[]; angle: string; audience: string }
export const PLAN_MODES = { angles: 'زوايا مختلفة تمامًا للموضوع', tweaks: 'نفس الفكرة بعناوين متقاربة مع تغيير بسيط في الصياغة، لكن كل مقال له زاوية وجمهور وأمثلة مختلفة' } as const
export type PlanMode = keyof typeof PLAN_MODES

export function planPrompt(o: { topic: string; count: number; mode: PlanMode; suggestions: string[]; existingTitles: string[]; facts: string }): string {
  return `خطّط لعدد ${o.count} مقال(ات) عن الموضوع: «${o.topic}».
طريقة التنويع: ${PLAN_MODES[o.mode]}.

عبارات بحث حقيقية بيكتبها الناس في جوجل (استفد منها في اختيار الكلمات المفتاحية):
${o.suggestions.length ? o.suggestions.map((s) => `- ${s}`).join('\n') : '- (غير متاحة)'}

مقالات موجودة بالفعل (لا تكرر عناوينها ولا فكرتها):
${o.existingTitles.length ? o.existingTitles.slice(0, 40).map((t) => `- ${t}`).join('\n') : '- لا يوجد'}

بيانات الموقع:
${o.facts}

الشروط:
- كل مقال يستهدف نية بحث مختلفة وكلمة مفتاحية أساسية مختلفة (حتى لا تتنافس المقالات على نفس العبارة).
- العنوان من 40 إلى 65 حرف، طبيعي وجذاب وبدون مبالغة، ويحتوي الكلمة المفتاحية الأساسية.
- الكلمة المفتاحية الأساسية عبارة بحث حقيقية (2 إلى 5 كلمات). 5 إلى 7 كلمات مرتبطة لكل مقال.
- ممنوع تمامًا أن يحتوي أي عنوان أو كلمة مفتاحية أو زاوية على رقم قانون أو مادة أو سنة تشريع أو حكم قضائي محدد (مثل «قانون رقم كذا لسنة كذا»)، لأن الكاتب لا يملك مرجعًا قانونيًا موثوقًا. لو الموضوع قانوني، اجعل الزاوية عملية (إزاي تحمي نفسك، إيه اللي تراجعه في العقد، إيه الأسئلة اللي تسألها لمحامي) وليس شرح نصوص قانون بعينه.

أخرج JSON بهذا الشكل فقط:
{"articles":[{"title":"","primary_keyword":"","secondary_keywords":[""],"angle":"الزاوية في جملة","audience":"الجمهور المستهدف"}]}`
}

export interface WriteCtx { item: PlanItem; topic: string; facts: string; links: { path: string; hint: string }[]; siblings: string[]; today: string }
export function writePrompt(c: WriteCtx): string {
  return `اكتب مقالًا كاملًا بهذه المواصفات:
${c.item.title ? `العنوان المقترح: ${c.item.title}` : 'العنوان: اختر عنوانًا جذابًا وطبيعيًا من 40 إلى 65 حرف يحتوي الكلمة المفتاحية الأساسية'}
الكلمة المفتاحية الأساسية: ${c.item.primary}
الكلمات المرتبطة: ${c.item.secondary.join('، ')}
الزاوية: ${c.item.angle}
الجمهور: ${c.item.audience}
الموضوع العام: ${c.topic}
تاريخ الكتابة: ${c.today}

مقالات أخرى على الموقع (لا تكرر محتواها، ويمكن الإشارة لها بروابطها لو مناسب):
${c.siblings.length ? c.siblings.slice(0, 12).join('\n') : '- لا يوجد'}

الروابط الداخلية المتاحة (استخدمها فقط):
${c.links.map((l) => `- ${l.path} : ${l.hint}`).join('\n')}

بيانات الموقع:
${c.facts}

تنبيه صارم: لا تذكر رقم قانون أو مادة أو سنة تشريع أو غرامة أو حكم قضائي محدد حتى لو العنوان المقترح يلمّح لذلك. اشرح الفكرة عمليًا وبشكل عام، وانصح بمراجعة محامي في أي نقطة قانونية.

الهيكل المطلوب (من 1000 إلى 1400 كلمة):
- مقدمة من فقرتين أو ثلاث.
- من 5 إلى 7 أقسام، كل قسم له عنوان مختلف الصياغة، وبعضها فيه قسم فرعي. 
- خاتمة بعنوان طبيعي (مش «الخلاصة» دائمًا).
- 4 أسئلة شائعة بإجابات من جملتين أو ثلاث، وصياغة الأسئلة كما يكتبها الناس في البحث.
- وصف للمقال (meta description) من 130 إلى 155 حرف فيه الكلمة الأساسية وفائدة واضحة.

أخرج JSON بهذا الشكل فقط:
{"title":"","description":"","intro":["فقرة","فقرة"],"sections":[{"heading":"","paragraphs":["",""],"bullets":[],"sub":[{"heading":"","paragraphs":[""]}]}],"conclusion":{"heading":"","paragraphs":[""]},"faq":[{"q":"","a":""}]}`
}

// ---------- reading the model's answer ----------
export class AiFormatError extends Error { constructor(m: string) { super(m); this.name = 'AiFormatError' } }

export function parseModelJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '').trim()
  const a = t.indexOf('{'); const b = t.lastIndexOf('}')
  if (a < 0 || b <= a) throw new AiFormatError('no json object')
  const raw = t.slice(a, b + 1)
  try { return JSON.parse(raw) } catch { /* try the common repair: trailing commas */ }
  try { return JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')) } catch { throw new AiFormatError('invalid json') }
}

/** Plain text only: no tags, no images, no template markers, no stray markdown headings. */
export function clean(s: unknown, max = 2000): string {
  return (typeof s === 'string' ? s : '').replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/(^|\s)#{1,6}\s+/g, '$1').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim().slice(0, max)
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown, max: number, each = 1200): string[] => arr(v).map((x) => clean(x, each)).filter(Boolean).slice(0, max)

export function validatePlan(raw: unknown, count: number): PlanItem[] {
  const items = arr((raw as { articles?: unknown } | null)?.articles).flatMap((x): PlanItem[] => {
    const o = (x ?? {}) as Record<string, unknown>
    const title = clean(o.title, 120); const primary = clean(o.primary_keyword, 60)
    if (title.length < 15 || primary.length < 3) return []
    return [{ title, primary, secondary: strs(o.secondary_keywords, 8, 60), angle: clean(o.angle, 200), audience: clean(o.audience, 120) }]
  })
  const seen = new Set<string>()
  const unique = items.filter((i) => { const k = i.title.replace(/\s+/g, ' '); if (seen.has(k)) return false; seen.add(k); return true })
  if (!unique.length) throw new AiFormatError('empty plan')
  return unique.slice(0, count)
}

export interface Written { title: string; description: string; body: string; faq: { q: string; a: string }[] }
export function validateArticle(raw: unknown): Written {
  const o = (raw ?? {}) as Record<string, unknown>
  const title = clean(o.title, 120); const description = clean(o.description, 200)
  const intro = strs(o.intro, 4)
  const sections = arr(o.sections).flatMap((s) => {
    const x = (s ?? {}) as Record<string, unknown>
    const heading = clean(x.heading, 120); const paragraphs = strs(x.paragraphs, 6)
    if (!heading || !paragraphs.length) return []
    const sub = arr(x.sub).flatMap((y) => { const z = (y ?? {}) as Record<string, unknown>; const h = clean(z.heading, 120); const p = strs(z.paragraphs, 4); return h && p.length ? [{ heading: h, paragraphs: p }] : [] }).slice(0, 3)
    return [{ heading, paragraphs, bullets: strs(x.bullets, 8, 300), sub }]
  }).slice(0, 9)
  const conclusion = (o.conclusion ?? {}) as Record<string, unknown>
  const cHead = clean(conclusion.heading, 120); const cPars = strs(conclusion.paragraphs, 3)
  const faq = arr(o.faq).flatMap((f) => { const x = (f ?? {}) as Record<string, unknown>; const q = clean(x.q, 200); const a = clean(x.a, 700); return q.length > 8 && a.length > 15 ? [{ q, a }] : [] }).slice(0, 8)
  if (title.length < 15) throw new AiFormatError('title missing')
  if (description.length < 60) throw new AiFormatError('description missing')
  if (!intro.length) throw new AiFormatError('intro missing')
  if (sections.length < 4) throw new AiFormatError('too few sections')
  if (!cHead || !cPars.length) throw new AiFormatError('conclusion missing')
  const lines: string[] = [...intro.flatMap((p) => [p, ''])]
  for (const s of sections) {
    lines.push(`## ${s.heading}`, '', ...s.paragraphs.flatMap((p) => [p, '']))
    if (s.bullets.length) lines.push(...s.bullets.map((b) => `- ${b}`), '')
    for (const sub of s.sub) lines.push(`### ${sub.heading}`, '', ...sub.paragraphs.flatMap((p) => [p, '']))
  }
  lines.push(`## ${cHead}`, '', ...cPars.flatMap((p) => [p, '']))
  return { title, description, body: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), faq }
}

/** Puts image markers after every second section (after the 2nd, 4th, ...), up to `count` images. Idempotent: existing markers are kept. */
export function autoPlaceImages(md: string, count: number): string {
  if (count <= 0 || /\{\{image:\d+\}\}/.test(md)) return md
  const parts = md.split(/\n(?=## )/)
  let placed = 0
  return parts.map((part, i) => (i > 0 && i % 2 === 0 && placed < count ? `${part.trimEnd()}\n\n{{image:${++placed}}}\n` : part)).join('\n')
}

export function defaultLinks(govSlug?: string, govName?: string, typeId?: string, typeLabel?: string): { path: string; hint: string }[] {
  const out = [{ path: '/search', hint: 'صفحة البحث عن وحدات للإيجار في كل مصر' }]
  if (govSlug && govName) out.push({ path: `/rent/${govSlug}`, hint: `كل الوحدات المتاحة للإيجار في ${govName}` })
  if (govSlug && govName && typeId && typeLabel) out.push({ path: `/rent/${govSlug}/${typeId}`, hint: `${typeLabel} للإيجار في ${govName}` })
  out.push({ path: '/blog', hint: 'مقالات ونصائح الإيجار' })
  return out
}
