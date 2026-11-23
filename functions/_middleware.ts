import type { Env } from './_lib/env'
import { withSecurityHeaders } from './_lib/securityHeaders'

// Runs for every route listed in public/_routes.json (/, /api/*, /unit/*, /rent/*, /sitemap.xml).
export const onRequest: PagesFunction<Env> = async ({ next }) => withSecurityHeaders(await next())
