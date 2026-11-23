// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { onRequestGet as latest } from '../api/blog-latest'
import { onRequestPost as admin } from '../api/articles-admin'
import { onRequestGet as llms } from '../llms.txt'
import { onRequestGet as sitemap } from '../sitemap.xml'
import { CSP } from '../_lib/securityHeaders'
import { ADMIN, OTHER, as, call, seedUser, useWorld } from './harness'

vi.mock('../_lib/google', () => import('./fakeGoogle'))

// NOTE: written without being able to run it (no network to install dependencies in the session that wrote it). Run `npm test` and fix any mismatch first.
const w = useWorld()
beforeEach(() => {
  const s = new Map<string, { res: Response; until: number }>()
  vi.stubGlobal('caches', { default: {
    match: async (r: Request) => { const e = s.get(r.url); return e && e.until > Date.now() ? e.res.clone() : undefined },
    put: async (r: Request, x: Response) => { s.set(r.url, { res: x, until: Date.now() + Number(/max-age=(\d+)/.exec(x.headers.get('Cache-Control') ?? '')?.[1] ?? 0) * 1000 }) },
    delete: async (r: Request) => s.delete(r.url),
  } })
  seedUser(w.db, ADMIN, { role: 'admin' })
})
afterEach(() => { vi.unstubAllGlobals() })

const body = ['مقدمة عن شقق للايجار في مدينة نصر وإزاي تختار صح.', '', '## شقق للايجار في مدينة نصر', '', 'فقرة كاملة عن الموضوع بتفاصيل كفاية للاختبار.'].join('\n')
const act = (action: string, extra: Record<string, unknown> = {}) => call(admin, w.env, { path: '/api/articles-admin', token: as(ADMIN), body: { action, ...extra } })
const get = (h: Parameters<typeof call>[0], path: string) => call(h, w.env, { method: 'GET', path })

describe('blog activation', () => {
  it('llms.txt lists the main pages and no articles section when nothing is published', async () => {
    const r = await get(llms, '/llms.txt')
    expect(r.status).toBe(200)
    expect(r.text).toContain('# إيجار مصر')
    expect(r.text).toContain('/blog')
    expect(r.text).not.toContain('## المقالات')
  })

  it('a published article appears in llms.txt and the sitemap; a draft appears in neither', async () => {
    const saved = await act('save', { title: 'شقق للايجار في مدينة نصر: دليل المعاينة', primary: 'شقق للايجار في مدينة نصر', description: 'وصف', body })
    expect(saved.status).toBe(200)
    const slug = saved.json.slug as string
    expect((await get(llms, '/llms.txt')).text).not.toContain(slug)
    expect((await get(sitemap, '/sitemap.xml')).text).not.toContain('/blog')
    expect((await act('publish', { slug })).status).toBe(200)
    expect((await get(llms, '/llms.txt')).text).toContain(`/blog/${encodeURIComponent(slug)}`)
    const sm = (await get(sitemap, '/sitemap.xml')).text
    expect(sm).toContain('<loc>https://site.test/blog</loc>')
    expect(sm).toContain(`/blog/${encodeURIComponent(slug)}`)
  })

  it('the admin preview of a draft is noindex and says it is not published', async () => {
    const slug = (await act('save', { title: 'شقق للايجار في مدينة نصر: دليل المعاينة', primary: 'شقق للايجار في مدينة نصر', body })).json.slug as string
    const p = await act('preview', { slug })
    expect(p.status).toBe(200)
    expect(p.json.html).toContain('noindex,nofollow')
    expect(p.json.html).toContain('معاينة')
  })

  it('only an admin can use the article admin API', async () => {
    seedUser(w.db, OTHER)
    expect((await call(admin, w.env, { path: '/api/articles-admin', token: as(OTHER), body: { action: 'list' } })).status).toBe(403)
    expect((await call(admin, w.env, { path: '/api/articles-admin', body: { action: 'list' } })).status).toBe(401)
  })

  it('the AI check tells the admin plainly when no key is configured', async () => {
    const r = await act('ai-check')
    expect(r.status).toBe(503)
  })

  it('routes the blog and llms.txt to the Functions, and the CSP lets articles embed YouTube', () => {
    const routes = JSON.parse(readFileSync('public/_routes.json', 'utf8')) as { include: string[] }
    for (const r of ['/blog', '/blog/*', '/llms.txt']) expect(routes.include).toContain(r)
    expect(CSP.split('; ').find((d) => d.startsWith('frame-src'))).toContain('https://www.youtube-nocookie.com')
  })
})


describe('home page strip endpoint', () => {
  it('returns only published articles, newest first, max 3', async () => {
    const mk = async (t: string) => (await act('save', { title: `مقال ${t} عن شقق للايجار في مصر`, primary: `شقق للايجار ${t}`, body })).json.slug as string
    const [a, b, c, d] = [await mk('اولا'), await mk('ثانيا'), await mk('ثالثا'), await mk('رابعا')]
    expect((await get(latest, '/api/blog-latest')).json.articles).toEqual([])
    for (const s of [a, b, c, d]) { await act('publish', { slug: s }); vi.setSystemTime(Date.now() + 1000) }
    const r = (await get(latest, '/api/blog-latest')).json.articles as { slug: string }[]
    expect(r.map((x) => x.slug)).toEqual([d, c, b])
  })
})
