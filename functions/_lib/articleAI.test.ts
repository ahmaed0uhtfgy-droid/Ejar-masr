// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AiFormatError, WRITER_SYSTEM, autoPlaceImages, callLLM, clean, defaultLinks, factsText, fetchSuggestions, parseModelJson, pickProvider, planPrompt, snapshotFacts, validateArticle, validatePlan, writePrompt } from './articleAI'
import { BANNED_PHRASES } from './articleQuality'
import type { Env } from './env'
import { GOVS } from './seo'

const env = (o: Partial<Env> = {}) => o as Env
afterEach(() => { vi.unstubAllGlobals() })
let calls: { url: string; init?: RequestInit; body: Record<string, unknown> }[] = []
const stubFetch = (handler: (url: string) => Response) => { calls = []; vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => { calls.push({ url: String(u), init, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} }); return handler(String(u)) }) }

describe('pickProvider', () => {
  it('uses whichever key exists, Gemini first (it has a free tier), and respects AI_PROVIDER / AI_MODEL', () => {
    expect(pickProvider(env())).toBeNull()
    expect(pickProvider(env({ GEMINI_API_KEY: 'g' }))).toMatchObject({ provider: 'gemini' })
    expect(pickProvider(env({ ANTHROPIC_API_KEY: 'a' }))).toMatchObject({ provider: 'anthropic' })
    expect(pickProvider(env({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }))?.provider).toBe('gemini')
    expect(pickProvider(env({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'anthropic' }))?.provider).toBe('anthropic')
    expect(pickProvider(env({ GEMINI_API_KEY: 'g', AI_PROVIDER: 'anthropic' }))?.provider).toBe('gemini') // asked for a provider with no key: fall back to what works
    expect(pickProvider(env({ GEMINI_API_KEY: 'g', AI_MODEL: 'my-model' }))?.model).toBe('my-model')
  })
})

describe('callLLM', () => {
  it('Anthropic: sends the key in a header (never in the URL) and returns the text blocks', async () => {
    stubFetch(() => new Response(JSON.stringify({ content: [{ type: 'text', text: '{"a":1}' }] })))
    const out = await callLLM(env({ ANTHROPIC_API_KEY: 'sk-ant-secret' }), { system: 'S', user: 'U', maxTokens: 100 })
    expect(out).toBe('{"a":1}')
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect((calls[0].init?.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret'); expect(calls[0].url).not.toContain('secret')
    expect(calls[0].body).toMatchObject({ system: 'S', max_tokens: 100, messages: [{ role: 'user', content: 'U' }] })
  })
  it('Gemini: key in a header, JSON mode, system instruction', async () => {
    stubFetch(() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"b":2}' }] } }] })))
    const out = await callLLM(env({ GEMINI_API_KEY: 'AIza-secret' }), { system: 'S', user: 'U', maxTokens: 50, temperature: 0.5 })
    expect(out).toBe('{"b":2}')
    expect(calls[0].url).toContain('generativelanguage.googleapis.com'); expect(calls[0].url).not.toContain('AIza')
    expect((calls[0].init?.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-secret')
    expect(calls[0].body).toMatchObject({ generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 50, temperature: 0.5 }, systemInstruction: { parts: [{ text: 'S' }] } })
  })
  it('tells the admin WHY the provider refused (status + reason) without ever echoing the key', async () => {
    const orig = console.error; console.error = () => {}
    stubFetch(() => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for key AIza-secret' } }), { status: 403 }))
    const e = (await callLLM(env({ GEMINI_API_KEY: 'AIza-secret' }), { system: '', user: '', maxTokens: 1 }).catch((x: unknown) => x)) as Error
    console.error = orig
    expect(e.message).toContain('403'); expect(e.message).toContain('RESOURCE_EXHAUSTED'); expect(e.message).not.toContain('AIza-secret')
  })
  it('maps failures to clean errors that never contain the key or the provider body', async () => {
    const orig = console.error; console.error = () => {}
    for (const [res, code] of [[new Response('{"error":"bad key AIza-secret"}', { status: 401 }), 'ai'], [new Response(JSON.stringify({ candidates: [] }), { status: 200 }), 'ai-empty']] as const) {
      stubFetch(() => res)
      const e = await callLLM(env({ GEMINI_API_KEY: 'AIza-secret' }), { system: '', user: '', maxTokens: 1 }).catch((x: unknown) => x as Error & { code: string })
      expect((e as { code: string }).code).toBe(code); expect(String((e as Error).message)).not.toContain('AIza-secret')
    }
    vi.stubGlobal('fetch', async () => { throw new Error('network down') })
    expect(((await callLLM(env({ GEMINI_API_KEY: 'k' }), { system: '', user: '', maxTokens: 1 }).catch((x: unknown) => x)) as { code: string }).code).toBe('ai-network')
    console.error = orig
  })
  it('refuses cleanly when no key is configured', async () => {
    expect(((await callLLM(env(), { system: '', user: '', maxTokens: 1 }).catch((x: unknown) => x)) as { code: string; status: number }).code).toBe('ai-not-configured')
  })
})

describe('fetchSuggestions', () => {
  it('returns what Google autocomplete suggests, deduplicated and bounded, and survives any failure', async () => {
    stubFetch(() => new Response(JSON.stringify(['q', ['شقق للايجار في مدينة نصر', 'شقق للايجار في مدينة نصر', 'x', 'شقق للايجار بالتجمع']])))
    expect(await fetchSuggestions('شقق للايجار')).toEqual(['شقق للايجار في مدينة نصر', 'شقق للايجار بالتجمع'])
    expect(calls).toHaveLength(3); expect(calls[0].url).toContain('hl=ar'); expect(calls[0].url).toContain('gl=eg')
    stubFetch(() => new Response('nope', { status: 429 })); expect(await fetchSuggestions('x')).toEqual([])
    vi.stubGlobal('fetch', async () => { throw new Error('offline') }); expect(await fetchSuggestions('x')).toEqual([])
    stubFetch(() => new Response('{"not":"an array"}')); expect(await fetchSuggestions('x')).toEqual([])
  })
})

describe('facts from the site data', () => {
  const cairo = GOVS.find((g) => g.slug === 'cairo')!
  const u = (id: string, over: Record<string, unknown>) => ({ id, data: { governorateId: cairo.id, rentType: 'monthly', price: 3000, typeName: 'شقة', areaName: 'مدينة نصر', ...over } })
  const snap = { builtAt: 0, truncated: false, units: [u('a', { price: 2000 }), u('b', { price: 4000 }), u('c', { price: 9000, typeName: 'فيلا', areaName: 'التجمع' }), u('d', { governorateId: 'other', price: 1 }), u('e', { rentType: 'daily', price: 800 })] }
  it('counts and prices only the requested scope, monthly rents only', () => {
    const f = snapshotFacts(snap, cairo.id)
    expect([f.total, f.inScope]).toEqual([5, 4])
    expect(f.monthly).toEqual({ min: 2000, median: 4000, max: 9000 })
    expect(f.areas[0]).toEqual({ name: 'مدينة نصر', count: 3 }); expect(f.byType[0]).toEqual({ id: 'شقة', count: 3 })
    expect(snapshotFacts(snap, cairo.id, undefined).govName).toBe(cairo.name)
  })
  it('an empty scope tells the writer NOT to quote numbers', () => {
    const t = factsText(snapshotFacts(snap, 'nowhere'))
    expect(t).toContain('0'); expect(t).toContain('لا تذكر أي أرقام')
    expect(snapshotFacts({ builtAt: 0, truncated: false, units: [] }).monthly).toBeNull()
  })
  it('the text states real numbers in Arabic', () => { const t = factsText(snapshotFacts(snap, cairo.id)); expect(t).toContain('2000'); expect(t).toContain('9000'); expect(t).toContain(cairo.name) })
})

describe('prompts', () => {
  it('the writer brief forbids stock phrases, invented facts and AI mentions, and demands JSON only', () => {
    for (const b of BANNED_PHRASES.slice(0, 18)) expect(WRITER_SYSTEM).toContain(b)
    for (const part of ['ممنوع تخترع', 'JSON صالح فقط', 'لا تذكر إنك ذكاء اصطناعي', 'رابطين داخليين', 'الكثافة أقل من 1.5%']) expect(WRITER_SYSTEM).toContain(part)
  })
  it('the plan prompt carries real search phrases, existing titles to avoid, and the chosen variation mode', () => {
    const p = planPrompt({ topic: 'شقق للايجار في القاهرة', count: 3, mode: 'tweaks', suggestions: ['شقق للايجار القاهرة الجديدة'], existingTitles: ['عنوان قديم'], facts: 'حقائق' })
    for (const part of ['عدد 3', 'شقق للايجار القاهرة الجديدة', 'عنوان قديم', 'تغيير بسيط في الصياغة', 'primary_keyword']) expect(p).toContain(part)
    expect(planPrompt({ topic: 't', count: 1, mode: 'angles', suggestions: [], existingTitles: [], facts: '' })).toContain('زوايا مختلفة تمامًا')
  })
  it('the write prompt lists only the allowed internal links and the keywords', () => {
    const w = writePrompt({ item: { title: 'ت', primary: 'شقق للايجار', secondary: ['مواصلات', 'ميزانية'], angle: 'ز', audience: 'عرسان' }, topic: 'م', facts: 'ح', links: defaultLinks('cairo', 'القاهرة', 'apartment', 'شقة'), siblings: ['- /blog/x : عنوان'], today: '2027-03-10' })
    for (const part of ['/search', '/rent/cairo', '/rent/cairo/apartment', 'شقق للايجار', 'مواصلات، ميزانية', '2027-03-10', '/blog/x']) expect(w).toContain(part)
  })
})

describe('reading the model answer', () => {
  it('parseModelJson copes with code fences, chatter around the JSON and trailing commas', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseModelJson('طبعا، ده المقال:\n{"a":[1,2,],"b":{"c":3,},}\nتحياتي')).toEqual({ a: [1, 2], b: { c: 3 } })
    for (const bad of ['', 'no json here', '{broken', '{"a": }']) expect(() => parseModelJson(bad)).toThrow(AiFormatError)
  })
  it('clean strips tags, images, template markers and headings from model text', () => {
    expect(clean('<b>مرحبا</b> ![x](http://e.com/i.png) {{image:1}} ## عنوان\n\nسطر')).toBe('مرحبا عنوان سطر')
    expect(clean(null)).toBe(''); expect(clean(42)).toBe(''); expect(clean('x'.repeat(5000), 100)).toHaveLength(100)
  })
  it('validatePlan keeps well-formed, distinct items up to the count', () => {
    const item = (t: string, p = 'شقق للايجار') => ({ title: t, primary_keyword: p, secondary_keywords: ['أ', 'ب'], angle: 'ز', audience: 'ج' })
    const r = validatePlan({ articles: [item('عنوان أول طويل كفاية للمقال'), item('عنوان أول طويل كفاية للمقال'), item('قصير'), item('عنوان ثاني طويل كفاية للمقال', 'x'), item('عنوان ثالث طويل كفاية للمقال'), null] }, 2)
    expect(r.map((x) => x.title)).toEqual(['عنوان أول طويل كفاية للمقال', 'عنوان ثالث طويل كفاية للمقال'])
    expect(() => validatePlan({ articles: [] }, 3)).toThrow(AiFormatError); expect(() => validatePlan(null, 3)).toThrow(AiFormatError)
  })
  const good = () => ({
    title: 'شقق للايجار في مدينة نصر: دليل عملي قبل التوقيع', description: 'كل اللي محتاج تعرفه عن شقق للايجار في مدينة نصر: الأسعار والمناطق وإزاي تعاين الشقة وتتفاوض صح قبل ما توقّع العقد.',
    intro: ['فقرة أولى <script>alert(1)</script>', 'فقرة تانية'], sections: Array.from({ length: 5 }, (_, i) => ({ heading: `قسم ${i}`, paragraphs: ['فقرة'], bullets: i === 1 ? ['نقطة'] : [], sub: i === 2 ? [{ heading: 'فرع', paragraphs: ['نص'] }] : [] })),
    conclusion: { heading: 'قبل ما تمشي', paragraphs: ['ختام'] }, faq: [{ q: 'سؤال طويل كفاية؟', a: 'إجابة طويلة كفاية للقبول.' }, { q: 'ق', a: 'قصير' }],
  })
  it('validateArticle builds clean markdown (sections, sub-sections, bullets, conclusion) and drops bad FAQ entries', () => {
    const w = validateArticle(good())
    expect(w.body).toContain('## قسم 0'); expect(w.body).toContain('### فرع'); expect(w.body).toContain('- نقطة'); expect(w.body).toContain('## قبل ما تمشي')
    expect(w.body).not.toContain('<script'); expect(w.faq).toHaveLength(1)
  })
  it('validateArticle rejects incomplete answers with a reason', () => {
    for (const mutate of [(g: ReturnType<typeof good>) => { g.title = 'قصير' }, (g: ReturnType<typeof good>) => { g.description = '' }, (g: ReturnType<typeof good>) => { g.intro = [] }, (g: ReturnType<typeof good>) => { g.sections = g.sections.slice(0, 2) }, (g: ReturnType<typeof good>) => { g.conclusion = { heading: '', paragraphs: [] } }]) {
      const g = good(); mutate(g); expect(() => validateArticle(g)).toThrow(AiFormatError)
    }
    expect(() => validateArticle(null)).toThrow(AiFormatError); expect(() => validateArticle('text')).toThrow(AiFormatError)
  })
})

describe('autoPlaceImages', () => {
  const md = ['مقدمة', '## أ', 'نص', '## ب', 'نص', '## ج', 'نص', '## د', 'نص', '## هـ', 'نص'].join('\n\n')
  it('places markers after every second section, up to the number of images', () => {
    const out = autoPlaceImages(md, 2)
    expect(out.match(/\{\{image:\d\}\}/g)).toEqual(['{{image:1}}', '{{image:2}}'])
    expect(out.indexOf('{{image:1}}')).toBeGreaterThan(out.indexOf('## ب') - 1); expect(out.indexOf('{{image:1}}')).toBeLessThan(out.indexOf('## د'))
    expect(autoPlaceImages(md, 9).match(/\{\{image:/g)?.length).toBeLessThanOrEqual(2)
  })
  it('does nothing for zero images, and never doubles existing markers', () => { expect(autoPlaceImages(md, 0)).toBe(md); const once = autoPlaceImages(md, 2); expect(autoPlaceImages(once, 2)).toBe(once) })
})
