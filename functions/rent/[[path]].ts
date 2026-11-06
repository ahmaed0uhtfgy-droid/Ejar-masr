import locationsRaw from '../../src/data/locations.json'
import { DEFAULT_SETTINGS } from '../../src/lib/defaultSettings'
import { slugify } from '../../src/lib/slug'
import type { Env } from '../_lib/env'
import { getDocument } from '../_lib/firestore'
import { renderShell } from '../_lib/pages'

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
  if (!gov || parts.length > 2) return renderShell(request, env, { title: 'إيجار مصر', description: 'وحدات للإيجار في كل محافظات مصر.', path, noindex: true, status: 404 })
  const types = await unitTypes(env)
  const type = typeId ? types.find((t) => t.id === typeId) : undefined
  if (typeId && !type) return renderShell(request, env, { title: 'إيجار مصر', description: 'وحدات للإيجار في كل محافظات مصر.', path, noindex: true, status: 404 })

  const plural = type ? type.plural ?? type.label : ''
  const title = type ? `${plural} للإيجار في ${gov.name}` : `وحدات للإيجار في ${gov.name}`
  const description = type
    ? `كل ${plural} المتاحة للإيجار في ${gov.name}. اختار المركز أو القسم وقارن الأسعار وتواصل مع المعلن.`
    : `تصفح وحدات الإيجار المتاحة في محافظة ${gov.name} من ملّاك وسماسرة مباشرة، وفلتر حسب المركز والسعر والمرافق.`
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'إيجار مصر', item: `${env.SITE_URL ?? 'https://ejar-masr.pages.dev'}/` },
      { '@type': 'ListItem', position: 2, name: gov.name, item: `${env.SITE_URL ?? 'https://ejar-masr.pages.dev'}/rent/${gov.slug}` },
      ...(type ? [{ '@type': 'ListItem', position: 3, name: plural }] : []),
    ],
  }
  return renderShell(request, env, { title: `${title} | إيجار مصر`, description, path, jsonLd, cacheControl: 'public, max-age=300, s-maxage=900' })
}
