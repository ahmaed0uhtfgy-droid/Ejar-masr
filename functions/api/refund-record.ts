import type { Env } from '../_lib/env'
import { commit, getDocument, type Write } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { isValidDocId } from '../_lib/logic'
import { notifyWrite } from '../_lib/rentdb'

/**
 * POST /api/refund-record { paymentId, amount (EGP refunded), note? }   (admin only)
 * Records a refund that was done manually in the Paymob dashboard. Only money still held in escrow can be refunded here;
 * money already released to the owner is never touched by this endpoint.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env, { admin: true })
    const b = await readJson<{ paymentId?: unknown; amount?: unknown; note?: unknown }>(request)
    const id = String(b.paymentId ?? '')
    if (!/^[A-Za-z0-9]{10,40}_\d{1,3}$/.test(id) || !isValidDocId(id.split('_')[0])) throw new HttpError(400, 'bad-id', 'رقم الدفعة غير صحيح')
    const pay = await getDocument(env, `payments/${id}`)
    if (!pay) throw new HttpError(404, 'not-found', 'الدفعة مش موجودة')
    const P = pay.data
    if (P.status !== 'paid' || P.payoutStatus !== 'held') throw new HttpError(409, 'state', 'الدفعة دي مش محجوزة. مينفعش تسجّل ردها من هنا.')
    const cents = Math.round(Number(b.amount) * 100)
    if (!Number.isInteger(cents) || cents < 0 || cents > Number(P.amountCents)) throw new HttpError(400, 'bad-amount', 'مبلغ الرد غير صحيح')
    const w: Write[] = [
      { kind: 'upsert', path: `payments/${id}`, data: { status: 'refunded', payoutStatus: 'cancelled', refundCents: cents, refundNote: String(b.note ?? '').slice(0, 200), refundedAt: new Date() } },
      notifyWrite(String(P.tenantId), `ref_${id}_t`, 'تم رد فلوسك', `تم رد ${cents / 100} جنيه على وسيلة الدفع اللي استخدمتها.`, String(P.unitId)),
      notifyWrite(String(P.ownerId), `ref_${id}_o`, 'تم رد دفعة للمستأجر', 'الإدارة ردّت دفعة محجوزة للمستأجر.', String(P.unitId)),
    ]
    if (Number(P.depositCents) > 0) w.push({ kind: 'upsert', path: `leases/${String(P.leaseId)}`, data: { depositStatus: 'none', updatedAt: new Date() } })
    await commit(env, w)
    return json({ ok: true })
  } catch (e) { return errorResponse(e) }
}
