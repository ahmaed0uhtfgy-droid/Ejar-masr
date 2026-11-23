import { loadDirectory } from '../_lib/articleStore'
import { edgeCached } from '../_lib/edgeLimit'
import type { Env } from '../_lib/env'

/**
 * GET /api/blog-latest - the three newest published articles, for the "from the blog" strip on the home page.
 * Shares the edge-cached directory with /blog (same key and shape), so it costs no extra database read and is refreshed the moment an article is published.
 * Any failure answers with an empty list: the home page simply shows no strip.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' }
  try {
    const entries = await edgeCached('blog-directory', 300, async () => (await loadDirectory(env)).entries.map((e) => ({ ...e, sig: [] as number[] })))
    const articles = entries.filter((e) => e.status === 'published').sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0)).slice(0, 3)
      .map((e) => ({ slug: e.slug, title: e.title, description: e.description, cover: e.cover, coverAlt: e.coverAlt }))
    return new Response(JSON.stringify({ articles }), { headers: { ...headers, 'Cache-Control': 'public, max-age=300' } })
  } catch {
    return new Response(JSON.stringify({ articles: [] }), { headers: { ...headers, 'Cache-Control': 'no-store' } })
  }
}
