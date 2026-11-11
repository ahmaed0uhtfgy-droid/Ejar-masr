import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addDaysYmd } from '../../functions/_lib/rent'
import { useToast } from '../contexts/ToastContext'
import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { ApiError, apiPost } from '../lib/api'
import { fmtNum } from '../lib/format'
import { fmtYmd, todayYmd, usePaySettings, type RentalsData } from '../lib/rentals'
import type { Lease } from '../lib/types'
import { Badge, Field } from './ui'
import { PaymentList } from './PaymentList'

const REMIND = [1, 2, 3, 5, 7, 10, 14]

function ClaimForm({ lease, onDone }: { lease: Lease; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(String(lease.depositCents / 100))
  const [reason, setReason] = useState('')
  const [open, setOpen] = useState(false)
  async function send() {
    try { await apiPost('/api/deposit-action', { leaseId: lease.id, action: 'claim', amount: Number(amount), reason }); toast.ok(rt.claimed); setOpen(false); onDone() }
    catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }
  if (!open) return <button type="button" className="btn-ghost !py-1.5" onClick={() => setOpen(true)}>{rt.claim}</button>
  return (
    <div className="space-y-2 rounded-field border border-line p-3">
      <Field label={rt.claimAmount}><input className="field" type="number" min={1} max={lease.depositCents / 100} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label={rt.claimReason}><textarea className="field" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="flex gap-2"><button type="button" className="btn-primary !py-1.5" onClick={() => void send()}>{rt.claimSend}</button><button type="button" className="btn-ghost !py-1.5" onClick={() => setOpen(false)}>{ar.common.cancel}</button></div>
    </div>
  )
}

/** Owner view: incoming rent requests, running leases, escrow state of every payment, deposit and reminder settings. */
export function OwnerLeases({ data, hasPayout, reload }: { data: RentalsData; hasPayout: boolean; reload: () => Promise<void> }) {
  const toast = useToast()
  const ps = usePaySettings()
  const [remind, setRemind] = useState<Record<string, number>>({})
  const today = todayYmd()

  async function withdraw(l: Lease) {
    try { await apiPost('/api/deposit-action', { leaseId: l.id, action: 'withdraw' }); await reload() } catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }

  async function act(l: Lease, action: 'accept' | 'reject' | 'end' | 'set-reminder' | 'confirm-contract', ok: string) {
    if (action === 'end' && !window.confirm(rt.confirmEnd)) return
    try { await apiPost('/api/lease-respond', { leaseId: l.id, action, reminderDays: remind[l.id] ?? l.reminderDays ?? ps.defaultReminderDays }); toast.ok(ok); await reload() }
    catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }

  const leases = data.leases.filter((l) => l.status === 'requested' || l.status === 'active' || (data.payments[l.id]?.length ?? 0) > 0)
  if (!leases.length) return null

  return (
    <section className="mb-10" aria-labelledby="owner-leases">
      <h2 id="owner-leases" className="font-display text-2xl">{rt.ownerTitle}</h2>
      {!hasPayout && <p className="mt-3 rounded-field border border-sand p-3 text-sm" role="alert">{rt.needPayout} <Link className="underline" to="/account">{ar.nav.account}</Link></p>}
      <ul className="mt-4 space-y-4">
        {leases.map((l) => {
          const claimDeadline = l.depositClaimUntil || addDaysYmd(l.endDate, ps.depositClaimDays)
          const canClaim = l.depositMode === 'held-claim' && l.depositStatus === 'held' && (l.status === 'ended' || l.endDate <= today) && today <= claimDeadline
          const sel = remind[l.id] ?? l.reminderDays ?? ps.defaultReminderDays
          return (
            <li key={l.id} className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/unit/${l.unitId}`} className="font-semibold hover:text-nile">{l.unitTitle}</Link>
                <Badge tone={l.status === 'active' ? 'nile' : 'plain'}>{rt.status[l.status]}</Badge>
              </div>
              <p className="text-sm text-mute">
                {rt.tenant}: {l.tenantName || '—'} · {rt.tenantPhone}: <bdi dir="ltr">{l.tenantPhone}</bdi> · {fmtYmd(l.startDate)} → {fmtYmd(l.endDate)} · {rt.total} {fmtNum(l.total)} {ar.common.currency}
              </p>
              {l.note && <p className="text-sm">“{l.note}”</p>}
              {l.status === 'active' && !l.contractConfirmedAt && (
                <div className="rounded-field border border-sand p-3 text-sm" role="alert">
                  <p className="font-medium">{rt.contractTitle}</p>
                  <p className="mt-1 text-mute">{rt.contractHint}</p>
                  <p className="mt-1 text-xs text-mute">{l.contractTenantAt ? rt.contractOtherDone : rt.contractWaitOther}</p>
                  {l.contractOwnerAt
                    ? <p className="mt-2 text-nile">{rt.contractMine}</p>
                    : <button type="button" className="btn-primary mt-3 !py-1.5" onClick={() => { if (window.confirm(rt.contractConfirm)) void act(l, 'confirm-contract', rt.contractDone) }}>{rt.contractBtn}</button>}
                </div>
              )}
              {l.status === 'active' && l.firstPaidAt && (
                <p className="text-sm">{l.moveInConfirmedAt ? <span className="text-nile">{rt.moveInOk}</span> : <span className="text-mute">{rt.held}</span>}{l.moveInIssue && <span className="text-danger"> · {rt.moveInIssueFlag}</span>}</p>
              )}
              {(data.payments[l.id]?.length ?? 0) > 0 && <PaymentList owner payments={data.payments[l.id]} />}
              {l.depositCents > 0 && l.depositStatus !== 'none' && (
                <p className="text-sm text-mute">
                  {rt.deposit}: {fmtNum(l.depositCents / 100)} {ar.common.currency} · {rt.depStatus[l.depositStatus]}
                  {l.depositStatus === 'claimed' && ` (${fmtNum(l.claimCents / 100)} ${ar.common.currency})`}
                  {l.depositStatus === 'settled' && ` · ${rt.depToOwner(l.depositToOwnerCents / 100)} (${l.depositTransfer === 'done' ? rt.depTransferDone : rt.depTransferPending})`}
                  {canClaim && ` · ${rt.claimUntil(fmtYmd(claimDeadline))}`}
                </p>
              )}
              {canClaim && <ClaimForm lease={l} onDone={() => void reload()} />}
              {(l.depositStatus === 'claimed' || l.depositStatus === 'disputed') && (
                <div className="space-y-2 text-sm">
                  {l.depositStatus === 'disputed' && <p className="text-mute">{rt.depDisputeNote}</p>}
                  <button type="button" className="btn-ghost !py-1.5" onClick={() => void withdraw(l)}>{rt.claimWithdraw}</button>
                </div>
              )}
              {(l.status === 'requested' || l.status === 'active') && (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm"><span className="label">{rt.remindDays}</span>
                    <span className="flex items-center gap-2">
                      <select className="field !w-24" value={sel} onChange={(e) => setRemind((r) => ({ ...r, [l.id]: Number(e.target.value) }))}>
                        {[...new Set([...REMIND, sel])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{fmtNum(d)} {rt.remindUnit}</option>)}
                      </select>
                      {l.status === 'active' && <button type="button" className="btn-ghost !py-1.5" onClick={() => void act(l, 'set-reminder', rt.remindSaved)}>{ar.common.save}</button>}
                    </span>
                  </label>
                </div>
              )}
              <div className="flex gap-2">
                {l.status === 'requested' && <>
                  <button type="button" className="btn-primary !py-1.5" onClick={() => void act(l, 'accept', rt.accepted)}>{rt.accept}</button>
                  <button type="button" className="btn-ghost !py-1.5" onClick={() => void act(l, 'reject', rt.rejected)}>{rt.reject}</button>
                </>}
                {l.status === 'active' && <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => void act(l, 'end', rt.ended)}>{rt.endLease}</button>}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
