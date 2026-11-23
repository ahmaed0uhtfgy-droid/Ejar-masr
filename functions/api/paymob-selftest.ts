import type { Env } from '../_lib/env'
import { siteUrl } from '../_lib/env'
import { errorResponse, json, requireUser } from '../_lib/http'
import { createIntention } from '../_lib/paymob'

/**
 * POST /api/paymob-selftest (admin only) - checks the payment setup WITHOUT charging anyone:
 * every Paymob setting is present, Paymob accepts our keys, and its answer contains the order id that pay-webhook relies on
 * to recognise a payment. Creating an intention moves no money and nothing is shown to any user.
 * It cannot prove the callback arrives with the same order id: only one real test payment proves that (see docs/PAYMOB-TEST.md).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireUser(request, env, { admin: true })
    const checks: { label: string; ok: boolean; detail?: string }[] = []
    const set = (label: string, v: unknown, detail?: string) => checks.push({ label, ok: !!v, detail: v ? undefined : detail })
    set('PAYMOB_SECRET_KEY موجود', env.PAYMOB_SECRET_KEY, 'ناقص في متغيرات Cloudflare')
    set('PAYMOB_PUBLIC_KEY موجود', env.PAYMOB_PUBLIC_KEY, 'ناقص في متغيرات Cloudflare')
    const ids = (env.PAYMOB_INTEGRATION_IDS ?? '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0)
    set('PAYMOB_INTEGRATION_IDS صحيح', ids.length, 'لازم أرقام مفصولة بفاصلة')
    set('PAYMOB_HMAC_SECRET موجود', env.PAYMOB_HMAC_SECRET, 'من غيره كل الدفعات هتترفض')
    set('SITE_URL مضبوط (رابط الـ webhook)', env.SITE_URL, `هيتستخدم ${siteUrl(env)}`)
    if (checks.every((c) => c.ok)) {
      try {
        const r = await createIntention(env, { amountCents: 1000, title: 'Paymob self-test', reference: `selftest-${Date.now()}`, paymentId: 'selftest', name: 'Self Test', email: 'selftest@example.com', phone: '01000000000', notificationUrl: `${siteUrl(env)}/api/pay-webhook`, redirectionUrl: `${siteUrl(env)}/rentals` })
        checks.push({ label: 'Paymob قبل المفاتيح ورجّع رقم أوردر', ok: !!r.orderId, detail: r.orderId ? `order id: ${r.orderId}` : 'الرد من غير رقم أوردر' })
      } catch (e) { checks.push({ label: 'Paymob قبل المفاتيح ورجّع رقم أوردر', ok: false, detail: e instanceof Error ? e.message : 'فشل' }) }
    }
    return json({ ok: checks.every((c) => c.ok), checks })
  } catch (e) { return errorResponse(e) }
}
