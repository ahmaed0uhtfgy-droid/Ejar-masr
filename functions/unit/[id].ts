import type { Env } from '../_lib/env'
import { siteUrl } from '../_lib/env'
import { getDocument } from '../_lib/firestore'
import { cloudinaryUrl, escapeHtml, isExpiredDate, isValidDocId } from '../_lib/logic'
import { renderShell } from '../_lib/pages'

// GET /unit/:id - SPA shell + server-injected meta, Open Graph and JSON-LD for the listing.
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id ?? '')
  const path = `/unit/${id}`
  const fallback = { title: 'وحدة للإيجار | إيجار مصر', description: 'تفاصيل وحدة للإيجار على إيجار مصر.', path, noindex: true }
  if (!isValidDocId(id)) return renderShell(request, env, { ...fallback, status: 404 })
  let unit
  try { unit = await getDocument(env, `units/${id}`) } catch { return renderShell(request, env, { ...fallback, cacheControl: 'no-store' }) }
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

  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'RealEstateListing', name: str('title'), description: str('description').slice(0, 500) || description,
    url: `${siteUrl(env)}${path}`, datePosted: d.createdAt instanceof Date ? d.createdAt.toISOString() : undefined,
    image: images.slice(0, 5).map((i) => cloudinaryUrl(i)),
    about: {
      '@type': 'Accommodation', numberOfRooms: Number(d.rooms), floorSize: { '@type': 'QuantitativeValue', value: Number(d.area), unitCode: 'MTK' },
      address: { '@type': 'PostalAddress', addressCountry: 'EG', addressRegion: str('governorateName'), addressLocality: str('areaName'), streetAddress: str('address') || undefined },
    },
    offers: { '@type': 'Offer', price: Number(d.price), priceCurrency: 'EGP', availability: live ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut' },
  }
  const bodyHtml = `<article style="position:absolute;width:1px;height:1px;overflow:hidden"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p>${escapeHtml(str('description').slice(0, 600))}</p></article>`
  return renderShell(request, env, { title, description, path, image, noindex: !live, jsonLd: live ? jsonLd : undefined, bodyHtml, status: 200 })
}
