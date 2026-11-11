import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { fmtDate, fmtNum } from '../lib/format'
import { fmtYmd } from '../lib/rentals'
import type { Payment } from '../lib/types'
import { Badge } from './ui'

export function PaymentList({ payments, payable, busyId, onPay, owner = false }: { payments: Payment[]; payable?: string | null; busyId?: string | null; onPay?: (p: Payment) => void; owner?: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-field border border-line text-sm">
      {payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{fmtNum(p.amount)} {ar.common.currency} <span className="text-mute">· {rt.due} {fmtYmd(p.dueDate)}</span></p>
            <p className="text-xs text-mute">{rt.period} {fmtYmd(p.from)} → {fmtYmd(p.to)}{p.paidAt ? ` · ${rt.paidAt} ${fmtDate(p.paidAt)}` : ''}{p.depositCents > 0 ? ` · ${rt.depositIncluded}: ${fmtNum(p.depositCents / 100)}` : ''}</p>
            {p.status === 'paid' && (
              <p className="text-xs text-mute">
                {owner
                  ? `${p.payoutStatus === 'held' ? rt.held : p.payoutStatus === 'pending' ? rt.payoutPending : p.payoutStatus === 'paid' ? rt.payoutPaid : rt.payoutNone} · ${rt.toReceive} ${fmtNum(p.netCents / 100)} ${ar.common.currency}`
                  : p.payoutStatus === 'held' ? rt.escrowNote : ''}
              </p>
            )}
          </div>
          <Badge tone={p.status === 'paid' ? 'nile' : p.status === 'failed' ? 'sand' : 'plain'}>{rt.pay[p.status]}</Badge>
          {!owner && onPay && payable === p.id && <button type="button" className="btn-primary !py-1.5" disabled={busyId === p.id} onClick={() => onPay(p)}>{busyId === p.id ? rt.paying : rt.payNow}</button>}
        </li>
      ))}
    </ul>
  )
}
