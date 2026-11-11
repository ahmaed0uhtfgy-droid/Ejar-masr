import type { Env } from '../_lib/env'
import { commit, getDocument, runQuery } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { siteUrl } from '../_lib/env'
import { createIntention, paymobConfigured } from '../_lib/paymob'
import { newId, paySettings } from '../_lib/rentdb'

const PAYABLE = ['due', 'failed', 'pending']

/**
 * POST /api/pay-create { paymentId }
 * Tenant only. Creates a Paymob checkout for one installment and returns { url } to redirect to.
 * The amount always comes from Firestore, never from the client. Payment is confirmed only by /api/pay-webhook.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env)
    const { paymentId } = await readJson<{ paymentId?: unknown }>(request)
    if (typeof paymentId !== 'string' || !/^[A-Za-z0-9]{10,40}_\d{1,3}$/.test(paymentId)) throw new HttpError(400, 'bad-id', 'رقم الدفعة غير صحيح')
    if (!(await paySettings(env)).paymentsEnabled) throw new HttpError(503, 'disabled', 'الدفع الإلكتروني متوقف مؤقتًا')
    if (!paymobConfigured(env)) throw new HttpError(503, 'not-configured', 'الدفع الإلكتروني لسه مش مفعّل')

    const pay = await getDocument(env, `payments/${paymentId}`)
    if (!pay || pay.data.tenantId !== user.uid) throw new HttpError(404, 'not-found', 'الدفعة مش موجودة')
    if (!PAYABLE.includes(String(pay.data.status))) throw new HttpError(409, 'state', pay.data.status === 'paid' ? 'الدفعة دي اتدفعت بالفعل' : 'الدفعة دي مش متاحة للدفع')
    const lease = await getDocument(env, `leases/${pay.data.leaseId}`)
    if (!lease || lease.data.status !== 'active') throw new HttpError(409, 'lease', 'العقد مش شغال')
    if (!lease.data.contractConfirmedAt) throw new HttpError(409, 'contract', 'الدفع بيتفتح بعد ما الطرفين يأكدوا إنهم وقّعوا العقد وعاينوا الوحدة')

    const all = await runQuery(env, { collection: 'payments', where: [{ field: 'leaseId', op: 'EQUAL', value: pay.data.leaseId }], limit: 100 })
    if (all.some((p) => Number(p.data.index) < Number(pay.data.index) && !['paid', 'cancelled', 'refunded'].includes(String(p.data.status)))) throw new HttpError(409, 'pay-earlier', 'ادفع القسط اللي قبله الأول')

    const cents = Number(pay.data.amountCents)
    if (!Number.isInteger(cents) || cents < 100) throw new HttpError(500, 'bad-amount', 'مبلغ الدفعة غير صحيح')
    const { url, orderId } = await createIntention(env, {
      amountCents: cents, title: `ايجار - ${String(lease.data.unitTitle ?? '')}`, reference: `${paymentId}-${newId(6)}`, paymentId,
      name: String(lease.data.tenantName ?? ''), email: String(user.data.email ?? ''), phone: String(lease.data.tenantPhone ?? ''),
      notificationUrl: `${siteUrl(env)}/api/pay-webhook`, redirectionUrl: `${siteUrl(env)}/pay/result?p=${paymentId}`,
    })
    await commit(env, [{ kind: 'upsert', path: `payments/${paymentId}`, data: { status: 'pending', gatewayOrderId: orderId, lastAttemptAt: new Date() } }])
    return json({ url })
  } catch (e) { return errorResponse(e) }
}
