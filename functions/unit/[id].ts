import type { Env } from '../_lib/env'
import { siteUrl } from '../_lib/env'
import { edgeCached } from '../_lib/edgeLimit'
import { getDocument } from '../_lib/firestore'
import { cloudinaryUrl, escapeHtml, isExpiredDate, isValidDocId } from '../_lib/logic'
import { renderShell } from '../_lib/pages'
import { govById } from '../_lib/seo'
import { fromWire, toWire } from '../_lib/wire'
import { BRAND } from '../../src/lib/brand'

// GET /unit/:id - SPA shell + server-injected meta, Open Graph and JSON-LD for the listing.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id ?? '')
  const path = `/unit/${id}`
  const fallback = { title: `وحدة للإيجار | ${BRAND}`, description: `تفاصيل وحدة للإيجار على ${BRAND}.`, path, noindex: true }
  if (!isValidDocId(id)) return renderShell(request, env, { ...fallback, status: 404 })
  let unit: { id: string; data: Record<string, unknown> } | null
  try {
    // Shared by every visitor / crawler for 5 minutes: one Firestore read instead of one per page view.
    const cached = await edgeCached(`unitpage:${id}`, 300, async () => { const u = await getDocument(env, `units/${id}`); return u ? { id: u.id, data: toWire(u.data) } : null })
    unit = cached ? { id: cached.id, data: fromWire(cached.data) as Record<string, unknown> } : null
  } catch { return renderShell(request, env, { ...fallback, cacheControl: 'no-store' }) }
  if (!unit) return renderShell(request, env, { ...fallback, status: 404 })

  const d = unit.data
  const live = d.status === 'active' && !isExpiredDate(d.expiresAt)
  const str = (k: string) => String(d[k] ?? '')
  const unitLabel = `${str('typeName')} للإيجار في ${str('areaName')}، ${str('governorateName')}`
  const priceTxt = `${Number(d.price)} جنيه / ${d.rentType === 'daily' ? 'يوم' : 'شهر'}`
  const title = `${str('title')} — ${unitLabel}`
  const description = `${unitLabel} بسعر ${priceTxt}. ${Number(d.rooms)} غرف، ${Number(d.bathrooms)} حمامات، ${Number(d.area)} م².`.slice(0, 300)
  const images = Array.isArray(d.images) ? (d.images as string[]) : []
  const image = images[0] ? cloudinaryUrl(images[0]) : undefined

  const gov = govById(d.governorateId)
  const base = siteUrl(env)
  const crumbs = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: BRAND, item: `${base}/` },
      ...(gov ? [{ '@type': 'ListItem', position: 2, name: gov.name, item: `${base}/rent/${gov.slug}` }] : []),
      ...(gov && d.typeId ? [{ '@type': 'ListItem', position: 3, name: str('typeName'), item: `${base}/rent/${gov.slug}/${str('typeId')}` }] : []),
      { '@type': 'ListItem', position: gov && d.typeId ? 4 : gov ? 3 : 2, name: str('title') },
    ],
  }
  const listing = {
    '@type': 'RealEstateListing', name: str('title'), description: str('description').slice(0, 500) || description,
    url: `${base}${path}`, datePosted: d.createdAt instanceof Date ? d.createdAt.toISOString() : undefined,
    image: images.slice(0, 5).map((i) => cloudinaryUrl(i)),
    about: {
      '@type': 'Accommodation', numberOfRooms: Number(d.rooms), floorSize: { '@type': 'QuantitativeValue', value: Number(d.area), unitCode: 'MTK' },
      address: { '@type': 'PostalAddress', addressCountry: 'EG', addressRegion: str('governorateName'), addressLocality: str('areaName'), streetAddress: str('address') || undefined },
    },
    offers: { '@type': 'Offer', url: `${base}${path}`, price: Number(d.price), priceCurrency: 'EGP', ...(d.expiresAt instanceof Date ? { priceValidUntil: d.expiresAt.toISOString().slice(0, 10) } : {}), availability: live ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' },
  }
  const jsonLd = { '@context': 'https://schema.org', '@graph': [listing, crumbs] }
  const bodyHtml = `<article style="position:absolute;width:1px;height:1px;overflow:hidden"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>${escapeHtml(str('description').slice(0, 600))}</p></article>`
  return renderShell(request, env, { title, description, path, image, noindex: !live, jsonLd: live ? jsonLd : undefined, bodyHtml, status: 200 })
}
