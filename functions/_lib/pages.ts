import type { Env } from './env'
import { escapeHtml, safeJsonLd } from './logic'
import { siteUrl } from './env'
import { BRAND } from '../../src/lib/brand'

export interface PageSeo {
  title: string
  description: string
  path: string
  image?: string
  noindex?: boolean
  jsonLd?: unknown
  bodyHtml?: string
  status?: number
  cacheControl?: string
}

/** Serves the SPA shell with title/description/canonical/Open Graph/JSON-LD injected so crawlers see them without running JS. */
export async function renderShell(request: Request, env: Env, seo: PageSeo): Promise<Response> {
  let shell = await env.ASSETS.fetch(new URL('/index.html', request.url))
  if (shell.status >= 300 && shell.status < 400) shell = await env.ASSETS.fetch(new URL('/', request.url)) // Pages may redirect /index.html -> /
  const url = `${siteUrl(env)}${seo.path}`
  const image = seo.image ?? `${siteUrl(env)}/og-default.png` // every page gets a share preview; listings override it with their own photo
  const head = [
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta name="robots" content="${seo.noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="ar_EG" />`,
    `<meta property="og:site_name" content="${escapeHtml(BRAND)}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(image)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
    seo.jsonLd ? `<script type="application/ld+json">${safeJsonLd(seo.jsonLd)}</script>` : '',
  ].join('\n')

  const rewritten = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(seo.title) } })
    .on('meta[name="description"]', { element(e) { e.setAttribute('content', seo.description) } })
    .on('head', { element(e) { e.append(head, { html: true }) } })
    .on('div#root', { element(e) { if (seo.bodyHtml) e.append(seo.bodyHtml, { html: true }) } })
    .transform(shell)

  const res = new Response(rewritten.body, { status: seo.status ?? 200, headers: rewritten.headers })
  res.headers.set('Content-Type', 'text/html; charset=utf-8')
  res.headers.set('Cache-Control', seo.cacheControl ?? 'public, max-age=60, s-maxage=300')
  return res
}
