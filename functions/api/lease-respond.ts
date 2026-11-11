import type { Env } from '../_lib/env'
import { commit, getDocument, runQuery, type Write } from '../_lib/firestore'
import { HttpError, errorResponse, json, readJson, requireUser } from '../_lib/http'
import { closeLeaseWrites } from '../_lib/leasing'
import { cairoDayKey, isExpiredDate, isValidDocId } from '../_lib/logic'
import { buildTerms, feeCents, toCents } from '../_lib/rent'
import { limitsOf, notifyWrite, paySettings, splitFee, type FeePayer } from '../_lib/rentdb'

const ACTIONS = ['accept', 'reject', 'cancel', 'end', 'confirm-move-in', 'not-received', 'set-reminder', 'request-cancel', 'confirm-contract'] as const
type Action = (typeof ACTIONS)[number]

/**
 * POST /api/lease-respond { leaseId, action, reminderDays? }
 *  accept (owner)        : requested -> active; builds the payment schedule (+ deposit on the first installment), locks the unit as rented until the lease end
 *  reject (owner)        : requested -> rejected
 *  cancel (tenant)       : requested, or active with nothing paid yet -> cancelled
 *  end (owner/admin)     : active -> ended, cancels unpaid installments, re-lists the unit
 *  confirm-move-in (tenant): "I received the unit" -> held rent is released to the owner (queued for the admin transfer)
 *  not-received (tenant) : flags the lease for the admin; money stays held
 *  request-cancel (tenant): paid but not yet confirmed move-in, only if the admin allows it -> flags the lease for the admin (refund is recorded by the admin)
 *  confirm-contract (owner/tenant): each side confirms that the contract was really signed and the unit was inspected; payment opens only when BOTH did
 *  set-reminder (owner)  : days before each installment on which the tenant gets reminded
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const user = await requireUser(request, env)
    const S = await paySettings(env)
    const { leaseId, action, reminderDays } = await readJson<{ leaseId?: unknown; action?: unknown; reminderDays?: unknown }>(request)
    if (!isValidDocId(leaseId)) throw new HttpError(400, 'bad-id', 'رقم الطلب غير صحيح')
    if (!ACTIONS.includes(action as Action)) throw new HttpError(400, 'bad-action', 'إجراء غير صحيح')
    const lease = await getDocument(env, `leases/${leaseId}`)
    if (!lease) throw new HttpError(404, 'not-found', 'الطلب مش موجود')
    const L = lease.data
    const isOwner = L.ownerId === user.uid, isTenant = L.tenantId === user.uid
    const now = new Date()
    const today = cairoDayKey()
    const unitId = String(L.unitId)
    const title = String(L.unitTitle ?? '').slice(0, 60)
    const set = (status: string, extra: Record<string, unknown> = {}): Write => ({ kind: 'upsert', path: `leases/${leaseId}`, data: { status, updatedAt: now, ...extra } })
    const days = (() => { const n = Math.round(Number(reminderDays)); return Number.isFinite(n) && n >= 1 && n <= 30 ? n : S.defaultReminderDays })()

    if (action === 'accept' || action === 'reject') {
      if (!isOwner) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.status !== 'requested') throw new HttpError(409, 'state', 'الطلب ده اتعالج قبل كده')
    }

    if (action === 'reject') {
      await commit(env, [set('rejected'), notifyWrite(String(L.tenantId), `lease_${leaseId}_rej`, 'تم رفض طلب الإيجار', `المالك رفض طلبك على "${title}".`, unitId)])
      return json({ status: 'rejected' })
    }

    if (action === 'accept') {
      if (!S.paymentsEnabled) throw new HttpError(503, 'disabled', 'الإيجار والدفع الإلكتروني متوقف مؤقتًا')
      const unit = await getDocument(env, `units/${unitId}`)
      if (!unit || unit.data.ownerId !== user.uid || unit.data.status !== 'active' || isExpiredDate(unit.data.expiresAt)) throw new HttpError(409, 'unit', 'الوحدة مش متاحة دلوقتي')
      const terms = buildTerms({
        rentType: L.rentType === 'daily' ? 'daily' : 'monthly', price: Number(L.price), startDate: String(L.startDate),
        durationMonths: Number(L.durationMonths), days: Number(L.days), cycleMonths: Number(L.cycleMonths),
      }, today, limitsOf(S))
      if (!terms.ok) throw new HttpError(409, 'start-passed', 'تاريخ بداية العقد عدّى. اطلب من المستأجر يبعت طلب جديد.')
      const pct = Number(L.feePercent ?? 0), deposit = Number(L.depositCents ?? 0)
      const writes: Write[] = terms.schedule.map((s) => {
        const rent = toCents(s.amount), fee = feeCents(rent, pct), dep = s.index === 0 ? deposit : 0
        const sp = splitFee(fee, (L.feePayer as FeePayer) ?? 'owner')
        return {
          kind: 'create', path: `payments/${leaseId}_${s.index}`,
          data: {
            leaseId, index: s.index, unitId, ownerId: L.ownerId, tenantId: L.tenantId,
            amount: (rent + dep + sp.tenant) / 100, amountCents: rent + dep + sp.tenant, depositCents: dep, feeCents: fee, tenantFeeCents: sp.tenant, netCents: rent - sp.owner,
            from: s.from, to: s.to, dueDate: s.dueDate, status: 'due', payoutStatus: 'none', createdAt: now,
          },
        }
      })
      writes.push(
        set('active', { reminderDays: days }),
        // The unit stays hidden from search until the agreed lease end (the daily sweep re-lists it), and the owner cannot re-open it meanwhile.
        { kind: 'upsert', path: `units/${unitId}`, data: { status: 'rented', rentedUntil: terms.endDate, rentedLeaseId: leaseId, lockedUntil: new Date(`${terms.endDate}T00:00:00Z`) } },
        notifyWrite(String(L.tenantId), `lease_${leaseId}_acc`, 'تم قبول طلب الإيجار', `المالك وافق على "${title}". قابل المالك وعاين الوحدة ووقّعوا العقد، وبعدها أكّدوا الاتنين من صفحة إيجاراتي وساعتها الدفع بيتفتح. الفلوس بتتحجز في الموقع ومبتتحولش للمالك إلا لما تأكد إنك استلمت الوحدة.`, unitId),
      )
      const others = await runQuery(env, { collection: 'leases', where: [{ field: 'unitId', op: 'EQUAL', value: unitId }], limit: 50 })
      for (const o of others.filter((x) => x.id !== leaseId && x.data.status === 'requested').slice(0, 20)) {
        writes.push({ kind: 'upsert', path: `leases/${o.id}`, data: { status: 'rejected', updatedAt: now } })
        writes.push(notifyWrite(String(o.data.tenantId), `lease_${o.id}_rej`, 'الوحدة اتأجرت', `الوحدة "${title}" اتأجرت لشخص تاني.`, unitId))
      }
      await commit(env, writes)
      return json({ status: 'active' })
    }

    if (action === 'confirm-contract') {
      if (!isOwner && !isTenant) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.status !== 'active') throw new HttpError(409, 'state', 'العقد مش شغال')
      if (L.contractConfirmedAt) throw new HttpError(409, 'state', 'اتأكد توقيع العقد قبل كده')
      const field = isOwner ? 'contractOwnerAt' : 'contractTenantAt'
      const both = isOwner ? !!L.contractTenantAt : !!L.contractOwnerAt
      const other = isOwner ? String(L.tenantId) : String(L.ownerId)
      const w: Write[] = [{ kind: 'upsert', path: `leases/${leaseId}`, data: { [field]: now, updatedAt: now, ...(both ? { contractConfirmedAt: now } : {}) } }]
      w.push(both
        ? notifyWrite(other, `lease_${leaseId}_cc2`, 'اتأكد توقيع العقد', `الطرفين أكدوا توقيع العقد ومعاينة "${title}". دلوقتي المستأجر يقدر يدفع من صفحة إيجاراتي.`, unitId)
        : notifyWrite(other, `lease_${leaseId}_cc1_${isOwner ? 'o' : 't'}`, 'الطرف التاني أكد توقيع العقد', `${isOwner ? 'المالك' : 'المستأجر'} أكد إن العقد اتوقّع والوحدة اتعاينت (${title}). لو ده صح أكّد من عندك كمان عشان الدفع يتفتح.`, unitId))
      if (both) w.push(notifyWrite(String(L.tenantId), `lease_${leaseId}_cc2t`, 'الدفع اتفتح', `تقدر تدفع القسط الأول لـ "${title}" من صفحة إيجاراتي.`, unitId))
      await commit(env, w)
      return json({ contractConfirmed: both })
    }

    if (action === 'request-cancel') {
      if (!isTenant) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (S.cancelAfterPayment !== 'request') throw new HttpError(409, 'blocked', 'الإلغاء بعد الدفع مش متاح. كلّم الإدارة.')
      if (L.status !== 'active' || !L.firstPaidAt || L.moveInConfirmedAt) throw new HttpError(409, 'state', 'مينفعش تطلب إلغاء في الحالة دي')
      if (L.cancelRequestedAt) throw new HttpError(409, 'state', 'طلب الإلغاء اتبعت قبل كده')
      await commit(env, [{ kind: 'upsert', path: `leases/${leaseId}`, data: { cancelRequestedAt: now, updatedAt: now } }, notifyWrite(String(L.ownerId), `lease_${leaseId}_cr`, 'المستأجر طلب إلغاء العقد', `المستأجر طلب إلغاء العقد على "${title}". الإدارة هتراجع الطلب.`, unitId)])
      return json({ cancelRequested: true })
    }

    if (action === 'set-reminder') {
      if (!isOwner) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.status !== 'active') throw new HttpError(409, 'state', 'العقد مش شغال')
      await commit(env, [{ kind: 'upsert', path: `leases/${leaseId}`, data: { reminderDays: days, updatedAt: now } }])
      return json({ reminderDays: days })
    }

    if (action === 'confirm-move-in' || action === 'not-received') {
      if (!isTenant) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.status !== 'active') throw new HttpError(409, 'state', 'العقد مش شغال')
      if (L.moveInConfirmedAt) throw new HttpError(409, 'state', 'اتأكد الاستلام قبل كده')
      if (!L.firstPaidAt) throw new HttpError(409, 'unpaid', 'ادفع القسط الأول الأول')
      if (String(L.startDate) > today) throw new HttpError(409, 'not-started', 'العقد لسه ما بدأش')
      if (action === 'not-received') {
        await commit(env, [{ kind: 'upsert', path: `leases/${leaseId}`, data: { moveInIssue: true, moveInIssueAt: now, updatedAt: now } }, notifyWrite(String(L.ownerId), `lease_${leaseId}_nr`, 'المستأجر لسه ما استلمش الوحدة', `المستأجر بلّغ إنه لسه ما استلمش "${title}". الفلوس فضلت محجوزة لحد ما يتحل الموضوع.`, unitId)])
        return json({ moveInIssue: true })
      }
      const pays = await runQuery(env, { collection: 'payments', where: [{ field: 'leaseId', op: 'EQUAL', value: leaseId }], limit: 100 })
      const writes: Write[] = [{ kind: 'upsert', path: `leases/${leaseId}`, data: { moveInConfirmedAt: now, moveInIssue: false, updatedAt: now } }]
      for (const p of pays.filter((x) => x.data.status === 'paid' && x.data.payoutStatus === 'held')) {
        writes.push({ kind: 'upsert', path: `payments/${p.id}`, data: { payoutStatus: Number(p.data.netCents) > 0 ? 'pending' : 'none', releasedAt: now } })
      }
      writes.push(notifyWrite(String(L.ownerId), `lease_${leaseId}_mi`, 'المستأجر أكد الاستلام', `المستأجر أكد استلام "${title}". الفلوس المحجوزة اتحرّرت وهتتحول لك قريبًا.`, unitId))
      await commit(env, writes)
      return json({ moveInConfirmed: true })
    }

    const pays = await runQuery(env, { collection: 'payments', where: [{ field: 'leaseId', op: 'EQUAL', value: leaseId }], limit: 100 })
    const unit = await getDocument(env, `units/${unitId}`)

    if (action === 'cancel') {
      if (!isTenant) throw new HttpError(403, 'forbidden', 'مش مسموح')
      if (L.status === 'requested') {
        await commit(env, [set('cancelled'), notifyWrite(String(L.ownerId), `lease_${leaseId}_can`, 'المستأجر لغى الطلب', `تم إلغاء طلب الإيجار على "${title}".`, unitId)])
        return json({ status: 'cancelled' })
      }
      if (L.status !== 'active') throw new HttpError(409, 'state', 'مينفعش تلغي العقد ده')
      if (pays.some((p) => p.data.status === 'paid' || p.data.status === 'pending')) throw new HttpError(409, 'paid', 'في دفعات اتدفعت أو قيد المعالجة. كلّم المالك أو الإدارة لإنهاء العقد.')
      await commit(env, closeLeaseWrites(leaseId, L, 'cancelled', pays, unit, today, S, { uid: String(L.ownerId), title: 'المستأجر لغى العقد', body: `تم إلغاء العقد على "${title}" قبل أي دفع.` }))
      return json({ status: 'cancelled' })
    }

    // end
    if (!isOwner && !user.isAdmin) throw new HttpError(403, 'forbidden', 'مش مسموح')
    if (L.status !== 'active') throw new HttpError(409, 'state', 'العقد مش شغال')
    await commit(env, closeLeaseWrites(leaseId, L, 'ended', pays, unit, today, S, { uid: String(L.tenantId), title: 'تم إنهاء العقد', body: `تم إنهاء العقد على "${title}" وإلغاء الأقساط غير المدفوعة.` }))
    return json({ status: 'ended' })
  } catch (e) { return errorResponse(e) }
}
