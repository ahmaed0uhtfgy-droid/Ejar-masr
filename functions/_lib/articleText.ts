/** Text tools for the blog: Arabic URL slugs, a SAFE markdown renderer, word counts. No DOM, no network. */
import { escapeHtml } from './logic'

// ---------- slugs ----------
const DIACRITICS = /[\u064B-\u065F\u0670\u0640]/g // harakat, superscript alef, tatweel
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'

/** Arabic text normalised the way people actually search it: no diacritics/tatweel, one form of alef and ya, Western digits. */
export function normalizeArabic(s: string): string {
  return s.normalize('NFKC').replace(DIACRITICS, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

/** URL slug that keeps the Arabic words people search for: "شقق للإيجار في مدينة نصر" -> "شقق-للايجار-في-مدينة-نصر". */
export function arabicSlug(text: string, max = 80): string {
  const base = normalizeArabic(text).toLowerCase().replace(/[^\u0621-\u064Aa-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (base.length <= max) return base
  const cut = base.slice(0, max)
  const at = cut.lastIndexOf('-')
  return (at > max * 0.5 ? cut.slice(0, at) : cut).replace(/-+$/g, '')
}
export const isValidSlug = (s: unknown): s is string => typeof s === 'string' && s.length >= 3 && s.length <= 90 && /^[\u0621-\u064Aa-z0-9]+(?:-[\u0621-\u064Aa-z0-9]+)*$/.test(s)

/** First free slug: base, base-2, base-3 ... */
export async function uniqueSlug(base: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const root = base || 'مقال'
  for (let i = 1; i <= 30; i++) {
    const candidate = i === 1 ? root : `${root.slice(0, 85)}-${i}`
    if (!(await taken(candidate))) return candidate
  }
  return `${root.slice(0, 80)}-${Date.now().toString(36)}`
}

// ---------- safe markdown ----------
export interface ArticleImage { id: string; alt: string; href?: string }
export interface Heading { id: string; text: string; level: 2 | 3 }
export interface RenderCtx { images: ArticleImage[]; imageUrl: (id: string, w: number) => string; videoHtml?: string }

const SAFE_URL = /^(?:\/(?!\/)[^\s"'<>\\]*|https?:\/\/[^\s"'<>\\]+)$/

/** Inline formatting. Order matters: links are lifted out FIRST (validated), everything else is HTML-escaped, then bold is applied. */
export function renderInline(raw: string): string {
  const links: string[] = []
  const withTokens = raw.replace(/\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g, (_m, text: string, url: string) => {
    if (!SAFE_URL.test(url)) return text // javascript:, data:, //evil.com ... are dropped, the words stay
    const external = /^https?:/i.test(url)
    links.push(`<a href="${escapeHtml(url)}"${external ? ' rel="nofollow noopener" target="_blank"' : ''}>${escapeHtml(text)}</a>`)
    return `\u0000${links.length - 1}\u0000`
  })
  return escapeHtml(withTokens).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/\u0000(\d+)\u0000/g, (_m, i: string) => links[Number(i)] ?? '')
}

const stripInline = (s: string): string => s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').replace(/\{\{[^}]*\}\}/g, '')

/** Renders the restricted markdown the editor and the AI use. Anything it does not recognise is plain escaped text, never HTML. */
export function renderMarkdown(md: string, ctx: RenderCtx): { html: string; headings: Heading[] } {
  const out: string[] = []
  const headings: Heading[] = []
  const used = new Set<string>()
  const headingId = (text: string): string => { let id = arabicSlug(text, 50) || 'قسم'; let n = 2; const base = id; while (used.has(id)) id = `${base}-${n++}`; used.add(id); return id }
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null
  let para: string[] = []
  const flushPara = () => { if (para.length) { out.push(`<p>${renderInline(para.join(' '))}</p>`); para = [] } }
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${renderInline(i)}</li>`).join('')}</${list.tag}>`); list = null } }
  const flush = () => { flushPara(); flushList() }
  for (const line0 of md.replace(/\r\n?/g, '\n').split('\n')) {
    const line = line0.trim()
    let m: RegExpExecArray | null
    if (!line) { flush(); continue }
    if ((m = /^(#{2,3})\s+(.+)$/.exec(line))) {
      flush()
      const level = m[1].length as 2 | 3
      const text = stripInline(m[2]).trim()
      const id = headingId(text)
      headings.push({ id, text, level })
      out.push(`<h${level} id="${escapeHtml(id)}">${renderInline(m[2])}</h${level}>`)
    } else if ((m = /^\{\{image:(\d{1,2})\}\}$/.exec(line))) {
      flush()
      const img = ctx.images[Number(m[1]) - 1]
      if (img) {
        const pic = `<img src="${escapeHtml(ctx.imageUrl(img.id, 900))}" srcset="${escapeHtml(ctx.imageUrl(img.id, 480))} 480w, ${escapeHtml(ctx.imageUrl(img.id, 900))} 900w" sizes="(max-width: 720px) 100vw, 720px" alt="${escapeHtml(img.alt)}" width="900" height="600" loading="lazy" decoding="async">`
        const link = img.href && SAFE_URL.test(img.href) ? `<a href="${escapeHtml(img.href)}">${pic}</a>` : pic
        out.push(`<figure>${link}${img.alt ? `<figcaption>${escapeHtml(img.alt)}</figcaption>` : ''}</figure>`)
      }
    } else if (line === '{{video}}') {
      flush(); if (ctx.videoHtml) out.push(ctx.videoHtml)
    } else if ((m = /^[-*•]\s+(.+)$/.exec(line))) {
      flushPara(); if (list?.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] } } list.items.push(m[1])
    } else if ((m = /^\d{1,2}[.)]\s+(.+)$/.exec(line))) {
      flushPara(); if (list?.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] } } list.items.push(m[1])
    } else if ((m = /^>\s?(.+)$/.exec(line))) {
      flush(); out.push(`<blockquote><p>${renderInline(m[1])}</p></blockquote>`)
    } else if (/^-{3,}$/.test(line)) {
      flush(); out.push('<hr>')
    } else { flushList(); para.push(line) }
  }
  flush()
  return { html: out.join('\n'), headings }
}

// ---------- counts ----------
export const plainText = (md: string): string => stripInline(md).replace(/^#{1,6}\s+/gm, '').replace(/^[-*•]\s+/gm, '').replace(/^\d{1,2}[.)]\s+/gm, '').replace(/^>\s?/gm, '').replace(/\s+/g, ' ').trim()
export const wordCount = (md: string): number => { const t = plainText(md); return t ? t.split(' ').length : 0 }
export const readingMinutes = (md: string): number => Math.max(1, Math.round(wordCount(md) / 200))
export const excerpt = (md: string, max = 160): string => { const t = plainText(md); return t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…` }

/** A YouTube id from an id or any common YouTube URL, or null. */
export function youtubeId(input: string): string | null {
  const s = input.trim()
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s
  try {
    const u = new URL(s)
    const host = u.hostname.replace(/^www\./, '')
    const id = host === 'youtu.be' ? u.pathname.slice(1) : host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com') ? (u.searchParams.get('v') ?? /^\/(?:embed|shorts)\/([^/?]+)/.exec(u.pathname)?.[1] ?? '') : ''
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch { return null }
}

/**
 * Keeps the site's own address inside article text correct when the domain changes.
 *  - `{{site}}` (or `{{SITE_URL}}`) becomes the current address, so an editor can write [موقعنا]({{site}}/search) once and forget it.
 *  - Any older address (the previous domain, with or without https:// / www.) is rewritten to the current one, so articles that already
 *    contain the old domain follow the move without being edited. Done when the page is rendered, nothing stored changes.
 * `base` and `olds` are full addresses like https://example.com (no trailing slash).
 */
export function relinkSite(md: string, base: string, olds: string[] = []): string {
  let out = md.split('{{site}}').join(base).split('{{SITE_URL}}').join(base)
  const host = (u: string): string => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '')
  const newHost = host(base)
  for (const o of olds) {
    const oh = host(o)
    if (!oh || oh === newHost) continue
    for (const pre of ['https://www.', 'http://www.', 'https://', 'http://']) out = out.split(`${pre}${oh}`).join(base)
    out = out.split(oh).join(newHost) // bare mentions such as link text
  }
  return out
}
