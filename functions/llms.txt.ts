import { BRAND, BRAND_EN } from '../src/lib/brand'
import { loadDirectory } from './_lib/articleStore'
import type { Env } from './_lib/env'
import { siteUrl } from './_lib/env'

/**
 * /llms.txt - a plain-text map of the site for AI tools (the proposed llmstxt.org format: title, one-line summary, then link lists).
 * It is a proposal, not something Google requires or ranks on; it costs nothing and is built from the live article list, so it never goes stale.
 * Only pages that are public and worth citing are listed (no admin, no accounts, no empty landing pages).
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const base = siteUrl(env)
  let articles: { slug: string; title: string; description: string }[] = []
  try {
    articles = (await loadDirectory(env)).entries.filter((e) => e.status === 'published').sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 50)
  } catch { /* the static part is still useful without the database */ }
  const lines = [
    `# ${BRAND} (${BRAND_EN})`,
    '',
    `> ${BRAND} منصة عربية لإعلانات الإيجار في كل محافظات مصر: شقق وغرف وفيلل ومحلات. المالك أو السمسار ينشر وحدته، والباحث عن سكن يتواصل معه مباشرة، والدفع والحجز بيتم من خلال الموقع.`,
    '',
    '## الصفحات الأساسية',
    `- [الرئيسية](${base}/): ابحث عن وحدة للإيجار حسب المحافظة والنوع والسعر`,
    `- [البحث](${base}/search): بحث متقدم وفلاتر في كل الوحدات المتاحة`,
    `- [المدونة](${base}/blog): نصائح وأدلة عملية للمستأجرين والملاك`,
    `- [من نحن](${base}/about): تعريف بالموقع وطريقة عمله`,
    `- [نصايح الأمان](${base}/safety): إزاي تتجنب النصب وتعاين الوحدة صح`,
    `- [سياسة الإيجار والدفع](${base}/payments-policy): الحجز والتأمين والاسترداد`,
    '',
  ]
  if (articles.length) {
    lines.push('## المقالات', ...articles.map((a) => `- [${a.title.replace(/[[\]]/g, '')}](${base}/blog/${encodeURIComponent(a.slug)})${a.description ? `: ${a.description.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`), '')
  }
  lines.push('## ملاحظات', '- المحتوى بالعربية (مصر).', '- بيانات التواصل مع المعلنين مش منشورة في الصفحات العامة.', '')
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
