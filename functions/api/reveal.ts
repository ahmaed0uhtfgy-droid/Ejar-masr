import type { Env } from '../_lib/env'
import { commit, getDocument } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { cairoDayKey, isExpiredDate, isValidDocId } from '../_lib/logic'

const DEFAULT_LIMIT = 20
let settingsCache: { at: number; limit: number } | null = null

async function dailyLimit(env: Env): Promise<number> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.limit
  const s = await getDocument(env, 'settings/app')
  const n = Number(s?.data.dailyRevealLimit)
  const limit = Number.isFinite(n) && n >= 1 ? n : DEFAULT_LIMIT
  settingsCache = { at: Date.now(), limit }
  return limit
}

/**
 * POST /api/reveal { unitId }
 * Checks token -> not banned -> unit active & not expired -> per-user daily limit -> logs the reveal -> returns contacts.
 * Revealing the same unit twice on one day costs a single unit of quota (deterministic log id).
 * Limit check and increment are separate calls (best-effort, not a transaction): concurrent requests may overshoot slightly.
 * Cost per call: ~6 reads + 3 writes of the Firestore Spark daily quota.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env)
    const { unitId } = await readJson<{ unitId?: unknown }>(request)
    if (!isValidDocId(unitId)) throw new HttpError(400, 'bad-id', 'رقم الإعلان غير صحيح')

    const unit = await getDocument(env, `units/${unitId}`)
    if (!unit || unit.data.status !== 'active') throw new HttpError(404, 'not-found', 'الإعلان غير متاح')
    if (isExpiredDate(unit.data.expiresAt)) throw new HttpError(410, 'expired', 'انتهت مدة الإعلان')

    const day = cairoDayKey()
    const limit = await dailyLimit(env)
    const logPath = `revealLogs/${user.uid}_${unitId}_${day}`
    const counterPath = `revealCounts/${user.uid}_${day}`
    const already = await getDocument(env, logPath)
    const counter = await getDocument(env, counterPath)
    const used = Number(counter?.data.count ?? 0)

    if (!already && used >= limit) throw new HttpError(429, 'limit', 'وصلت للحد اليومي لكشف بيانات التواصل')

    const contacts = await getDocument(env, `contacts/${unitId}`)
    if (!contacts) throw new HttpError(404, 'no-contact', 'بيانات التواصل غير متاحة')

    if (!already) {
      await commit(env, [
        { kind: 'create', path: logPath, data: { uid: user.uid, unitId, ownerId: unit.data.ownerId ?? '', day, at: new Date() } },
        { kind: 'increment', path: counterPath, field: 'count' },
        { kind: 'upsert', path: `unitStats/${unitId}`, data: { ownerId: unit.data.ownerId ?? '' }, increments: { reveals: 1 } },
      ])
    }
    return json({ phone: String(contacts.data.phone ?? ''), whatsapp: String(contacts.data.whatsapp ?? ''), remaining: Math.max(0, limit - used - (already ? 0 : 1)) })
  } catch (e) { return errorResponse(e) }
}
