// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet as home } from '../index'
import { onRequestGet as landing } from '../rent/[[path]]'
import { onRequestGet as robots } from '../robots.txt'
import { onRequestGet as sitemap } from '../sitemap.xml'
import { onRequestGet as unitPage } from '../unit/[id]'
import { GOVS } from '../_lib/seo'
import { call, makeEnv, seedUnit, useWorld } from './harness'
import { FakeHTMLRewriter } from './htmlRewriter'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

const w = useWorld()
const CAIRO = GOVS.find((g) => g.slug === 'cairo')!
const GIZA = GOVS.find((g) => g.slug === 'giza')!
beforeEach(() => {
  const s = new Map<string, { res: Response; until: number }>()
  vi.stubGlobal('caches', { default: {
    match: async (r: Request) => { const e = s.get(r.url); return e && e.until > Date.now() ? e.res.clone() : undefined },
    put: async (r: Request, x: Response) => { s.set(r.url, { res: x, until: Date.now() + Number(/max-age=(\d+)/.exec(x.headers.get('Cache-Control') ?? '')?.[1] ?? 0) * 1000 }) },
    delete: async (r: Request) => s.delete(r.url),
  } })
  vi.stubGlobal('HTMLRewriter', FakeHTMLRewriter)
})
afterEach(() => { vi.unstubAllGlobals() })

const listing = (id: string, over: Record<string, unknown> = {}) => seedUnit(w.db, { id, governorateId: CAIRO.id, governorateName: CAIRO.name, areaName: 'مدينة نصر', typeId: 'apartment', typeName: 'شقة', price: 4500, rooms: 3, bathrooms: 1, area: 120, title: `شقة ${id}`, images: ['democloud:units/u/a'], createdAt: new Date(Date.UTC(2027, 1, 1)), ...over })
const getLanding = (path: string) => call(landing, w.env, { method: 'GET', path: `/rent/${path}`, params: { path: path.split('/') } })
const metaRobots = (html: string) => /<meta name="robots" content="([^"]*)"/.exec(html)?.[1]
const canonical = (html: string) => /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1]
const jsonLd = (html: string): Record<string, unknown>[] => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>)
const graph = (html: string): Record<string, unknown>[] => jsonLd(html).flatMap((j) => (j['@graph'] as Record<string, unknown>[] | undefined) ?? [j])

describe('home page', () => {
  it('has title, description, canonical, share image and structured data without running JavaScript', async () => {
    const r = await call(home, w.env, { method: 'GET', path: '/' })
    expect(r.text).toMatch(/<title>[^<]+<\/title>/)
    expect(canonical(r.text)).toBe('https://site.test/')
    expect(metaRobots(r.text)).toContain('index,follow')
    expect(r.text).toContain('property="og:image" content="https://site.test/og-default.png"')
    expect(r.text).toContain('name="twitter:card" content="summary_large_image"')
    const types = graph(r.text).map((g) => g['@type'])
    for (const t of ['WebSite', 'Organization', 'FAQPage']) expect(types).toContain(t)
    expect(r.text).toContain('<h1>')
  })
})

describe('landing pages /rent/<governorate>[/<type>]', () => {
  it('shows the real listings in the HTML (title, price, link) and an ItemList for crawlers', async () => {
    listing('unitAAAAAA0001'); listing('unitAAAAAA0002', { title: 'شقة فاخرة', price: 9000 })
    const r = await getLanding('cairo')
    expect(r.status).toBe(200)
    expect(metaRobots(r.text)).toContain('index,follow')
    expect(r.text).toContain('href="/unit/unitAAAAAA0001"')
    expect(r.text).toContain('شقة فاخرة — 9000 جنيه / شهر')
    const items = graph(r.text).find((g) => g['@type'] === 'ItemList') as { numberOfItems: number; itemListElement: { url: string }[] }
    expect(items.numberOfItems).toBe(2)
    expect(items.itemListElement[0].url).toMatch(/^https:\/\/site\.test\/unit\//)
    expect(r.text).toContain('property="og:image" content="https://res.cloudinary.com/democloud/')
    expect(canonical(r.text)).toBe('https://site.test/rent/cairo')
  })
  it('a governorate with no listing is thin content: noindex,follow (still 200 so users and links keep working)', async () => {
    listing('unitAAAAAA0001')
    const r = await getLanding('giza')
    expect([r.status, metaRobots(r.text)]).toEqual([200, 'noindex,follow'])
    expect(graph(r.text).some((g) => g['@type'] === 'ItemList')).toBe(false)
  })
  it('becomes indexable the moment its first listing appears', async () => {
    expect(metaRobots((await getLanding('giza')).text)).toBe('noindex,follow')
    listing('unitGiza000001', { governorateId: GIZA.id, governorateName: GIZA.name })
    vi.setSystemTime(new Date(Date.now() + 15 * 60_000))
    expect(metaRobots((await getLanding('giza')).text)).toContain('index,follow')
  })
  it('the type page only lists that type, and is noindex when that type has none even if the governorate has listings', async () => {
    listing('unitAAAAAA0001'); listing('unitVilla00001', { typeId: 'villa', typeName: 'فيلا', title: 'فيلا راقية' })
    const villas = await getLanding('cairo/villa')
    expect(villas.text).toContain('فيلا راقية'); expect(villas.text).not.toContain('unitAAAAAA0001')
    expect(metaRobots((await getLanding('cairo/studio')).text)).toBe('noindex,follow')
  })
  it('never lists expired listings', async () => {
    listing('unitAAAAAA0001', { expiresAt: new Date(Date.now() - 1000) }); listing('unitAAAAAA0002')
    const r = await getLanding('cairo')
    expect(r.text).not.toContain('unitAAAAAA0001'); expect(r.text).toContain('unitAAAAAA0002')
  })
  it('with 300+ listings (snapshot cannot see them all) an empty-looking page is NOT marked noindex: no guessing', async () => {
    for (let i = 0; i < 305; i++) listing(`unitMany${String(i).padStart(6, '0')}`, { governorateId: CAIRO.id })
    expect(metaRobots((await getLanding('giza')).text)).toContain('index,follow')
  })
  it('still renders when the listings cannot be read (they are a bonus, never a reason to fail)', async () => {
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response('down', { status: 500 })) as typeof fetch
    const orig = console.error; console.error = () => {}
    const r = await getLanding('cairo')
    console.error = orig; globalThis.fetch = original
    expect(r.status).toBe(200)
    expect(metaRobots(r.text)).toContain('index')
    expect(metaRobots(r.text)).not.toContain('noindex')
  })
  it('unknown governorate or type, or too many segments: a real 404, not indexed', async () => {
    for (const p of ['atlantis', 'cairo/spaceship', 'cairo/villa/extra']) { const r = await getLanding(p); expect([r.status, metaRobots(r.text)]).toEqual([404, 'noindex,follow']) }
  })
})

describe('unit pages', () => {
  const get = (id: string) => call(unitPage, w.env, { method: 'GET', path: `/unit/${id}`, params: { id } })
  it('a live listing: indexable, with canonical, share photo, breadcrumb trail and RealEstateListing + Offer', async () => {
    listing('unitAAAAAA0001', { description: 'شقة رائعة قريبة من المترو' })
    const r = await get('unitAAAAAA0001')
    expect([r.status, canonical(r.text)]).toEqual([200, 'https://site.test/unit/unitAAAAAA0001'])
    expect(metaRobots(r.text)).toContain('index,follow')
    const g = graph(r.text)
    const crumbs = g.find((x) => x['@type'] === 'BreadcrumbList') as { itemListElement: { position: number; name: string; item?: string }[] }
    expect(crumbs.itemListElement.map((c) => c.position)).toEqual([1, 2, 3, 4])
    expect(crumbs.itemListElement[1].item).toBe('https://site.test/rent/cairo')
    expect(crumbs.itemListElement[2].item).toBe('https://site.test/rent/cairo/apartment')
    const l = g.find((x) => x['@type'] === 'RealEstateListing') as { offers: { price: number; priceCurrency: string; availability: string; url: string } }
    expect(l.offers).toMatchObject({ price: 4500, priceCurrency: 'EGP', availability: 'https://schema.org/InStock', url: 'https://site.test/unit/unitAAAAAA0001' })
    expect(r.text).toContain('og:image" content="https://res.cloudinary.com/democloud/')
  })
  it('hidden, rented or expired: still reachable but kept out of the index, without structured data', async () => {
    listing('unitHidden00001', { status: 'hidden' }); listing('unitExpired0001', { expiresAt: new Date(Date.now() - 1000) })
    for (const id of ['unitHidden00001', 'unitExpired0001']) { const r = await get(id); expect([r.status, metaRobots(r.text), jsonLd(r.text).length]).toEqual([200, 'noindex,follow', 0]) }
  })
  it('missing or malformed ids are a real 404', async () => {
    for (const id of ['unitMissing0001', '../x']) { const r = await get(id); expect([r.status, metaRobots(r.text)]).toEqual([404, 'noindex,follow']) }
  })
  it('hostile listing text cannot inject markup into the title, body or structured data', async () => {
    const evil = '</title><script>alert(1)</script>'
    listing('unitEvil0000001', { title: evil, description: `<img src=x onerror=alert(1)> ${evil}`, areaName: evil })
    const r = await get('unitEvil0000001')
    // Inside a quoted attribute value (the <meta> tags) markup is inert text, so look at everything else:
    const outsideAttributes = r.text.replace(/<meta\b(?:[^>"]|"[^"]*")*>/g, '').replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
    expect(outsideAttributes).not.toContain('<script>alert(1)')
    expect(outsideAttributes).not.toContain('<img src=x')
    expect(r.text.match(/<title>/g)).toHaveLength(1)
    const noMeta = r.text.replace(/<meta\b(?:[^>"]|"[^"]*")*>/g, '')
    expect(noMeta.match(/<script/g)).toHaveLength((noMeta.match(/<script type="application\/ld\+json">/g) ?? []).length) // the only script elements are our own JSON-LD blocks
    const desc = /<meta name="description" content="((?:[^"])*)"/.exec(r.text)?.[1] ?? ''
    expect(desc.length).toBeGreaterThan(10) // the description attribute is intact: a quote in the data cannot close it early
    for (const j of jsonLd(r.text)) expect(JSON.stringify(j)).toBeTruthy() // every block still parses as JSON
  })
})

describe('/sitemap.xml', () => {
  const get = () => call(sitemap, w.env, { method: 'GET', path: '/sitemap.xml' })
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  it('lists only pages worth indexing: static pages, live listings, and governorate/type pages that have listings', async () => {
    listing('unitAAAAAA0001'); listing('unitVilla00001', { typeId: 'villa', typeName: 'فيلا' }); listing('unitExpired0001', { expiresAt: new Date(Date.now() - 1000) }); listing('unitHidden00001', { status: 'hidden' })
    const urls = locs((await get()).text)
    for (const u of ['https://site.test/', 'https://site.test/rent/cairo', 'https://site.test/rent/cairo/apartment', 'https://site.test/rent/cairo/villa', 'https://site.test/unit/unitAAAAAA0001']) expect(urls).toContain(u)
    expect(urls).not.toContain('https://site.test/rent/giza')
    expect(urls).not.toContain('https://site.test/rent/cairo/studio')
    expect(urls.some((u) => u.includes('unitExpired0001') || u.includes('unitHidden00001'))).toBe(false)
    expect(new Set(urls).size).toBe(urls.length)
  })
  it('adds lastmod and the listing photos (image sitemap)', async () => {
    listing('unitAAAAAA0001')
    const xml = (await get()).text
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"')
    expect(xml).toContain('<lastmod>2027-02-01</lastmod>')
    expect(xml).toMatch(/<image:loc>https:\/\/res\.cloudinary\.com\/democloud\//)
    expect((xml.match(/<url>/g) ?? []).length).toBe((xml.match(/<\/url>/g) ?? []).length)
  })
  it('an empty site publishes only the static pages (no empty landing pages)', async () => {
    const urls = locs((await get()).text)
    expect(urls.some((u) => u.includes('/rent/'))).toBe(false)
    expect(urls).toContain('https://site.test/search')
  })
  it('costs about one read, not hundreds, and is cached', async () => {
    for (let i = 0; i < 40; i++) listing(`unitS${String(i).padStart(9, '0')}`)
    await get(); w.db.resetCounters()
    for (let i = 0; i < 20; i++) await get()
    expect(w.db.counters.reads).toBe(0)
  })
})

describe('/robots.txt', () => {
  it('points at the sitemap of the configured site and blocks private and duplicate URLs', async () => {
    const r = await call(robots, w.env, { method: 'GET', path: '/robots.txt' })
    expect(r.res.headers.get('Content-Type')).toContain('text/plain')
    expect(r.text).toContain('Sitemap: https://site.test/sitemap.xml')
    for (const d of ['/admin', '/dashboard', '/account', '/rentals', '/api/', '/search?']) expect(r.text).toContain(`Disallow: ${d}`)
    expect(r.text).toContain('Allow: /')
    expect(r.text).not.toMatch(/Disallow:\s*\/\s*$/m) // never blocks the whole site
  })
  it('follows SITE_URL when you move to your own domain, and never touches the database', async () => {
    w.db.resetCounters()
    const r = await call(robots, makeEnv({ SITE_URL: 'https://www.ejar-masr.com' }), { method: 'GET', path: '/robots.txt' })
    expect(r.text).toContain('Sitemap: https://www.ejar-masr.com/sitemap.xml')
    expect(w.db.counters.fetches).toBe(0)
  })
})

describe('project wiring', () => {
  it('the default share image is a 1200x630 PNG', () => {
    const png = readFileSync('public/og-default.png')
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630])
  })
  it('every dynamic route is listed in public/_routes.json (otherwise Cloudflare would serve the static fallback instead)', () => {
    const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8')) as { include: string[] }
    for (const r of ['/', '/api/*', '/unit/*', '/rent/*', '/sitemap.xml', '/robots.txt']) expect(routes.include).toContain(r)
  })
})
