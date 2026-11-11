import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { daysBetween } from '../../functions/_lib/rent'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { ApiError, apiPost } from '../lib/api'
import { fmtNum } from '../lib/format'
import { fmtYmd, loadRentals, todayYmd, usePaySettings } from '../lib/rentals'
import { usePageMeta } from '../lib/seo'
import type { Lease, Payment } from '../lib/types'
import { Badge, Empty, ErrorBox, Spinner } from '../components/ui'
import { PaymentList } from '../components/PaymentList'

const OPEN = ['due', 'failed', 'pending']

export default function Rentals() {
  usePageMeta({ title: rt.title, noindex: true })
  const { user } = useAuth()
  const toast = useToast()
  const [data, setData] = useState<{ leases: Lease[]; payments: Record<string, Payment[]> } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const ps = usePaySettings()

  const load = useCallback(async () => {
    if (!user) return
    setErr(null)
    try { setData(await loadRentals(user.uid, 'tenantId')) } catch (e) { setErr(e) }
  }, [user])
  useEffect(() => { void load() }, [load])

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try { await fn(); if (okMsg) toast.ok(okMsg); await load() } catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }
  async function pay(p: Payment) {
    setBusyId(p.id)
    try {
      const { url } = await apiPost<{ url: string }>('/api/pay-create', { paymentId: p.id })
      window.location.href = url
    } catch (e) {
      toast.err(e instanceof ApiError ? e.message : ar.errors.generic)
      setBusyId(null)
    }
  }
  const dep = (l: Lease, action: string) => run(() => apiPost('/api/deposit-action', { leaseId: l.id, action }))
  const act = (l: Lease, action: string, ok?: string) => run(() => apiPost('/api/lease-respond', { leaseId: l.id, action }), ok)

  const today = todayYmd()
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-display text-3xl">{rt.title}</h1>
      <div className="mt-6">
        {err ? <ErrorBox error={err} onRetry={() => void load()} /> : data === null ? <Spinner /> : data.leases.length === 0 ? (
          <Empty title={rt.empty} action={<Link to="/search" className="btn-primary">{rt.browse}</Link>} />
        ) : (
          <ul className="space-y-4">
            {data.leases.map((l) => {
              const pays = data.payments[l.id] ?? []
              const nextPay = l.status === 'active' ? pays.find((p) => OPEN.includes(p.status)) : undefined
              const needsContract = l.status === 'active' && !l.contractConfirmedAt
              const payable = nextPay && !needsContract ? nextPay.id : null
              const nothingPaid = !pays.some((p) => p.status === 'paid' || p.status === 'pending')
              const needsMoveIn = l.status === 'active' && !!l.firstPaidAt && !l.moveInConfirmedAt && l.startDate <= today
              return (
                <li key={l.id} className="panel space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/unit/${l.unitId}`} className="font-semibold hover:text-nile">{l.unitTitle}</Link>
                    <Badge tone={l.status === 'active' ? 'nile' : 'plain'}>{rt.status[l.status]}</Badge>
                  </div>
                  <p className="text-sm text-mute">
                    {rt.owner}: {l.ownerName || '—'} · {fmtYmd(l.startDate)} → {fmtYmd(l.endDate)} · {rt.total} {fmtNum(l.total)} {ar.common.currency}
                  </p>

                  {l.status === 'active' && (
                    <div className="flex flex-wrap gap-2 text-sm">
                      {l.startDate > today
                        ? <Badge>{rt.startsIn(daysBetween(today, l.startDate))}</Badge>
                        : <Badge>{rt.endsIn(daysBetween(today, l.endDate))}</Badge>}
                      {nextPay && <Badge tone={daysBetween(today, nextPay.dueDate) <= (l.reminderDays ?? 3) ? 'sand' : 'plain'}>{rt.nextIn(daysBetween(today, nextPay.dueDate))}</Badge>}
                      {l.moveInConfirmedAt && <Badge tone="nile">{rt.moveInOk}</Badge>}
                    </div>
                  )}

                  {needsContract && (
                    <div className="rounded-field border border-sand p-3" role="alert">
                      <p className="font-medium">{rt.contractTitle}</p>
                      <p className="mt-1 text-sm text-mute">{rt.contractHint}</p>
                      <p className="mt-1 text-xs text-mute">{l.contractOwnerAt ? rt.contractOtherDone : rt.contractWaitOther}</p>
                      {l.contractTenantAt
                        ? <p className="mt-2 text-sm text-nile">{rt.contractMine}</p>
                        : <button type="button" className="btn-primary mt-3 !py-1.5" onClick={() => { if (window.confirm(rt.contractConfirm)) void act(l, 'confirm-contract', rt.contractDone) }}>{rt.contractBtn}</button>}
                    </div>
                  )}
                  {needsMoveIn && (
                    <div className="rounded-field border border-sand p-3" role="alert">
                      <p className="font-medium">{rt.moveInQ}</p>
                      <p className="mt-1 text-sm text-mute">{rt.moveInHint}</p>
                      {l.moveInIssue && <p className="mt-1 text-sm text-danger">{rt.moveInIssueFlag}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" className="btn-primary !py-1.5" onClick={() => { if (window.confirm(rt.moveInConfirm)) void act(l, 'confirm-move-in', rt.moveInDone) }}>{rt.moveInYes}</button>
                        {!l.moveInIssue && <button type="button" className="btn-ghost !py-1.5" onClick={() => void act(l, 'not-received', rt.moveInIssueDone)}>{rt.moveInNo}</button>}
                      </div>
                    </div>
                  )}
                  {l.status === 'active' && !l.moveInConfirmedAt && l.firstPaidAt && l.startDate > today && <p className="text-xs text-mute">{rt.escrowNote}</p>}

                  {pays.length > 0 && <PaymentList payments={pays} payable={payable} busyId={busyId} onPay={(p) => void pay(p)} />}
                  {needsContract && <p className="text-sm text-mute">{rt.payLocked}</p>}

                  {(l.depositStatus === 'claimed' || l.depositStatus === 'disputed') && (
                    <div className="rounded-field border border-sand p-3 text-sm" role="alert">
                      <p className="font-medium">{rt.claimOnYou(l.claimCents / 100)}</p>
                      <p className="text-mute">{rt.claimReasonLabel}: {l.claimReason}</p>
                      {l.depositStatus === 'disputed' && <p className="mt-1 text-xs text-mute">{rt.depDisputeNote}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className="btn-primary !py-1.5" onClick={() => { if (window.confirm(rt.claimAcceptConfirm)) void dep(l, 'accept') }}>{rt.claimAccept}</button>
                        {l.depositStatus === 'claimed' && <button type="button" className="btn-ghost !py-1.5" onClick={() => void dep(l, 'reject')}>{rt.claimReject}</button>}
                      </div>
                    </div>
                  )}
                  {l.depositCents > 0 && l.depositStatus !== 'none' && (
                    <p className="text-sm text-mute">
                      {rt.deposit}: {fmtNum(l.depositCents / 100)} {ar.common.currency} · {rt.depStatus[l.depositStatus]}
                      {l.depositStatus === 'settled' && ` · ${rt.depBackToYou(l.depositToTenantCents / 100)} (${l.depositTransfer === 'done' ? rt.depTransferDone : rt.depTransferPending})`}
                    </p>
                  )}
                  {l.status === 'active' && !!l.firstPaidAt && !l.moveInConfirmedAt && ps.cancelAfterPayment === 'request' && (
                    l.cancelRequestedAt
                      ? <p className="text-sm text-mute">{rt.cancelRequested}</p>
                      : <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => { if (window.confirm(rt.cancelConfirm)) void act(l, 'request-cancel', rt.cancelReqSent) }}>{rt.requestCancel}</button>
                  )}
                  {(l.status === 'requested' || (l.status === 'active' && nothingPaid)) && (
                    <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => { if (window.confirm(rt.confirmCancel)) void act(l, 'cancel') }}>{l.status === 'requested' ? rt.cancelReq : rt.cancelLease}</button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
