// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BANNED_PHRASES, analyzeArticle, countPhrase, mostSimilar, similarity, type QualityInput } from './articleQuality'

const POOL = [
  'المعاينة بالنهار بتكشف عيوب مش بتبان بالليل، زي الرطوبة في الأركان وضغط المياه.',
  'اسأل الجيران عن الكهرباء والمياه والأمان بالليل، لأن إجاباتهم أصدق من أي إعلان.',
  'قارن بين ثلاث وحدات على الأقل قبل ما تقرر، وخلّي المقارنة على نفس المواصفات والدور.',
  'اطلب صور للعداد والسباكة، وافتح كل الحنفيات وشوف السخان بنفسك.',
  'الشارع الرئيسي أغلى وأعلى صوتا، والشارع الجانبي أهدى لكن ممكن يبعد عن المواصلات.',
  'الإيجار الشهري بيتأثر بالتشطيب والدور والمصعد أكتر من تأثره بعمر العمارة.',
  'اكتب كل اتفاق في العقد حتى لو كان بسيط، لأن الكلام الشفوي بيتنسي مع الوقت.',
  'ابدأ بميزانية واضحة، واحسب معاها تكلفة المواصلات والكهرباء والإنترنت.',
]
const para = (i: number) => [0, 1, 2, 3].map((k) => POOL[(i + k * 3) % POOL.length]).join(' ') + ` (${i})`
const body = (n = 30, extra = '') => ['شقق للايجار في مدينة نصر مش بس سعر، دي حياة يومية كاملة: مواصلات ومدارس وصيدليات. هنا هتلاقي الصورة الواضحة قبل ما تتحرك. [ابحث دلوقتي](/search)', '', ...Array.from({ length: 6 }, (_, k) => [`## ${['أرخص مناطق', 'سؤال عن الدور', 'شقق للايجار في مدينة نصر للعرسان', 'نصيحة قبل المعاينة', 'خطأ بيكلف كتير', 'ازاي تفاوض'][k]}`, ...Array.from({ length: 5 }, (_, j) => para(k * 5 + j))].join('\n\n') + '\n'), ...Array.from({ length: Math.max(0, n - 30) }, (_, i) => para(200 + i)), 'وفي النهاية، لو بتدور على شقق للايجار في مدينة نصر فابدأ بالمعاينة وقارن، وشوف [شقق القاهرة](/rent/cairo) كمان.', extra].join('\n')
const good = (over: Partial<QualityInput> = {}): QualityInput => ({
  title: 'شقق للايجار في مدينة نصر: دليل عملي قبل ما تدفع', description: 'كل اللي محتاج تعرفه عن شقق للايجار في مدينة نصر: الأسعار التقريبية، أفضل الشوارع، وإزاي تعاين الشقة وتتفاوض صح قبل ما توقّع.',
  slug: 'شقق-للايجار-في-مدينة-نصر', body: body(30), primary: 'شقق للايجار في مدينة نصر', secondary: ['مواصلات', 'المعاينة'],
  faq: [{ q: 'س1', a: 'ج1' }, { q: 'س2', a: 'ج2' }, { q: 'س3', a: 'ج3' }], images: [{ alt: 'شارع في مدينة نصر' }], ...over,
})

describe('analyzeArticle', () => {
  it('a well-formed article scores high with few or no issues', () => {
    const q = analyzeArticle(good())
    expect(q.score).toBeGreaterThanOrEqual(85)
    expect(q.stats.h2).toBeGreaterThanOrEqual(5); expect(q.stats.internalLinks).toBeGreaterThanOrEqual(2)
    expect(q.stats.banned).toEqual([])
  })
  it('flags a title and description without the main keyword, in Arabic', () => {
    const q = analyzeArticle(good({ title: 'دليل شامل للمستأجرين الجدد في القاهرة الكبرى', description: 'وصف عام جدا مش فيه الكلمة المهمة بس طوله مناسب لمحركات البحث ويحتوي على كلام كتير كفاية عشان يعدي الحد الأدنى للطول المطلوب.' }))
    expect(q.issues.some((i) => i.includes('العنوان لا يحتوي'))).toBe(true); expect(q.issues.some((i) => i.includes('الوصف لا يحتوي'))).toBe(true)
    expect(q.score).toBeLessThan(85)
  })
  it('flags short articles', () => { const q = analyzeArticle(good({ body: 'شقق للايجار في مدينة نصر.\n\n## عنوان\nنص قصير.' })); expect(q.issues.some((i) => i.includes('قصير'))).toBe(true); expect(q.score).toBeLessThan(60) })
  it('detects keyword stuffing', () => {
    const stuffed = good({ body: `${body(30)}\n\n${'شقق للايجار في مدينة نصر '.repeat(120)}` })
    const q = analyzeArticle(stuffed)
    expect(q.stats.density).toBeGreaterThan(2.5); expect(q.issues.some((i) => i.includes('متكررة بزيادة'))).toBe(true)
  })
  it('detects machine-sounding stock phrases and lists them', () => {
    const q = analyzeArticle(good({ body: `${body(30)}\n\nفي عالمنا اليوم لا شك أن الإيجار مهم. في الختام، من الجدير بالذكر أن الشقق تعد من أهم الاستثمارات.` }))
    expect(q.stats.banned.length).toBeGreaterThanOrEqual(3); expect(q.issues.some((i) => i.includes('مكتوبة آليًا'))).toBe(true)
  })
  it('wants internal links, FAQ, alt text and several headings', () => {
    const q = analyzeArticle(good({ body: body(30).replace(/\]\(\/[^)]*\)/g, ']()'), faq: [], images: [{ alt: '' }, { alt: ' ' }] }))
    for (const part of ['روابط داخلية', 'الأسئلة الشائعة', 'من غير وصف']) expect(q.issues.some((i) => i.includes(part))).toBe(true)
  })
  it('flags repetitive heading patterns and duplicate headings', () => {
    const b = ['شقق للايجار في مدينة نصر هنا.', ...['كيف تجد', 'كيف تختار', 'كيف تعاين', 'كيف تفاوض'].map((h) => `## ${h}\n\n${para(1)} ${para(2)}`)].join('\n\n')
    expect(analyzeArticle(good({ body: b })).issues.some((i) => i.includes('بتبدأ بنفس الكلمة'))).toBe(true)
    expect(analyzeArticle(good({ body: `${body(30)}\n\n## أرخص مناطق\n\nنص` })).issues.some((i) => i.includes('مكررة'))).toBe(true)
  })
  it('score is always within 0..100 and never throws on empty input', () => {
    const q = analyzeArticle({ title: '', description: '', slug: '', body: '', primary: '', secondary: [], faq: [], images: [] })
    expect(q.score).toBeGreaterThanOrEqual(0); expect(q.score).toBeLessThanOrEqual(100)
  })
  it('hamza and diacritics do not hide the keyword', () => { expect(countPhrase('شقق للإيجار في مدينة نصر', 'شقق للايجار')).toBe(1); expect(countPhrase('شُقَق لِلإِيجَار', 'شقق للايجار')).toBe(1) })
  it('the banned list is long enough to matter and has no duplicates', () => { expect(BANNED_PHRASES.length).toBeGreaterThan(15); expect(new Set(BANNED_PHRASES).size).toBe(BANNED_PHRASES.length) })
})

describe('similarity', () => {
  const a = body(30)
  it('identical text is 1, unrelated text is near 0', () => {
    expect(similarity(a, a)).toBe(1)
    expect(similarity(a, 'نص مختلف تماما عن التأمين والمطالبات والتسوية بعد انتهاء العقد وإجراءات الاسترداد والمواعيد')).toBeLessThan(0.05)
  })
  it('a light re-wording of the same article is caught; a different angle on the same topic is not', () => {
    const reworded = a.replace(/قبل ما تقرر/g, 'قبل القرار')
    expect(similarity(a, reworded)).toBeGreaterThan(0.5)
    const angle = ['## زاوية تانية', 'عائلة صغيرة بتدور على شقة هادية جنب مدرسة، وبتحسب الميزانية بالشهر والسنة وبتسأل الجيران عن الكهرباء والمياه والأمان بالليل.', 'الأسعار بتختلف بحسب الدور والتشطيب، فالمقارنة الصح بتكون على نفس المواصفات وبنفس الفترة من السنة.'].join('\n\n')
    expect(similarity(a, angle)).toBeLessThan(0.2)
  })
  it('is symmetric and safe on empty strings', () => { expect(similarity(a, 'جزء من النص')).toBe(similarity('جزء من النص', a)); expect(similarity('', a)).toBe(0); expect(similarity('', '')).toBe(0) })
  it('mostSimilar finds the closest existing article', () => {
    const r = mostSimilar(a, [{ slug: 'x', body: 'كلام مختلف تماما عن موضوع تاني خالص ومفيهوش حاجة مشتركة' }, { slug: 'y', body: a.replace('تجربة', 'خبرة') }])
    expect(r?.slug).toBe('y'); expect(r?.score).toBeGreaterThan(0.5); expect(mostSimilar(a, [])).toBeNull()
  })
})

import { minhash, sigSimilarity } from './articleQuality'
describe('minhash fingerprints', () => {
  const a = body(30)
  it('are deterministic, 64 numbers, and empty for empty text', () => {
    expect(minhash(a)).toEqual(minhash(a)); expect(minhash(a)).toHaveLength(64); expect(minhash('')).toEqual([])
  })
  it('estimate the real similarity well enough to catch duplicates and ignore different angles', () => {
    expect(sigSimilarity(minhash(a), minhash(a))).toBe(1)
    const reworded = a.replace(/قبل ما تقرر/g, 'قبل القرار')
    expect(Math.abs(sigSimilarity(minhash(a), minhash(reworded)) - similarity(a, reworded))).toBeLessThan(0.2)
    expect(sigSimilarity(minhash(a), minhash('عائلة صغيرة بتدور على شقة هادية جنب مدرسة وبتحسب الميزانية بالشهر والسنة وبتسأل الجيران عن الكهرباء والمياه والأمان بالليل والمواصلات القريبة والأسواق'))).toBeLessThan(0.15)
  })
  it('refuses to compare fingerprints of the wrong size', () => { expect(sigSimilarity([1, 2], [1, 2])).toBe(0); expect(sigSimilarity([], minhash(a))).toBe(0) })
})
