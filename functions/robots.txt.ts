import type { Env } from './_lib/env'
import { siteUrl } from './_lib/env'

/** /robots.txt - built from SITE_URL so the Sitemap line is always right (a hard-coded pages.dev address would break the day you add your own domain). Never touches the database. */
export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /dashboard',
    'Disallow: /account',
    'Disallow: /rentals',
    'Disallow: /login',
    'Disallow: /api/',
    'Disallow: /search?', // filtered/sorted search URLs are endless duplicates; the plain /search page and the landing pages are what should rank
    '',
    `Sitemap: ${siteUrl(env)}/sitemap.xml`,
    '',
  ]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
