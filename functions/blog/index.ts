import { loadDirectory } from '../_lib/articleStore'
import { renderIndex } from '../_lib/articlePages'
import { siteDesign } from '../_lib/design'
import { edgeCached } from '../_lib/edgeLimit'
import type { Env } from '../_lib/env'

/** GET /blog: the list of published articles. The directory is cached at the edge for 5 minutes (one database read serves everybody). */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const page = Number.parseInt(new URL(request.url).searchParams.get('page') ?? '1', 10) || 1
  const design = await siteDesign(env)
  try {
    const entries = await edgeCached('blog-directory', 300, async () => (await loadDirectory(env)).entries.map((e) => ({ ...e, sig: [] })))
    const published = entries.filter((e) => e.status === 'published').sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    return new Response(renderIndex(env, published, page, design), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' } })
  } catch (e) {
    console.error('blog index failed', e)
    return new Response(renderIndex(env, [], 1, design), { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '120' } })
  }
}
