/** Quality gate for articles (shown to the admin as a checklist, and used to decide whether auto-publish is allowed) and a duplicate detector. */
import { normalizeArabic, plainText, wordCount } from './articleText'

/** Stock phrases that make Arabic text read as machine-written. The writing prompt forbids them and the checker penalises them. */
export const BANNED_PHRASES = [
  'في عالمنا اليوم', 'في عصرنا الحالي', 'في عصرنا الحديث', 'في ظل التطور', 'لا شك أن', 'مما لا شك فيه', 'لا يخفى على أحد', 'من الجدير بالذكر', 'ومن الجدير بالذكر',
  'يعد من أهم', 'تعد من أهم', 'يعتبر من أهم', 'تعتبر من أبرز', 'في الختام', 'خلاصة القول', 'سنتناول في هذا المقال', 'في هذا المقال سوف', 'في هذا المقال سنتعرف', 'دعونا نتعرف',
  'رحلة البحث', 'حجر الزاوية', 'بلا منازع', 'لا غنى عنه', 'كما أسلفنا', 'عالم من الفرص', 'ثورة حقيقية', 'يمثل نقطة تحول',
]

export interface QualityInput {
  title: string; description: string; slug: string; body: string; primary: string; secondary: string[]
  faq: { q: string; a: string }[]; images: { alt: string }[]
}
export interface Quality {
  score: number
  issues: string[]
  stats: { words: number; h2: number; density: number; primaryCount: number; internalLinks: number; banned: string[] }
}

const norm = (s: string): string => normalizeArabic(s).toLowerCase()
export function countPhrase(text: string, phrase: string): number {
  const p = norm(phrase).trim()
  if (!p) return 0
  return norm(text).split(p).length - 1
}

/** 0-100 score plus a list of concrete, Arabic, fixable problems. */
export function analyzeArticle(a: QualityInput): Quality {
  const issues: string[] = []
  let score = 100
  const hit = (pts: number, msg: string) => { score -= pts; issues.push(msg) }
  const text = plainText(a.body)
  const words = wordCount(a.body)
  const primary = a.primary.trim()
  const pWords = Math.max(1, primary.split(/\s+/).filter(Boolean).length)
  const headings = [...a.body.matchAll(/^(#{2,3})\s+(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].replace(/\*\*/g, '').trim() }))
  const h2 = headings.filter((h) => h.level === 2)
  const firstWords = text.split(' ').slice(0, 120).join(' ')
  const primaryCount = countPhrase(text, primary)
  const density = words ? Math.round(((primaryCount * pWords) / words) * 1000) / 10 : 0
  const links = [...a.body.matchAll(/\]\((\/[^)\s]*)\)/g)].length
  const bannedHits = BANNED_PHRASES.filter((b) => norm(text).includes(norm(b)))

  if (a.title.length < 25 || a.title.length > 70) hit(8, `طول العنوان ${a.title.length} حرف. الأفضل بين 25 و70`)
  if (primary && !countPhrase(a.title, primary)) hit(12, 'العنوان لا يحتوي على الكلمة المفتاحية الأساسية')
  if (a.description.length < 110 || a.description.length > 165) hit(6, `الوصف ${a.description.length} حرف. الأفضل بين 110 و165`)
  if (primary && !countPhrase(a.description, primary)) hit(6, 'الوصف لا يحتوي على الكلمة المفتاحية الأساسية')
  const slugHit = primary ? primary.split(/\s+/).filter((w) => w.length > 2 && norm(a.slug).includes(norm(w))).length : 0
  if (primary && slugHit < Math.ceil(primary.split(/\s+/).filter((w) => w.length > 2).length * 0.6)) hit(6, 'رابط المقال لا يحتوي على كلمات الكلمة المفتاحية')
  if (words < 700) hit(20, `المقال قصير (${words} كلمة). الأفضل 900 كلمة أو أكثر`)
  else if (words < 900) hit(8, `المقال ${words} كلمة. الأفضل 900 أو أكثر`)
  else if (words > 2200) hit(5, `المقال طويل (${words} كلمة)`)
  if (h2.length < 4) hit(10, `عدد العناوين الرئيسية ${h2.length}. الأفضل 5 أو أكثر`)
  if (new Set(headings.map((h) => norm(h.text))).size < headings.length) hit(5, 'فيه عناوين مكررة')
  const starts = new Map<string, number>()
  for (const h of h2) { const w = norm(h.text).split(' ')[0]; starts.set(w, (starts.get(w) ?? 0) + 1) }
  if ([...starts.values()].some((n) => n >= 3)) hit(4, 'عناوين كتير بتبدأ بنفس الكلمة. نوّع الصياغة')
  if (primary && !countPhrase(firstWords, primary)) hit(8, 'الكلمة المفتاحية مش موجودة في أول 120 كلمة')
  if (primary && !h2.some((h) => countPhrase(h.text, primary))) hit(5, 'الكلمة المفتاحية مش موجودة في أي عنوان فرعي')
  if (density > 2.5) hit(10, `الكلمة المفتاحية متكررة بزيادة (${density}%). المطلوب أقل من 2%`)
  else if (density > 1.8) hit(4, `تكرار الكلمة المفتاحية عالي (${density}%)`)
  else if (primary && primaryCount < 3) hit(6, 'الكلمة المفتاحية ذُكرت أقل من 3 مرات')
  const usedSecondary = a.secondary.filter((k) => countPhrase(text, k) > 0).length
  if (a.secondary.length >= 2 && usedSecondary < Math.ceil(a.secondary.length / 2)) hit(5, 'أقل من نص الكلمات المرتبطة مستخدمة في النص')
  if (bannedHits.length) hit(Math.min(20, bannedHits.length * 4), `عبارات تبان مكتوبة آليًا: ${bannedHits.slice(0, 4).join('، ')}`)
  if (links < 2) hit(8, `روابط داخلية للموقع ${links}. المطلوب رابطين على الأقل`)
  if (a.faq.length < 3) hit(5, 'الأسئلة الشائعة أقل من 3')
  const noAlt = a.images.filter((i) => !i.alt.trim()).length
  if (noAlt) hit(Math.min(9, noAlt * 3), `${noAlt} صورة من غير وصف (alt)`)
  const long = a.body.split(/\n\s*\n/).filter((p) => !/^(#|-|\d|>|\{\{)/.test(p.trim()) && wordCount(p) > 120).length
  if (long) hit(Math.min(9, long * 3), `${long} فقرة طويلة جدًا. قسّمها`)
  const sentences = text.split(/[.!؟?]+\s/).filter((s) => s.trim())
  if (sentences.length && words / sentences.length > 28) hit(4, 'الجمل طويلة بشكل عام')

  return { score: Math.max(0, score), issues, stats: { words, h2: h2.length, density, primaryCount, internalLinks: links, banned: bannedHits } }
}

// ---------- duplicate detection ----------
function shingles(text: string, n = 5): Set<string> {
  const w = norm(plainText(text)).split(' ').filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '))
  return out
}
/** 0..1: how much of the two texts is the same run of five words. Two articles on the same topic with different angles are well under 0.2. */
export function similarity(a: string, b: string): number {
  const x = shingles(a); const y = shingles(b)
  if (!x.size || !y.size) return 0
  let common = 0
  for (const s of x) if (y.has(s)) common++
  return common / (x.size + y.size - common)
}
export function mostSimilar(body: string, others: { slug: string; body: string }[]): { slug: string; score: number } | null {
  let best: { slug: string; score: number } | null = null
  for (const o of others) { const score = similarity(body, o.body); if (!best || score > best.score) best = { slug: o.slug, score: Math.round(score * 100) / 100 } }
  return best
}

// ---------- MinHash: a 64-number fingerprint per article, so duplicates can be found without reading every article body ----------
const SIG = 64
const P = 2147483647 // 2^31 - 1
const fnv = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h % P }
/** Deterministic pseudo-random coefficients (no Math.random: the same text must always give the same fingerprint). */
const COEF: [number, number][] = Array.from({ length: SIG }, (_, i) => [((i + 1) * 48271 + 11) % (P - 1) + 1, ((i + 7) * 69621 + 3) % P])
export function minhash(text: string): number[] {
  const sh = [...shingles(text)].map(fnv)
  if (!sh.length) return []
  return COEF.map(([a, b]) => { let m = P; for (const h of sh) { const v = Number((BigInt(a) * BigInt(h) + BigInt(b)) % BigInt(P)); if (v < m) m = v } return m })
}
/** Estimated Jaccard similarity of two fingerprints (0..1). */
export function sigSimilarity(a: number[], b: number[]): number {
  if (a.length !== SIG || b.length !== SIG) return 0
  let same = 0
  for (let i = 0; i < SIG; i++) if (a[i] === b[i]) same++
  return same / SIG
}
