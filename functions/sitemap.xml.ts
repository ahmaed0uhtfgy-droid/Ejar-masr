import { DEFAULT_SETTINGS } from '../src/lib/defaultSettings'
import type { Env } from './_lib/env'
import { siteUrl } from './_lib/env'
import { getDocument, runQuery } from './_lib/firestore'
import { loadDirectory } from './_lib/articleStore'
import { getSnapshot, type WireDoc } from './_lib/listings'
import { cloudinaryUrl, escapeHtml, isExpiredDate } from './_lib/logic'
import { GOVS, listingsFor, newestDay } from './_lib/seo'
import { fromWire } from './_lib/wire'

const STATIC = ['/', '/search', '/about', '/terms', '/privacy', '/safety', '/contact']
interface Entry { loc: string; lastmod?: string; images?: string[] }

/**
 * /sitemap.xml - only pages that deserve to be indexed: the static pages, every unit that is live, and a governorate / governorate+type page ONLY
 * once it has at least one listing (empty ones are noindex, see rent/[[path]].ts). Built from the shared listings snapshot, so it costs about one read
 * instead of the 500 it used to. Cached 6 h.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cache = caches.default
  const hit = await cache.match(request)
  if (hit) return hit
  const base = siteUrl(env)
  const entries: Entry[] = STATIC.map((p) => ({ loc: `${base}${p}` }))
  try { // blog: the index plus every published article (a failure here must never take the rest of the sitemap down)
    const published = (await loadDirectory(env)).entries.filter((e) => e.status === 'published')
    if (published.length) {
      entries.push({ loc: `${base}/blog`, lastmod: new Date(Math.max(...published.map((e) => e.updatedAt))).toISOString().slice(0, 10) })
      for (const e of published) entries.push({ loc: `${base}/blog/${encodeURIComponent(e.slug)}`, lastmod: new Date(e.updatedAt).toISOString().slice(0, 10), images: e.cover ? [cloudinaryUrl(e.cover)] : [] })
    }
  } catch { /* no articles yet, or the database is unavailable */ }
  let types = DEFAULT_SETTINGS.unitTypes.map((t) => t.id)
  try {
    const s = await getDocument(env, 'settings/app')
    if (Array.isArray(s?.data.unitTypes) && s.data.unitTypes.length) types = (s.data.unitTypes as { id: string }[]).map((t) => t.id)
  } catch { /* defaults */ }

  try {
    const snap = await getSnapshot(env)
    let units: WireDoc[] = snap.units
    if (snap.truncated) { // more than the snapshot holds: read the newest 500 directly
      const rows = await runQuery(env, { collection: 'units', where: [{ field: 'status', op: 'EQUAL', value: 'active' }], orderBy: { field: 'createdAt', dir: 'DESCENDING' }, limit: 500 })
      units = rows.map((r) => ({ id: r.id, data: JSON.parse(JSON.stringify(r.data)) as Record<string, unknown> }))
    }
    const live = units.filter((u) => !isExpiredDate(fromWire(u.data.expiresAt)))
    const view: Parameters<typeof listingsFor>[0] = { builtAt: snap.builtAt, truncated: snap.truncated, units: live }
    for (const g of GOVS) {
      const inGov = listingsFor(view, g)
      if (!inGov.length && !snap.truncated) continue
      entries.push({ loc: `${base}/rent/${g.slug}`, lastmod: newestDay(inGov) })
      for (const t of types) { const inType = listingsFor(view, g, t); if (inType.length || snap.truncated) entries.push({ loc: `${base}/rent/${g.slug}/${t}`, lastmod: newestDay(inType) }) }
    }
    for (const u of live) {
      const created = fromWire(u.data.createdAt)
      const imgs = Array.isArray(u.data.images) ? (u.data.images as unknown[]).slice(0, 5).map((i) => cloudinaryUrl(String(i))) : []
      entries.push({ loc: `${base}/unit/${u.id}`, lastmod: created instanceof Date ? created.toISOString().slice(0, 10) : undefined, images: imgs })
    }
  } catch { /* still serve the static part if Firestore quota is exhausted */ }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${entries
    .map((u) => `<url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}${(u.images ?? []).map((i) => `<image:image><image:loc>${escapeHtml(i)}</image:loc></image:image>`).join('')}</url>`).join('\n')}\n</urlset>`
  const res = new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=21600' } })
  await cache.put(request, res.clone())
  return res
}
