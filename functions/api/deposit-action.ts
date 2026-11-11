import type { Env } from '../_lib/env'
import { commit, getDocument, type Write } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { cairoDayKey, isValidDocId } from '../_lib/logic'
import { addDaysYmd } from '../_lib/rent'
import { notifyWrite, paySettings } from '../_lib/rentdb'

/**
 * POST /api/deposit-action { leaseId, action, amount?, reason?, ref? }
 *  claim (owner)       : deposit mode "held-claim", after the lease end and inside the claim window -> status "claimed"
 *  settle (admin)      : decides how the held deposit is split (amount = EGP to the owner, the rest goes back to the tenant) -> "settled", transfer "pending"
 *  transferred (admin) : records that the transfer(s) were made -> transfer "done"
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const b = await readJson<{ leaseId?: unknown; action?: unknown; amount?: unknown; reason?: unknown; ref?: unknown }>(request)
    const action = String(b.action)
    const user = await requireUser(request, env, { admin: action === 'settle' || action === 'transferred' })
    if (!isValidDocId(b.leaseId)) throw new HttpError(400, 'bad-id', 'رقم العقد غير صحيح')
    const lease = await getDocument(env, `leases/${b.leaseId}`)
    if (!lease) throw new HttpError(404, 'not-found', 'العقد مش موجود')
    const L = lease.data
    const now = new Date(), today = cairoDayKey()
    const dep = Number(L.depositCents ?? 0)
    const title = String(L.unitTitle ?? '').slice(0, 60)
    const unitId = String(L.unitId)
    const upd = (data: Record<string, unknown>): Write => ({ kind: 'upsert', path: `leases/${b.leaseId}`, data: { ...data, updatedAt: now } })

    if (action === 'claim') {
      if (L.ownerId !== user.uid) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.depositMode !== 'held-claim' || L.depositStatus !== 'held') throw new HttpError(409, 'state', 'مفيش تأمين محجوز يتقدم عليه بمطالبة')
      const ended = L.status === 'ended' || String(L.endDate) <= today
      const deadline = String(L.depositClaimUntil ?? addDaysYmd(String(L.endDate), (await paySettings(env)).depositClaimDays))
      if (!ended) throw new HttpError(409, 'early', 'المطالبة بتتفتح بعد نهاية العقد')
      if (today > deadline) throw new HttpError(409, 'late', 'فات ميعاد تقديم المطالبة')
      const cents = Math.round(Number(b.amount) * 100)
      const reason = String(b.reason ?? '').trim()
      if (!Number.isInteger(cents) || cents < 100 || cents > dep) throw new HttpError(400, 'bad-amount', 'مبلغ المطالبة لازم يكون من ١ جنيه لحد قيمة التأمين')
      if (reason.length < 5 || reason.length > 300) throw new HttpError(400, 'bad-reason', 'اكتب سبب المطالبة (٥ حروف على الأقل)')
      await commit(env, [upd({ depositStatus: 'claimed', claimCents: cents, claimReason: reason, claimAt: now }), notifyWrite(String(L.tenantId), `dep_${b.leaseId}_claim`, 'المالك قدّم مطالبة على التأمين', `المالك طلب جزء من التأمين على "${title}". الإدارة هتراجع وتقرر.`, unitId)])
      return json({ depositStatus: 'claimed' })
    }

    if (action === 'settle') {
      if (L.depositStatus !== 'held' && L.depositStatus !== 'claimed') throw new HttpError(409, 'state', 'مفيش تأمين محجوز للتسوية')
      const toOwner = Math.round(Number(b.amount ?? 0) * 100)
      if (!Number.isInteger(toOwner) || toOwner < 0 || toOwner > dep) throw new HttpError(400, 'bad-amount', 'المبلغ لازم يكون من صفر لحد قيمة التأمين')
      const toTenant = dep - toOwner
      await commit(env, [
        upd({ depositStatus: 'settled', depositToOwnerCents: toOwner, depositToTenantCents: toTenant, depositTransfer: 'pending', settledAt: now }),
        notifyWrite(String(L.tenantId), `dep_${b.leaseId}_set`, 'تمت تسوية التأمين', `هيرجعلك ${toTenant / 100} جنيه من التأمين على "${title}".`, unitId),
        notifyWrite(String(L.ownerId), `dep_${b.leaseId}_seto`, 'تمت تسوية التأمين', `هيتحول لك ${toOwner / 100} جنيه من التأمين على "${title}".`, unitId),
      ])
      return json({ depositStatus: 'settled' })
    }

    if (action === 'transferred') {
      if (L.depositStatus !== 'settled' || L.depositTransfer !== 'pending') throw new HttpError(409, 'state', 'مفيش تحويل مستني')
      await commit(env, [upd({ depositTransfer: 'done', transferredAt: now, depositRef: String(b.ref ?? '').slice(0, 60) }), notifyWrite(String(L.tenantId), `dep_${b.leaseId}_done`, 'تم تحويل التأمين', `تم تحويل التأمين الخاص بـ "${title}".`, unitId)])
      return json({ depositTransfer: 'done' })
    }
    throw new HttpError(400, 'bad-action', 'إجراء غير صحيح')
  } catch (e) { return errorResponse(e) }
}
