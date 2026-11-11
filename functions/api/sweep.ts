import type { Env } from '../_lib/env'
import { sendEmail } from '../_lib/email'
import { siteUrl } from '../_lib/env'
import { commit, getDocument, runQuery, type Doc, type Write } from '../_lib/firestore'
import { errorResponse, json, requireUser } from '../_lib/http'
import { closeLeaseWrites } from '../_lib/leasing'
import { cairoDayKey } from '../_lib/logic'
import { daysBetween } from '../_lib/rent'
import { notifyWrite, paySettings } from '../_lib/rentdb'
import { timingSafeEqual } from '../_lib/paymob'

// Cloudflare's free plan allows ~50 subrequests per invocation, so each run stops at a budget and reports `more: true`.
// The scheduled workflow keeps calling until `more` is false. Dedupe markers live on the lease/payment docs (no extra reads).
const BUDGET = 42

/**
 * POST /api/sweep  (Authorization: Bearer <CRON_SECRET>, or an admin's Firebase ID token)
 *  1. ends leases whose agreed period is over and re-lists their unit
 *  2. asks tenants "did you receive the unit?" daily until they answer (money stays held until they do)
 *  3. reminds tenants about upcoming / due / overdue installments (in-app + email), using the days the owner chose
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    const cronOk = !!env.CRON_SECRET && !!token && timingSafeEqual(token, env.CRON_SECRET)
    if (!cronOk) await requireUser(request, env, { admin: true })

    const S = await paySettings(env)
    const today = cairoDayKey()
    const link = `${siteUrl(env)}/rentals`
    let used = 4
    const stats = { ended: 0, moveInReminders: 0, installmentReminders: 0, emails: 0 }
    let more = false
    const emails = new Map<string, string>()
    const emailOf = async (uid: string): Promise<string> => {
      if (!emails.has(uid)) { used++; emails.set(uid, String((await getDocument(env, `users/${uid}`))?.data.email ?? '')) }
      return emails.get(uid)!
    }
    const tell = async (uid: string, key: string, title: string, body: string, unitId: string, extra: Write[]) => {
      await commit(env, [notifyWrite(uid, key, title, body, unitId), ...extra]); used++
      const to = await emailOf(uid)
      if (to && (await sendEmail(env, to, title, body, link))) { stats.emails++; used++ }
    }

    const active = await runQuery(env, { collection: 'leases', where: [{ field: 'status', op: 'EQUAL', value: 'active' }], limit: 500 }); used++
    const live = new Map<string, Doc>()

    for (const l of active) {
      if (used + 4 > BUDGET) { more = true; break }
      if (String(l.data.endDate) < today) {
        const pays = await runQuery(env, { collection: 'payments', where: [{ field: 'leaseId', op: 'EQUAL', value: l.id }], limit: 100 })
        const unit = await getDocument(env, `units/${String(l.data.unitId)}`)
        const title = String(l.data.unitTitle ?? '').slice(0, 60)
        await commit(env, [
          ...closeLeaseWrites(l.id, l.data, 'ended', pays, unit, today, S, { uid: String(l.data.tenantId), title: 'انتهى العقد', body: `انتهت مدة العقد على "${title}".` }),
          notifyWrite(String(l.data.ownerId), `lease_${l.id}_endo`, 'انتهى العقد', `انتهت مدة العقد على "${title}" والوحدة رجعت متاحة للعرض.`, String(l.data.unitId)),
        ])
        used += 3; stats.ended++
        continue
      }
      live.set(l.id, l)
      const needsMoveIn = !!l.data.firstPaidAt && !l.data.moveInConfirmedAt && String(l.data.startDate) <= today
      if (needsMoveIn && l.data.moveInRemindedOn !== today && daysBetween(String(l.data.startDate), today) <= S.moveInReminderDays) {
        if (used + 4 > BUDGET) { more = true; break }
        const title = String(l.data.unitTitle ?? '').slice(0, 60)
        await tell(String(l.data.tenantId), `mov_${l.id}_${today}`, 'هل استلمت الوحدة؟', `لو استلمت "${title}" أكّد الاستلام من صفحة إيجاراتي عشان الفلوس المحجوزة تتحول للمالك. لو لسه ما استلمتش بلّغنا من نفس الصفحة.`, String(l.data.unitId), [{ kind: 'upsert', path: `leases/${l.id}`, data: { moveInRemindedOn: today } }])
        stats.moveInReminders++
      }
    }

    if (!more) {
      for (const st of ['due', 'failed']) {
        if (used + 2 > BUDGET) { more = true; break }
        const pays = await runQuery(env, { collection: 'payments', where: [{ field: 'status', op: 'EQUAL', value: st }], limit: 500 }); used++
        for (const p of pays) {
          const lease = live.get(String(p.data.leaseId))
          if (!lease) continue
          const dl = daysBetween(today, String(p.data.dueDate))
          const rd = Number(lease.data.reminderDays ?? S.defaultReminderDays)
          const over = -dl
          const hit = dl === rd || dl === 1 || dl === 0 || (over > 0 && over <= 13 && over % 3 === 1)
          const mark = `${today}`
          if (!hit || p.data.remindedOn === mark) continue
          if (used + 4 > BUDGET) { more = true; break }
          const title = String(lease.data.unitTitle ?? '').slice(0, 60)
          const when = dl > 0 ? `باقي ${dl} يوم على قسط الإيجار` : dl === 0 ? 'قسط الإيجار مستحق النهارده' : `قسط الإيجار متأخر ${over} يوم`
          await tell(String(p.data.tenantId), `rem_${p.id}_${dl}`, `${when} — ${title}`, `${when} بقيمة ${String(p.data.amount)} جنيه. ادفع من صفحة إيجاراتي.`, String(p.data.unitId), [{ kind: 'upsert', path: `payments/${p.id}`, data: { remindedOn: mark } }])
          stats.installmentReminders++
        }
        if (more) break
      }
    }
    return json({ ok: true, today, more, used, ...stats })
  } catch (e) { return errorResponse(e) }
}
