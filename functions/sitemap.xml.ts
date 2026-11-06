import locationsRaw from '../src/data/locations.json'
import { DEFAULT_SETTINGS } from '../src/lib/defaultSettings'
import { slugify } from '../src/lib/slug'
import type { Env } from './_lib/env'
import { siteUrl } from './_lib/env'
import { getDocument, runQuery } from './_lib/firestore'
import { escapeHtml, isExpiredDate } from './_lib/logic'

const MAX_UNITS = 500 // each sitemap generation costs up to MAX_UNITS + 1 reads; the response is cached for 6h (~2,000 reads/day worst case)
const STATIC = ['/', '/search', '/about', '/terms', '/privacy', '/safety', '/contact']

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const cache = caches.default
  const hit = await cache.match(request)
  if (hit) return hit
  const base = siteUrl(env)
  const urls: { loc: string; lastmod?: string }[] = STATIC.map((p) => ({ loc: `${base}${p}` }))
  let types = DEFAULT_SETTINGS.unitTypes.map((t) => t.id)
  try {
    const s = await getDocument(env, 'settings/app')
    if (Array.isArray(s?.data.unitTypes) && s.data.unitTypes.length) types = (s.data.unitTypes as { id: string }[]).map((t) => t.id)
  } catch { /* defaults */ }
  for (const g of (locationsRaw as { governorates: { nameEn: string }[] }).governorates) {
    const slug = slugify(g.nameEn)
    urls.push({ loc: `${base}/rent/${slug}` })
    for (const t of types) urls.push({ loc: `${base}/rent/${slug}/${t}` })
  }
  try {
    const units = await runQuery(env, { collection: 'units', where: [{ field: 'status', op: 'EQUAL', value: 'active' }], orderBy: { field: 'createdAt', dir: 'DESCENDING' }, limit: MAX_UNITS })
    for (const u of units) if (!isExpiredDate(u.data.expiresAt)) urls.push({ loc: `${base}/unit/${u.id}`, lastmod: u.data.createdAt instanceof Date ? u.data.createdAt.toISOString().slice(0, 10) : undefined })
  } catch { /* still serve the static part if Firestore quota is exhausted */ }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `<url><loc>${escapeHtml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>`
  const res = new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=21600' } })
  await cache.put(request, res.clone())
  return res
}
