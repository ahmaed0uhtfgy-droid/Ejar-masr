/** Server-rendered blog pages: complete HTML in the response (best for search engines), tiny inline CSS, no JavaScript, no client bundle, so they are fast. */
import { BRAND } from '../../src/lib/brand'
import type { ArticleDoc, DirEntry } from './articleStore'
import { excerpt, readingMinutes, relinkSite, renderMarkdown } from './articleText'
import { normalizeDesign, type DesignId } from '../../src/lib/designIds'
import type { Env } from './env'
import { previousSiteUrls, siteUrl } from './env'
import { cloudinaryUrl, escapeHtml, safeJsonLd } from './logic'
import type { WireDoc } from './listings'
import { GOVS } from './seo'

const CSS = `:root{--bg:#faf7f0;--fg:#14161d;--mute:#5b6070;--card:#fff;--line:#e6e0d2;--brand:#0b1b3a;--on:#fff;--gold:#8a6308}
@media(prefers-color-scheme:dark){:root{--bg:#0f0f10;--fg:#f0ede6;--mute:#a5a5ad;--card:#1a1a1c;--line:#3a3a3f;--brand:#e2b84e;--on:#14161d;--gold:#e2b84e}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.9 system-ui,"Segoe UI",Tahoma,"Noto Naskh Arabic",sans-serif}
a{color:var(--gold);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card)}
.logo{font-weight:800;font-size:1.25rem;color:var(--fg);text-decoration:none}.top nav{display:flex;gap:16px;font-size:.95rem}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 48px}.crumbs{font-size:.85rem;color:var(--mute)}.crumbs a{color:var(--mute)}
h1{font-size:clamp(1.6rem,5vw,2.3rem);line-height:1.4;margin:.5rem 0}h2{font-size:1.5rem;line-height:1.5;margin:2.2rem 0 .4rem}h3{font-size:1.2rem;margin:1.6rem 0 .2rem}
p{margin:.8rem 0}ul,ol{padding-inline-start:1.4rem}li{margin:.3rem 0}blockquote{margin:1rem 0;padding:.2rem 1rem;border-inline-start:4px solid var(--gold);background:var(--card)}
.meta{color:var(--mute);font-size:.9rem}figure{margin:1.4rem 0}figure img,.cover img{width:100%;height:auto;border-radius:12px;display:block;background:var(--line)}figcaption{font-size:.85rem;color:var(--mute);margin-top:.3rem}
.toc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 18px;margin:1.2rem 0}.toc ol{margin:.4rem 0}.toc a{text-decoration:none}
.video{position:relative;aspect-ratio:16/9;margin:1.4rem 0}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:12px}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:.6rem 0}summary{cursor:pointer;font-weight:700}
.cta{background:var(--brand);color:var(--on);border-radius:14px;padding:18px 20px;margin:2rem 0}.cta a{color:var(--on);font-weight:700}.cta p{margin:.3rem 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:1rem 0}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;text-decoration:none;color:var(--fg);display:block}
.card img{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:var(--line)}.card div{padding:10px 12px;font-size:.95rem;line-height:1.6}.card small{color:var(--mute);display:block}
.pager{display:flex;gap:12px;justify-content:center;margin:2rem 0}.draft{background:#b45309;color:#fff;padding:8px 14px;text-align:center;font-size:.9rem}
footer{border-top:1px solid var(--line);padding:20px 16px;text-align:center;color:var(--mute);font-size:.9rem}footer a{color:var(--mute);margin:0 8px}
html[data-design=classic]{--r:6px}html[data-design=classic]:not(.x){--bg:#f6f2e8}
@media(prefers-color-scheme:dark){html[data-design=classic]:not(.x){--bg:#0f0f10}}
html[data-design=royal]{color-scheme:dark;--bg:#061431;--fg:#f5f7fc;--mute:#a9bad6;--card:#0d2a57;--line:#2d4f86;--brand:#d9a441;--on:#2a1a00;--gold:#f0cf86}
html[data-design=royal] body{background-image:radial-gradient(ellipse 80% 420px at 50% 0,rgba(26,74,150,.35),transparent 70%);background-repeat:no-repeat}
html[data-design=royal] .top{background:rgba(6,20,49,.92);border-bottom:1px solid rgba(217,164,65,.3)}html[data-design=royal] .logo{font-weight:900;border-bottom:2px solid #d9a441;padding-bottom:2px}
html[data-design=royal] .card,html[data-design=royal] .toc,html[data-design=royal] details{border-color:rgba(217,164,65,.28)}
html[data-design=royal] .cta{background:linear-gradient(135deg,#f0cf86,#d9a441)}html[data-design=royal] h1,html[data-design=royal] h2{font-weight:900}
html[data-design=royal] footer{border-top-color:rgba(217,164,65,.3)}`

const fmtDate = (d: Date): string => d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Africa/Cairo' })
const imageUrl = (id: string, w: number): string => cloudinaryUrl(id, w, Math.round((w * 2) / 3))
export const blogUrl = (env: Env, slug?: string): string => `${siteUrl(env)}/blog${slug ? `/${encodeURIComponent(slug)}` : ''}`

interface Shell { design?: DesignId; title: string; description: string; canonical: string; body: string; jsonLd: unknown[]; image?: string; robots?: string; type?: 'website' | 'article'; published?: string; banner?: string }
function shell(env: Env, s: Shell): string {
  const base = siteUrl(env)
  const image = s.image ?? `${base}/og-default.png`
  return `<!doctype html>
<html lang="ar" dir="rtl" data-design="${normalizeDesign(s.design)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(s.title)} | ${escapeHtml(BRAND)}</title>
<meta name="description" content="${escapeHtml(s.description)}">
<meta name="robots" content="${s.robots ?? 'index,follow,max-image-preview:large'}">
<link rel="canonical" href="${escapeHtml(s.canonical)}">
<meta property="og:type" content="${s.type ?? 'website'}"><meta property="og:site_name" content="${escapeHtml(BRAND)}"><meta property="og:locale" content="ar_EG">
<meta property="og:title" content="${escapeHtml(s.title)}"><meta property="og:description" content="${escapeHtml(s.description)}"><meta property="og:url" content="${escapeHtml(s.canonical)}"><meta property="og:image" content="${escapeHtml(image)}">
${s.published ? `<meta property="article:published_time" content="${escapeHtml(s.published)}">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escapeHtml(s.title)}"><meta name="twitter:description" content="${escapeHtml(s.description)}"><meta name="twitter:image" content="${escapeHtml(image)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://res.cloudinary.com" crossorigin>
<style>${CSS}</style>
${s.jsonLd.map((j) => `<script type="application/ld+json">${safeJsonLd(j)}</script>`).join('\n')}
</head><body>
${s.banner ? `<div class="draft">${escapeHtml(s.banner)}</div>` : ''}
<header class="top"><a class="logo" href="/">${escapeHtml(BRAND)}</a><nav><a href="/search">ابحث عن وحدة</a><a href="/blog">المدونة</a></nav></header>
<main class="wrap">${s.body}</main>
<footer><a href="/">الرئيسية</a><a href="/search">البحث</a><a href="/blog">المدونة</a><a href="/about">من نحن</a><a href="/terms">الشروط</a><a href="/privacy">الخصوصية</a><p>© ${new Date().getFullYear()} ${escapeHtml(BRAND)}</p></footer>
</body></html>`
}

const listingCard = (l: WireDoc): string => {
  const img = Array.isArray(l.data.images) && l.data.images[0] ? `<img src="${escapeHtml(cloudinaryUrl(String(l.data.images[0]), 400, 300))}" alt="${escapeHtml(String(l.data.title ?? ''))}" width="400" height="300" loading="lazy">` : ''
  return `<a class="card" href="/unit/${escapeHtml(l.id)}">${img}<div>${escapeHtml(String(l.data.title ?? '').slice(0, 70))}<small>${escapeHtml(String(l.data.areaName ?? ''))} — ${Number(l.data.price)} جنيه / ${l.data.rentType === 'daily' ? 'يوم' : 'شهر'}</small></div></a>`
}
const articleCard = (env: Env, e: DirEntry): string => {
  const img = e.cover ? `<img src="${escapeHtml(cloudinaryUrl(e.cover, 400, 250))}" alt="${escapeHtml(e.coverAlt || e.title)}" width="400" height="250" loading="lazy">` : ''
  return `<a class="card" href="/blog/${escapeHtml(encodeURIComponent(e.slug))}">${img}<div><strong>${escapeHtml(e.title)}</strong><small>${escapeHtml(e.description.slice(0, 110))}</small></div></a>`.replace('href="/blog', `href="${escapeHtml(new URL(blogUrl(env)).pathname)}`)
}

export function renderArticle(env: Env, a0: ArticleDoc, rel: { listings: WireDoc[]; articles: DirEntry[] }, opts: { preview?: boolean; design?: DesignId } = {}): string {
  const base = siteUrl(env)
  const a: ArticleDoc = { ...a0, body: relinkSite(a0.body, base, previousSiteUrls(env)) } // {{site}} and old domains in the text follow the current domain
  const url = blogUrl(env, a.slug)
  const videoHtml = a.videoId ? `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${escapeHtml(a.videoId)}" title="${escapeHtml(a.videoTitle || a.title)}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ''
  let md = a.body
  if (a.videoId && !/\{\{video\}\}/.test(md)) { const at = md.lastIndexOf('\n## '); md = at > 0 ? `${md.slice(0, at)}\n\n{{video}}\n${md.slice(at)}` : `${md}\n\n{{video}}` } // video goes before the last section unless the editor placed it
  const { html, headings } = renderMarkdown(md, { images: a.images, imageUrl, videoHtml })
  const g = GOVS.find((x) => x.id === a.govId)
  const published = a.publishedAt ?? a.createdAt
  const cover = a.cover ?? a.images[0] ?? null
  const coverUrl = cover ? imageUrl(cover.id, 1200) : undefined
  const crumbs = [{ name: BRAND, url: `${base}/` }, { name: 'المدونة', url: blogUrl(env) }, { name: a.title, url }]
  const toc = headings.filter((h) => h.level === 2)
  const body = `<nav class="crumbs" aria-label="مسار التنقل"><a href="/">${escapeHtml(BRAND)}</a> › <a href="/blog">المدونة</a></nav>
<article>
<h1>${escapeHtml(a.title)}</h1>
<p class="meta"><time datetime="${published.toISOString()}">${escapeHtml(fmtDate(published))}</time> · ${readingMinutes(a.body)} دقائق قراءة</p>
${cover ? `<figure class="cover"><img src="${escapeHtml(coverUrl as string)}" srcset="${escapeHtml(imageUrl(cover.id, 600))} 600w, ${escapeHtml(imageUrl(cover.id, 1200))} 1200w" sizes="(max-width: 760px) 100vw, 760px" alt="${escapeHtml(cover.alt || a.title)}" width="1200" height="800" fetchpriority="high"></figure>` : ''}
${toc.length >= 3 ? `<nav class="toc" aria-label="محتوى المقال"><strong>في المقال</strong><ol>${toc.map((h) => `<li><a href="#${escapeHtml(h.id)}">${escapeHtml(h.text)}</a></li>`).join('')}</ol></nav>` : ''}
${html}
${a.faq.length ? `<section aria-labelledby="faq"><h2 id="faq">أسئلة شائعة</h2>${a.faq.map((f) => `<details><summary>${escapeHtml(f.q)}</summary><p>${escapeHtml(f.a)}</p></details>`).join('')}</section>` : ''}
<aside class="cta"><p><strong>بتدور على وحدة للإيجار${g ? ` في ${escapeHtml(g.name)}` : ''}؟</strong></p><p>شوف الوحدات المتاحة دلوقتي وتواصل مع المالك مباشرة: <a href="${g ? `/rent/${escapeHtml(g.slug)}` : '/search'}">${g ? `وحدات للإيجار في ${escapeHtml(g.name)}` : 'ابحث عن وحدتك'}</a></p><p>موقعنا: <a href="${escapeHtml(base)}/">${escapeHtml(base.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))}</a></p></aside>
</article>
${rel.listings.length ? `<section><h2>وحدات متاحة دلوقتي</h2><div class="grid">${rel.listings.map(listingCard).join('')}</div></section>` : ''}
${rel.articles.length ? `<section><h2>مقالات ممكن تفيدك</h2><div class="grid">${rel.articles.map((e) => articleCard(env, e)).join('')}</div></section>` : ''}`
  const articleLd = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: a.title, description: a.description, inLanguage: 'ar', mainEntityOfPage: url, url,
    datePublished: published.toISOString(), dateModified: a.updatedAt.toISOString(), ...(coverUrl ? { image: [coverUrl] } : {}), keywords: [a.primary, ...a.secondary].filter(Boolean).join('، '),
    author: { '@type': 'Organization', name: BRAND, url: base }, publisher: { '@type': 'Organization', name: BRAND, logo: { '@type': 'ImageObject', url: `${base}/logo.svg` } },
  }
  const ld: unknown[] = [articleLd, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })) }]
  if (a.faq.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: a.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) })
  if (a.videoId) ld.push({ '@context': 'https://schema.org', '@type': 'VideoObject', name: a.videoTitle || a.title, description: a.description, thumbnailUrl: [`https://i.ytimg.com/vi/${a.videoId}/hqdefault.jpg`], uploadDate: published.toISOString(), embedUrl: `https://www.youtube-nocookie.com/embed/${a.videoId}` })
  return shell(env, { design: opts.design, title: a.title, description: a.description || excerpt(a.body), canonical: url, body, jsonLd: ld, image: coverUrl, type: 'article', published: published.toISOString(), robots: opts.preview ? 'noindex,nofollow' : undefined, banner: opts.preview ? 'معاينة: المقال لسه غير منشور' : undefined })
}

export const PAGE_SIZE = 12
export function renderIndex(env: Env, entries: DirEntry[], page: number, design?: DesignId): string {
  const total = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const p = Math.min(Math.max(1, page), total)
  const shown = entries.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE)
  const url = p > 1 ? `${blogUrl(env)}?page=${p}` : blogUrl(env)
  const title = p > 1 ? `مدونة الإيجار: نصائح وأدلة للمستأجرين والملاك (صفحة ${p})` : 'مدونة الإيجار: نصائح وأدلة للمستأجرين والملاك'
  const description = 'مقالات عملية عن إيجار الشقق والغرف والفيلل والمحلات في مصر: إزاي تعاين، تتفاوض، تفهم العقد وتختار المنطقة المناسبة.'
  const body = `<nav class="crumbs"><a href="/">${escapeHtml(BRAND)}</a> › المدونة</nav><h1>مدونة ${escapeHtml(BRAND)}</h1><p>نصائح وأدلة عملية للمستأجرين والملاك في مصر.</p>
${shown.length ? `<div class="grid">${shown.map((e) => articleCard(env, e)).join('')}</div>` : '<p>مفيش مقالات منشورة لسه. ارجع قريب!</p>'}
${total > 1 ? `<nav class="pager" aria-label="الصفحات">${p > 1 ? `<a href="/blog${p > 2 ? `?page=${p - 1}` : ''}">السابق</a>` : ''}<span>${p} / ${total}</span>${p < total ? `<a href="/blog?page=${p + 1}">التالي</a>` : ''}</nav>` : ''}`
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: title, url, inLanguage: 'ar', hasPart: shown.map((e) => ({ '@type': 'BlogPosting', headline: e.title, url: blogUrl(env, e.slug) })) }, { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: BRAND, item: `${siteUrl(env)}/` }, { '@type': 'ListItem', position: 2, name: 'المدونة', item: blogUrl(env) }] }]
  return shell(env, { design, title, description, canonical: url, body, jsonLd: ld, robots: entries.length ? undefined : 'noindex,follow' })
}

export function renderNotFound(env: Env, design?: DesignId): string {
  return shell(env, { design, title: 'المقال مش موجود', description: 'المقال المطلوب غير موجود أو اتشال.', canonical: blogUrl(env), robots: 'noindex,follow', body: '<h1>المقال مش موجود</h1><p>ممكن يكون اتشال أو الرابط غلط. شوف <a href="/blog">كل المقالات</a> أو <a href="/search">ابحث عن وحدة</a>.</p>', jsonLd: [] })
}
