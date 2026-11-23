import locationsRaw from '../../src/data/locations.json'
import { DEFAULT_SETTINGS } from '../../src/lib/defaultSettings'
import { slugify } from '../../src/lib/slug'
import type { Env } from '../_lib/env'
import { getDocument } from '../_lib/firestore'
import { getSnapshot } from '../_lib/listings'
import { renderShell } from '../_lib/pages'
import { cardText, listingsFor } from '../_lib/seo'
import { BRAND } from '../../src/lib/brand'
import { ar } from '../../src/i18n/ar'
import { LANDING_NOTES } from '../../src/content/landing'
import { siteUrl } from '../_lib/env'
import { cloudinaryUrl } from '../_lib/logic'
import { bodyHtml, faqJsonLd } from '../_lib/seoBody'

interface Loc { governorates: { id: string; name: string; nameEn: string }[] }
const govs = (locationsRaw as Loc).governorates.map((g) => ({ ...g, slug: slugify(g.nameEn) }))

let typesCache: { at: number; types: { id: string; label: string; plural?: string }[] } | null = null
async function unitTypes(env: Env) {
  if (typesCache && Date.now() - typesCache.at < 300_000) return typesCache.types
  let types = DEFAULT_SETTINGS.unitTypes as { id: string; label: string; plural?: string }[]
  try {
    const s = await getDocument(env, 'settings/app')
    if (Array.isArray(s?.data.unitTypes) && s.data.unitTypes.length) types = s.data.unitTypes as typeof types
  } catch { /* fall back to defaults */ }
  typesCache = { at: Date.now(), types }
  return types
}

// GET /rent/:governorate[/:typeId] - SEO landing pages: unique title/description/canonical injected server-side.
// Governorates added by an admin (not in the static dataset) fall through to client-side meta only.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const parts = ([] as string[]).concat((params.path as string | string[] | undefined) ?? [])
  const [slug, typeId] = parts
  const gov = govs.find((g) => g.slug === slug)
  const path = `/rent/${parts.join('/')}`
  if (!gov || parts.length > 2) return renderShell(request, env, { title: BRAND, description: 'وحدات للإيجار في كل محافظات مصر.', path, noindex: true, status: 404 })
  const types = await unitTypes(env)
  const type = typeId ? types.find((t) => t.id === typeId) : undefined
  if (typeId && !type) return renderShell(request, env, { title: BRAND, description: 'وحدات للإيجار في كل محافظات مصر.', path, noindex: true, status: 404 })

  const plural = type ? type.plural ?? type.label : ''
  const title = type ? `${plural} للإيجار في ${gov.name}` : `وحدات للإيجار في ${gov.name}`
  const description = type
    ? `كل ${plural} المتاحة للإيجار في ${gov.name}. اختار المركز أو القسم وقارن الأسعار وتواصل مع المعلن.`
    : `تصفح وحدات الإيجار المتاحة في محافظة ${gov.name} من ملّاك وسماسرة مباشرة، وفلتر حسب المركز والسعر والمرافق.`
  const base = siteUrl(env)
  // Real listings in the HTML: crawlers see actual content and get links to every listing. A page with NO listing is thin content, so it is kept
  // out of the index (noindex,follow) until the first listing appears; it also leaves the sitemap. If the snapshot cannot be read, do not guess: stay indexable.
  let items: ReturnType<typeof listingsFor> = []
  let known = false
  try { const snap = await getSnapshot(env); items = listingsFor(snap, gov, type?.id); known = !snap.truncated } catch { /* listings are a bonus, never a reason to fail the page */ }
  const empty = known && items.length === 0
  const shown = items.slice(0, 12)
  const faqs = [ar.landing.faqPrice(gov.name), ar.landing.faqSafe]
  const notes = LANDING_NOTES[gov.slug] ?? []
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: BRAND, item: `${base}/` },
          { '@type': 'ListItem', position: 2, name: gov.name, item: `${base}/rent/${gov.slug}` },
          ...(type ? [{ '@type': 'ListItem', position: 3, name: plural }] : []),
        ],
      },
      faqJsonLd(faqs),
      ...(shown.length ? [{ '@type': 'ItemList', name: title, numberOfItems: shown.length, itemListElement: shown.map((u, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}/unit/${u.id}`, name: String(u.data.title ?? '') })) }] : []),
    ],
  }
  const html = bodyHtml({
    h1: title,
    paragraphs: [description, ...notes],
    sections: [
      ...(shown.length ? [{ h2: `أحدث ${plural || 'الوحدات'} المتاحة في ${gov.name}`, links: shown.map((u) => ({ href: `/unit/${u.id}`, text: cardText(u) })) }] : []),
      { h2: ar.landing.other, links: types.filter((t) => t.id !== type?.id).map((t) => ({ href: `/rent/${gov.slug}/${t.id}`, text: `${t.plural ?? t.label} للإيجار في ${gov.name}` })) },
      { h2: `${ar.landing.faqTitle} ${gov.name}`, faqs },
      { h2: ar.landing.near, links: govs.filter((g) => g.slug !== gov.slug).map((g) => ({ href: `/rent/${g.slug}${type ? `/${type.id}` : ''}`, text: type ? `${plural} للإيجار في ${g.name}` : `وحدات للإيجار في ${g.name}` })) },
    ],
  })
  return renderShell(request, env, { title: `${title} | ${BRAND}`, description, path, jsonLd, bodyHtml: html, noindex: empty, image: shown[0]?.data.images && Array.isArray(shown[0].data.images) && shown[0].data.images[0] ? cloudinaryUrl(String(shown[0].data.images[0])) : undefined, cacheControl: 'public, max-age=300, s-maxage=900' })
}
