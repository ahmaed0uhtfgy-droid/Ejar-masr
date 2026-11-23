import type { Env } from '../_lib/env'
import { commitGuarded, getDocument, type Write } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { cairoDayKey, isExpiredDate, isValidDocId } from '../_lib/logic'

const DEFAULT_LIMIT = 20
// Accounts younger than 24 h get a smaller allowance: a real new user reveals a handful of numbers, a scraper wants hundreds, and creating
// accounts is free. Costs real users nothing noticeable and no extra database reads (createdAt is already on the profile we loaded).
const NEW_ACCOUNT_LIMIT = 8
const NEW_ACCOUNT_MS = 24 * 3600_000
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
    const created = user.data.createdAt instanceof Date ? user.data.createdAt.getTime() : 0
    const isNew = created > 0 && Date.now() - created < NEW_ACCOUNT_MS
    const limit = isNew ? Math.min(NEW_ACCOUNT_LIMIT, await dailyLimit(env)) : await dailyLimit(env)
    const logPath = `revealLogs/${user.uid}_${unitId}_${day}`
    const counterPath = `revealCounts/${user.uid}_${day}`
    const already = await getDocument(env, logPath)
    const counter = await getDocument(env, counterPath)
    const used = Number(counter?.data.count ?? 0)

    if (!already && used >= limit) throw new HttpError(429, 'limit', 'وصلت للحد اليومي لكشف بيانات التواصل')

    const contacts = await getDocument(env, `contacts/${unitId}`)
    if (!contacts) throw new HttpError(404, 'no-contact', 'بيانات التواصل غير متاحة')

    if (!already) {
      // The counter write is guarded: a burst of parallel requests all read the same count, but only ONE of them can write it. The others get 409
      // instead of slipping past the daily limit (without this, 100 simultaneous requests would all see "0 used" and all succeed).
      const counterWrite: Write = counter
        ? { kind: 'upsert', path: counterPath, data: { count: used + 1 } }
        : { kind: 'create', path: counterPath, data: { count: 1 } } // first reveal of the day: simultaneous first requests conflict on creation
      await commitGuarded(env, [
        { kind: 'create', path: logPath, data: { uid: user.uid, unitId, ownerId: unit.data.ownerId ?? '', day, at: new Date() } },
        counterWrite,
        { kind: 'upsert', path: `unitStats/${unitId}`, data: { ownerId: unit.data.ownerId ?? '' }, increments: { reveals: 1 } },
      ], { [counterPath]: counter?.updateTime })
    }
    return json({ phone: String(contacts.data.phone ?? ''), whatsapp: String(contacts.data.whatsapp ?? ''), remaining: Math.max(0, limit - used - (already ? 0 : 1)) })
  } catch (e) { return errorResponse(e) }
}
