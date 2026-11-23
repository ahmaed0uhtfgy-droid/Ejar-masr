import { renderArticle, renderNotFound } from '../_lib/articlePages'
import { loadDirectory, readArticle } from '../_lib/articleStore'
import { siteDesign } from '../_lib/design'
import { edgeCached } from '../_lib/edgeLimit'
import type { Env } from '../_lib/env'
import { getSnapshot } from '../_lib/listings'
import { listingsFor, GOVS } from '../_lib/seo'

/** GET /blog/<slug>: one published article, rendered to HTML and cached at the edge for 10 minutes. Drafts and unknown slugs are a real 404 (never cached, so a new article shows up at once). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  let slug = new URL(request.url).pathname.replace(/^\/blog\//, '').replace(/\/$/, '')
  try { slug = decodeURIComponent(slug) } catch { /* keep as is: it simply will not be found */ }
  const design = await siteDesign(env)
  const notFound = () => new Response(renderNotFound(env, design), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })
  if (!slug || slug.length > 90 || /[/\\]/.test(slug)) return notFound()
  try {
    const page = await edgeCached(`blog:${slug}`, 600, async () => {
      const a = await readArticle(env, slug)
      if (!a || a.status !== 'published') return { html: null as string | null }
      const [snap, dir] = await Promise.all([getSnapshot(env).catch(() => null), loadDirectory(env)])
      const g = GOVS.find((x) => x.id === a.govId)
      const listings = snap && g ? listingsFor(snap, g, a.typeId || undefined).slice(0, 3) : snap ? snap.units.slice(0, 3) : []
      const articles = dir.entries.filter((e) => e.slug !== a.slug && e.status === 'published').sort((x, y) => (y.govId === a.govId ? 1 : 0) - (x.govId === a.govId ? 1 : 0) || (y.publishedAt ?? 0) - (x.publishedAt ?? 0)).slice(0, 3).map((e) => ({ ...e, sig: [] }))
      return { html: renderArticle(env, a, { listings, articles }, { design }) }
    }, (v) => v.html !== null)
    return page.html ? new Response(page.html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }) : notFound()
  } catch (e) {
    console.error('blog article failed', e)
    return new Response(renderNotFound(env, design), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '120' } })
  }
}
