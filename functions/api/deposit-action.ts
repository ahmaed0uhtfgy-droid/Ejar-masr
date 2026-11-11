import type { Env } from '../_lib/env'
import { commit, getDocument, type Write } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { cairoDayKey, isValidDocId } from '../_lib/logic'
import { addDaysYmd } from '../_lib/rent'
import { notifyWrite, paySettings } from '../_lib/rentdb'

/**
 * Deposit lifecycle. Disputes are settled BETWEEN the owner and the tenant; the platform does not arbitrate.
 *  claim (owner)     : deposit mode "held-claim", after the lease end, inside the claim window -> "claimed"
 *  accept (tenant)   : agrees to the claim -> "settled" (claim amount to the owner, the rest back to the tenant)
 *  reject (tenant)   : refuses the claim -> "disputed" (the money stays frozen)
 *  withdraw (owner)  : drops the claim -> "settled", everything goes back to the tenant
 *  settle (admin)    : executes a decision, never makes one: "held" after the window with no claim -> full refund to the tenant;
 *                      "disputed" -> only with a written note (signed agreement or court order) and the amounts it states
 *  transferred (admin): records that the transfer(s) were made
 * POST /api/deposit-action { leaseId, action, amount?, reason?, note?, ref? }
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const b = await readJson<{ leaseId?: unknown; action?: unknown; amount?: unknown; reason?: unknown; note?: unknown; ref?: unknown }>(request)
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
    const settled = (toOwner: number): Write => upd({ depositStatus: 'settled', depositToOwnerCents: toOwner, depositToTenantCents: dep - toOwner, depositTransfer: 'pending', settledAt: now })
    const tell = (toOwner: number): Write[] => [
      notifyWrite(String(L.tenantId), `dep_${b.leaseId}_set`, 'تمت تسوية التأمين', `هيرجعلك ${(dep - toOwner) / 100} جنيه من التأمين على "${title}".`, unitId),
      notifyWrite(String(L.ownerId), `dep_${b.leaseId}_seto`, 'تمت تسوية التأمين', `هيتحول لك ${toOwner / 100} جنيه من التأمين على "${title}".`, unitId),
    ]
    const st = String(L.depositStatus)

    if (action === 'claim') {
      if (L.ownerId !== user.uid) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.depositMode !== 'held-claim' || st !== 'held') throw new HttpError(409, 'state', 'مفيش تأمين محجوز يتقدم عليه بمطالبة')
      const ended = L.status === 'ended' || String(L.endDate) <= today
      const deadline = String(L.depositClaimUntil ?? addDaysYmd(String(L.endDate), (await paySettings(env)).depositClaimDays))
      if (!ended) throw new HttpError(409, 'early', 'المطالبة بتتفتح بعد نهاية العقد')
      if (today > deadline) throw new HttpError(409, 'late', 'فات ميعاد تقديم المطالبة')
      const cents = Math.round(Number(b.amount) * 100)
      const reason = String(b.reason ?? '').trim()
      if (!Number.isInteger(cents) || cents < 100 || cents > dep) throw new HttpError(400, 'bad-amount', 'مبلغ المطالبة لازم يكون من ١ جنيه لحد قيمة التأمين')
      if (reason.length < 5 || reason.length > 300) throw new HttpError(400, 'bad-reason', 'اكتب سبب المطالبة (٥ حروف على الأقل)')
      await commit(env, [upd({ depositStatus: 'claimed', claimCents: cents, claimReason: reason, claimAt: now }), notifyWrite(String(L.tenantId), `dep_${b.leaseId}_claim`, 'المالك قدّم مطالبة على التأمين', `المالك طلب ${cents / 100} جنيه من التأمين على "${title}". افتح إيجاراتي وردّ بالموافقة أو الرفض.`, unitId)])
      return json({ depositStatus: 'claimed' })
    }

    if (action === 'accept' || action === 'reject') {
      if (L.tenantId !== user.uid) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (st !== 'claimed' && !(action === 'accept' && st === 'disputed')) throw new HttpError(409, 'state', 'مفيش مطالبة تنتظر ردك')
      if (action === 'reject') {
        await commit(env, [upd({ depositStatus: 'disputed', disputeAt: now }), notifyWrite(String(L.ownerId), `dep_${b.leaseId}_rej`, 'المستأجر رفض المطالبة', `المستأجر رفض مطالبتك على التأمين في "${title}". الفلوس متجمّدة لحد ما تتفقوا. تقدر تسحب المطالبة أو تتفاهم معاه.`, unitId)])
        return json({ depositStatus: 'disputed' })
      }
      const toOwner = Number(L.claimCents ?? 0)
      await commit(env, [settled(toOwner), ...tell(toOwner)])
      return json({ depositStatus: 'settled' })
    }

    if (action === 'withdraw') {
      if (L.ownerId !== user.uid) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (st !== 'claimed' && st !== 'disputed') throw new HttpError(409, 'state', 'مفيش مطالبة تسحبها')
      await commit(env, [settled(0), ...tell(0)])
      return json({ depositStatus: 'settled' })
    }

    if (action === 'settle') {
      let toOwner = 0
      const note = String(b.note ?? '').trim()
      if (st === 'held') {
        const ended = L.status === 'ended' || String(L.endDate) < today
        const ready = ended && today > String(L.depositClaimUntil ?? addDaysYmd(String(L.endDate), L.depositMode === 'held-claim' ? (await paySettings(env)).depositClaimDays : 0))
        if (!ready) throw new HttpError(409, 'early', 'التأمين لسه جوه مهلة المطالبة أو العقد ما خلصش')
      } else if (st === 'disputed') {
        if (note.length < 5) throw new HttpError(400, 'need-note', 'اكتب أساس التسوية (اتفاق مكتوب بين الطرفين أو حكم قضائي)')
        toOwner = Math.round(Number(b.amount ?? 0) * 100)
        if (!Number.isInteger(toOwner) || toOwner < 0 || toOwner > dep) throw new HttpError(400, 'bad-amount', 'المبلغ لازم يكون من صفر لحد قيمة التأمين')
      } else throw new HttpError(409, 'state', 'مفيش تأمين للتسوية بالشكل ده')
      await commit(env, [settled(toOwner), upd({ settleNote: note.slice(0, 300) }), ...tell(toOwner)])
      return json({ depositStatus: 'settled' })
    }

    if (action === 'transferred') {
      if (st !== 'settled' || L.depositTransfer !== 'pending') throw new HttpError(409, 'state', 'مفيش تحويل مستني')
      await commit(env, [upd({ depositTransfer: 'done', transferredAt: now, depositRef: String(b.ref ?? '').slice(0, 60) }), notifyWrite(String(L.tenantId), `dep_${b.leaseId}_done`, 'تم تحويل التأمين', `تم تحويل التأمين الخاص بـ "${title}".`, unitId)])
      return json({ depositTransfer: 'done' })
    }
    throw new HttpError(400, 'bad-action', 'إجراء غير صحيح')
  } catch (e) { return errorResponse(e) }
}
