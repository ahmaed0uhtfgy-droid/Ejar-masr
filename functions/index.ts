import locationsRaw from '../src/data/locations.json'
import { DEFAULT_SETTINGS } from '../src/lib/defaultSettings'
import { BRAND, BRAND_EN } from '../src/lib/brand'
import { slugify } from '../src/lib/slug'
import { ar } from '../src/i18n/ar'
import type { Env } from './_lib/env'
import { siteUrl } from './_lib/env'
import { renderShell } from './_lib/pages'
import { bodyHtml, faqJsonLd } from './_lib/seoBody'

interface Loc { governorates: { name: string; nameEn: string }[] }
const govs = (locationsRaw as Loc).governorates.map((g) => ({ name: g.name, slug: slugify(g.nameEn) }))

// GET / - homepage with the title, description, content, WebSite/Organization/FAQ JSON-LD injected server-side
// so crawlers (and social previews) see real content without running JavaScript.
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = siteUrl(env)
  const h = ar.home
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${base}/#website`, url: `${base}/`, name: BRAND, alternateName: [BRAND_EN], inLanguage: 'ar-EG', publisher: { '@id': `${base}/#org` } },
      { '@type': 'Organization', '@id': `${base}/#org`, name: BRAND, alternateName: [BRAND_EN], url: `${base}/`, logo: `${base}/logo.svg` },
      faqJsonLd(h.faq),
    ],
  }
  const html = bodyHtml({
    h1: h.heroTitle,
    paragraphs: [h.heroText, h.description],
    sections: [
      { h2: h.whatTitle, text: h.whatText },
      { h2: h.popular, links: govs.map((g) => ({ href: `/rent/${g.slug}`, text: ar.landing.titleGov(g.name) })) },
      { h2: ar.landing.other, links: DEFAULT_SETTINGS.unitTypes.map((t) => ({ href: `/rent/cairo/${t.id}`, text: `${t.plural ?? t.label} للإيجار` })) },
      { h2: h.faqTitle, faqs: h.faq },
    ],
  })
  return renderShell(request, env, { title: h.title, description: h.description, path: '/', jsonLd, bodyHtml: html, cacheControl: 'public, max-age=300, s-maxage=900' })
}
