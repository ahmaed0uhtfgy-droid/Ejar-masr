import { normalizeDesign, DEFAULT_DESIGN, type DesignId } from '../../src/lib/designIds'
import { edgeCached } from './edgeLimit'
import type { Env } from './env'
import { getDocument } from './firestore'

/**
 * The site design the admin picked (settings/app.design), for the pages the server renders itself (the blog).
 * Cached at the edge for 10 minutes, so it costs one database read per 10 minutes per data center; any failure falls back to the default design.
 */
export async function siteDesign(env: Env): Promise<DesignId> {
  try {
    return normalizeDesign(await edgeCached('site-design', 600, async () => normalizeDesign((await getDocument(env, 'settings/app'))?.data.design)))
  } catch { return DEFAULT_DESIGN }
}
