import type { Env } from '../_lib/env'
import { commit, getDocument, runQuery } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { cairoDayKey, isExpiredDate, isValidDocId } from '../_lib/logic'
import { buildTerms, toCents } from '../_lib/rent'
import { PHONE_RE, depositModeOf, limitsOf, newId, notifyWrite, paySettings, policyRequired } from '../_lib/rentdb'

/**
 * POST /api/lease-request { unitId, startDate, durationMonths?, days?, cycleMonths?, phone, note? }
 * Creates a lease request (status "requested") for the owner to accept or reject. No money moves here.
 * Deposit rules come from the unit (owner's choice); fee, limits and the on/off switch come from the admin settings.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env)
    const S = await paySettings(env)
    if (!S.paymentsEnabled) throw new HttpError(503, 'disabled', 'الإيجار والدفع الإلكتروني متوقف مؤقتًا')
    const b = await readJson<Record<string, unknown>>(request)
    if (!isValidDocId(b.unitId)) throw new HttpError(400, 'bad-id', 'رقم الإعلان غير صحيح')
    const needPolicy = await policyRequired(env)
    if (needPolicy && (typeof b.acceptedPolicy !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.acceptedPolicy))) throw new HttpError(400, 'policy', 'لازم توافق على سياسة الإيجار والدفع')
    const phone = String(b.phone ?? '').trim()
    if (!PHONE_RE.test(phone)) throw new HttpError(400, 'bad-phone', 'اكتب رقم تليفون صحيح')
    const note = String(b.note ?? '').slice(0, 300)

    const unit = await getDocument(env, `units/${b.unitId}`)
    if (!unit || unit.data.status !== 'active' || isExpiredDate(unit.data.expiresAt)) throw new HttpError(404, 'not-found', 'الوحدة مش متاحة للإيجار')
    const ownerId = String(unit.data.ownerId ?? '')
    if (ownerId === user.uid) throw new HttpError(400, 'own-unit', 'مينفعش تأجّر وحدتك')

    const mine = await runQuery(env, { collection: 'leases', where: [{ field: 'tenantId', op: 'EQUAL', value: user.uid }], limit: 100 })
    const open = mine.filter((l) => l.data.status === 'requested' || l.data.status === 'active')
    if (open.some((l) => l.data.unitId === b.unitId)) throw new HttpError(409, 'duplicate', 'عندك طلب أو عقد شغال على الوحدة دي بالفعل')
    if (open.length >= S.maxOpenRequests) throw new HttpError(429, 'too-many', 'وصلت للحد الأقصى من الطلبات المفتوحة')

    const rentType = unit.data.rentType === 'daily' ? 'daily' : 'monthly'
    const price = Number(unit.data.price)
    const terms = buildTerms({
      rentType, price, startDate: String(b.startDate ?? ''),
      durationMonths: Number(b.durationMonths), days: Number(b.days), cycleMonths: Number(b.cycleMonths),
    }, cairoDayKey(), limitsOf(S))
    if (!terms.ok) throw new HttpError(400, 'bad-terms', terms.message)

    const depositMode = rentType === 'monthly' ? depositModeOf(unit.data.depositMode) : 'none'
    const depositCents = depositMode !== 'none' && Number(unit.data.deposit) > 0 ? toCents(Number(unit.data.deposit)) : 0
    const id = newId()
    const now = new Date()
    const tenantName = String(user.data.displayName ?? '').slice(0, 60)
    await commit(env, [
      {
        kind: 'create', path: `leases/${id}`,
        data: {
          unitId: b.unitId, unitTitle: String(unit.data.title ?? '').slice(0, 120), ownerId, ownerName: String(unit.data.ownerName ?? ''),
          tenantId: user.uid, tenantName, tenantPhone: phone, note,
          rentType, price, startDate: String(b.startDate), endDate: terms.endDate,
          durationMonths: rentType === 'monthly' ? Number(b.durationMonths) : null,
          cycleMonths: rentType === 'monthly' ? Number(b.cycleMonths) : null,
          days: rentType === 'daily' ? Number(b.days) : null,
          total: terms.total, installments: terms.schedule.length, feePercent: S.platformFeePercent,
          depositMode: depositCents ? depositMode : 'none', depositCents, depositStatus: depositCents ? 'unpaid' : 'none',
          status: 'requested', policyVersion: typeof b.acceptedPolicy === 'string' ? b.acceptedPolicy : '', policyAcceptedAt: needPolicy ? now : null, feePayer: S.feePayer, cancelFeePercent: S.cancelFeePercent, createdAt: now, updatedAt: now,
        },
      },
      notifyWrite(ownerId, `lease_${id}_req`, 'طلب إيجار جديد', `${tenantName || 'مستخدم'} طلب استئجار "${String(unit.data.title ?? '').slice(0, 60)}". راجع الطلب من لوحة المعلن.`, String(b.unitId)),
    ])
    return json({ leaseId: id })
  } catch (e) { return errorResponse(e) }
}
