import type { Env } from '../_lib/env'
import { commit, getDocument, runQuery, type Write } from '../_lib/firestore'
import { json } from '../_lib/http'
import { verifyCallbackHmac } from '../_lib/paymob'
import { notifyWrite } from '../_lib/rentdb'

type Obj = Record<string, unknown>
const rec = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {})

/**
 * POST /api/pay-webhook?hmac=...  — Paymob "Transaction processed callback".
 * The HMAC is verified first; nothing else is trusted. The amount and currency must equal what we stored.
 * Handlers are idempotent (Paymob may deliver the same callback more than once).
 * Set this URL as the Transaction processed callback in the Paymob dashboard too (it is also sent per-intention).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const hmac = new URL(request.url).searchParams.get('hmac') ?? ''
  let body: Obj
  try { body = (await request.json()) as Obj } catch { return json({ error: 'bad-json' }, 400) }
  const obj = rec(body.obj)
  if (body.type !== 'TRANSACTION' || !Object.keys(obj).length) return json({ ok: true, ignored: true })
  if (!(await verifyCallbackHmac(obj, hmac, env.PAYMOB_HMAC_SECRET ?? ''))) return json({ error: 'bad-hmac' }, 401)

  try {
    const order = rec(obj.order)
    const claims = rec(rec(obj.payment_key_claims).extra)
    const ref = String(order.merchant_order_id ?? '')
    let paymentId = /^[A-Za-z0-9]{10,40}_\d{1,3}(?:-|$)/.test(ref) ? ref.split('-')[0] : String(claims.paymentId ?? '')
    if (!/^[A-Za-z0-9]{10,40}_\d{1,3}$/.test(paymentId) && order.id !== undefined) {
      const hit = await runQuery(env, { collection: 'payments', where: [{ field: 'gatewayOrderId', op: 'EQUAL', value: String(order.id) }], limit: 1 })
      paymentId = hit[0]?.id ?? ''
    }
    const pay = paymentId ? await getDocument(env, `payments/${paymentId}`) : null
    if (!pay) {
      console.error('pay-webhook: unknown payment', ref)
      const tid = String(obj.id ?? '')
      if (obj.success === true && obj.pending === false && tid) { // a signed, successful payment we cannot attach to anything: keep a trace for manual reconciliation
        try { await commit(env, [{ kind: 'create', path: `unmatchedCallbacks/${tid}`, data: { paymentId, orderId: String(order.id ?? ''), knownOrders: [], amountCents: Number(obj.amount_cents), at: new Date() } }]) } catch { /* already recorded */ }
      }
      return json({ ok: true, ignored: true })
    }
    const P = pay.data
    // SECURITY: Paymob's HMAC covers the transaction id, amount and order.id, but NOT merchant_order_id / extras, which are what we used above to pick the
    // payment. Without this check a tenant could replay one genuine signed callback retargeted at another installment of the same amount.
    // order.id IS signed, so require it to be one of the Paymob orders we created for THIS payment (pay-create records every attempt).
    const knownOrders = [P.gatewayOrderId, ...(Array.isArray(P.gatewayOrderIds) ? P.gatewayOrderIds : [])].map((x) => String(x ?? '')).filter(Boolean)
    if (!knownOrders.includes(String(order.id ?? ''))) {
      console.error('pay-webhook: order does not belong to this payment', paymentId, order.id)
      // Signed by Paymob and successful, yet not tied to any order we created: either a replay attempt or (if our order-id assumption is wrong)
      // a REAL payment. Keep a server-only record so the admin can reconcile it by hand instead of the money vanishing without a trace.
      const seenTxn = String(obj.id ?? '') // (txnId is declared further down)
      if (obj.success === true && obj.pending === false && seenTxn) {
        try { await commit(env, [{ kind: 'create', path: `unmatchedCallbacks/${seenTxn}`, data: { paymentId, orderId: String(order.id ?? ''), knownOrders, amountCents: Number(obj.amount_cents), at: new Date() } }]) } catch { /* already recorded */ }
      }
      return json({ ok: true, ignored: true })
    }
    const txnId = String(obj.id ?? '')
    const now = new Date()

    const refunded = obj.is_refunded === true || obj.is_voided === true
    const success = obj.success === true && obj.pending === false && !refunded && obj.error_occured !== true

    if (refunded && P.status === 'paid') {
      await commit(env, [{ kind: 'upsert', path: `payments/${paymentId}`, data: { status: 'refunded', payoutStatus: P.payoutStatus === 'paid' ? 'paid' : 'cancelled', refundedAt: now } }])
      return json({ ok: true })
    }
    if (success) {
      if (Number(obj.amount_cents) !== Number(P.amountCents) || obj.currency !== 'EGP') {
        console.error('pay-webhook: amount mismatch', paymentId, obj.amount_cents, P.amountCents)
        return json({ ok: true, ignored: true })
      }
      if (P.status === 'paid') {
        // The same transaction delivered twice is normal. A DIFFERENT successful transaction for an already-paid installment means the tenant was
        // charged twice (e.g. two checkout tabs). Record it, otherwise nobody would ever know that money needs refunding.
        if (txnId && txnId !== String(P.gatewayTxnId ?? '')) {
          const seen = Array.isArray(P.extraCharges) ? (P.extraCharges as unknown[]).map(String) : []
          if (!seen.includes(txnId)) {
            console.error('pay-webhook: DOUBLE CHARGE, refund needed', paymentId, txnId)
            await commit(env, [{ kind: 'upsert', path: `payments/${paymentId}`, data: { extraCharges: [...seen, txnId].slice(-10), extraChargeAt: new Date() } }])
          }
        }
        return json({ ok: true, duplicate: true })
      }
      // Escrow: the money stays with the platform ("held") until the tenant confirms receiving the unit.
      const lease = await getDocument(env, `leases/${String(P.leaseId)}`)
      const released = !!lease?.data.moveInConfirmedAt
      const net = Number(P.netCents)
      const writes: Write[] = [
        { kind: 'upsert', path: `payments/${paymentId}`, data: { status: 'paid', paidAt: now, gatewayTxnId: txnId, payoutStatus: net <= 0 ? 'none' : released ? 'pending' : 'held', ...(released && net > 0 ? { releasedAt: now } : {}) } },
        notifyWrite(String(P.tenantId), `pay_${paymentId}_t`, 'تم الدفع بنجاح', `تم استلام ${String(P.amount)} جنيه. الفلوس محجوزة في الموقع ومش هتتحول للمالك إلا لما تأكد إنك استلمت الوحدة.`, String(P.unitId)),
        notifyWrite(String(P.ownerId), `pay_${paymentId}_o`, 'وصلتك دفعة إيجار', released ? `المستأجر دفع ${String(P.amount)} جنيه وهتتحول لك قريبًا.` : `المستأجر دفع ${String(P.amount)} جنيه. الفلوس محجوزة في الموقع وهتتحرر لما المستأجر يأكد استلام الوحدة.`, String(P.unitId)),
      ]
      const leaseData: Record<string, unknown> = {}
      if (lease && !lease.data.firstPaidAt) leaseData.firstPaidAt = now
      if (lease && Number(P.depositCents) > 0) leaseData.depositStatus = 'held'
      if (Object.keys(leaseData).length) writes.push({ kind: 'upsert', path: `leases/${String(P.leaseId)}`, data: leaseData })
      await commit(env, writes)
      return json({ ok: true })
    }
    if (obj.pending === false && obj.success === false && P.status !== 'paid') {
      await commit(env, [{ kind: 'upsert', path: `payments/${paymentId}`, data: { status: 'failed', lastFailedAt: now } }])
    }
    return json({ ok: true })
  } catch (e) {
    console.error('pay-webhook error', e)
    return json({ error: 'server' }, 500) // non-2xx so Paymob retries
  }
}
