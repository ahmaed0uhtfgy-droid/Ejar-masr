import { daysBetween } from '../../functions/_lib/rent'
import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { fmtNum } from '../lib/format'
import { fmtYmd, todayYmd, type RentalsData } from '../lib/rentals'
import type { Unit } from '../lib/types'

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-sm text-mute">{label}</p>
      <p className="mt-1 font-display text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-mute">{sub}</p>}
    </div>
  )
}

/** Everything an owner needs at a glance: units by state, requests, money (received / held in escrow / awaiting transfer), deposits, next installment. */
export function OwnerOverview({ units, data }: { units: Unit[]; data: RentalsData }) {
  const today = todayYmd()
  const now = Date.now()
  const pays = Object.values(data.payments).flat()
  const sum = (f: (p: (typeof pays)[number]) => boolean) => pays.filter(f).reduce((s, p) => s + p.netCents / 100, 0)
  const received = sum((p) => p.status === 'paid' && p.payoutStatus === 'paid')
  const pending = sum((p) => p.status === 'paid' && p.payoutStatus === 'pending')
  const held = sum((p) => p.status === 'paid' && p.payoutStatus === 'held')
  const depHeld = data.leases.filter((l) => l.depositStatus === 'held' || l.depositStatus === 'claimed').reduce((s, l) => s + l.depositCents / 100, 0)
  const active = data.leases.filter((l) => l.status === 'active')
  const requests = data.leases.filter((l) => l.status === 'requested').length
  const open = pays.filter((p) => ['due', 'failed'].includes(p.status) && active.some((l) => l.id === p.leaseId)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
  const nextLease = open ? active.find((l) => l.id === open.leaseId) : undefined

  const unitsActive = units.filter((u) => u.status === 'active' && !(u.expiresAt && u.expiresAt.getTime() <= now)).length
  const unitsRented = units.filter((u) => u.status === 'rented').length
  const unitsHidden = units.filter((u) => u.status === 'hidden').length

  const byMonth = new Map<string, number>()
  for (const p of pays) if (p.status === 'paid' && p.paidAt) { const k = p.paidAt.toISOString().slice(0, 7); byMonth.set(k, (byMonth.get(k) ?? 0) + p.netCents / 100) }
  const months = [...byMonth.entries()].sort().slice(-6)
  const max = Math.max(1, ...months.map(([, v]) => v))

  return (
    <section className="mb-10" aria-labelledby="owner-overview">
      <h2 id="owner-overview" className="font-display text-2xl">{rt.ovTitle}</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label={rt.ovUnits} value={fmtNum(units.length)} sub={`${rt.ovActive} ${fmtNum(unitsActive)} · ${rt.ovRented} ${fmtNum(unitsRented)} · ${rt.ovHidden} ${fmtNum(unitsHidden)}`} />
        <Card label={rt.ovRequests} value={fmtNum(requests)} sub={`${rt.ovLeases}: ${fmtNum(active.length)}`} />
        <Card label={rt.ovHeld} value={`${fmtNum(held)} ${ar.common.currency}`} sub={rt.held} />
        <Card label={rt.ovPending} value={`${fmtNum(pending)} ${ar.common.currency}`} sub={`${rt.ovReceived}: ${fmtNum(received)} ${ar.common.currency}`} />
        <Card label={rt.ovDepHeld} value={`${fmtNum(depHeld)} ${ar.common.currency}`} />
        <Card label={rt.ovNextDue} value={open ? fmtYmd(open.dueDate) : '—'} sub={open && nextLease ? `${nextLease.unitTitle} · ${rt.nextIn(daysBetween(today, open.dueDate))}` : undefined} />
      </div>
      {months.length > 0 && (
        <div className="panel mt-4 p-4">
          <p className="text-sm text-mute">{rt.ovMonthly}</p>
          <div className="mt-3 flex h-28 items-end gap-3" role="img" aria-label={rt.ovMonthly}>
            {months.map(([k, v]) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-1 text-xs">
                <span>{fmtNum(Math.round(v))}</span>
                <div className="w-full rounded-t bg-nile" style={{ height: `${Math.max(4, (v / max) * 72)}px` }} />
                <span className="text-mute">{k}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
