import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { deleteDoc, doc, getDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { db } from '../lib/firebase'
import { fmtDate, fmtNum, fmtPrice, isExpired } from '../lib/format'
import { usePageMeta } from '../lib/seo'
import { ownerUnits } from '../lib/units'
import type { Unit, UnitStatus } from '../lib/types'
import { Badge, Empty, ErrorBox, Spinner } from '../components/ui'
import { OwnerLeases } from '../components/OwnerLeases'
import { OwnerOverview } from '../components/OwnerOverview'
import { rt } from '../i18n/rent'
import { fmtYmd, loadRentals, type RentalsData } from '../lib/rentals'

interface Stats { views: number; reveals: number }

export default function Dashboard() {
  usePageMeta({ title: ar.dash.title, noindex: true })
  const { user, banned } = useAuth()
  const toast = useToast()
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [err, setErr] = useState<unknown>(null)
  const [rentals, setRentals] = useState<RentalsData>({ leases: [], payments: {} })
  const [hasPayout, setHasPayout] = useState(true)

  const load = useCallback(async () => {
    if (!user) return
    setErr(null)
    try {
      const list = await ownerUnits(user.uid)
      setUnits(list)
      const entries = await Promise.all(list.map(async (u) => {
        const s = await getDoc(doc(db, 'unitStats', u.id)).catch(() => null)
        return [u.id, { views: Number(s?.data()?.views ?? 0), reveals: Number(s?.data()?.reveals ?? 0) }] as const
      }))
      setStats(Object.fromEntries(entries))
      setRentals(await loadRentals(user.uid, 'ownerId').catch(() => ({ leases: [], payments: {} })))
      setHasPayout((await getDoc(doc(db, 'users', user.uid, 'payout', 'main')).catch(() => null))?.exists() ?? true)
    } catch (e) { setErr(e) }
  }, [user])
  useEffect(() => { void load() }, [load])

  async function setStatus(u: Unit, status: UnitStatus) {
    try {
      await updateDoc(doc(db, 'units', u.id), { status })
      setUnits((p) => p?.map((x) => (x.id === u.id ? { ...x, status } : x)) ?? null)
    } catch { toast.err(ar.errors.generic) }
  }
  async function remove(u: Unit) {
    if (!window.confirm(ar.dash.confirmDelete)) return
    try {
      const b = writeBatch(db)
      b.delete(doc(db, 'contacts', u.id))
      b.delete(doc(db, 'units', u.id))
      await b.commit()
      setUnits((p) => p?.filter((x) => x.id !== u.id) ?? null)
    } catch {
      await deleteDoc(doc(db, 'units', u.id)).catch(() => toast.err(ar.errors.generic))
    }
  }

  const statusLabel = (u: Unit) => u.status === 'active' ? ar.dash.active : u.status === 'hidden' ? ar.dash.hidden : u.status === 'rented' ? ar.dash.rented : ar.dash.removed

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl">{ar.dash.title}</h1>
        <Link to="/dashboard/new" className="btn-primary" aria-disabled={banned}>{ar.dash.add}</Link>
      </div>
      {units && <div className="mt-6"><OwnerOverview units={units} data={rentals} /></div>}
      <OwnerLeases data={rentals} hasPayout={hasPayout} reload={load} />
      <p className="mt-2 text-xs text-mute">{ar.dash.statsNote}</p>
      <div className="mt-6">
        {err ? <ErrorBox error={err} onRetry={() => void load()} /> : units === null ? <Spinner /> : units.length === 0 ? (
          <Empty title={ar.dash.empty} action={<Link to="/dashboard/new" className="btn-primary">{ar.dash.add}</Link>} />
        ) : (
          <ul className="space-y-3">
            {units.map((u) => {
              const s = stats[u.id]
              const expired = isExpired(u.expiresAt)
              const locked = !!u.lockedUntil && u.lockedUntil.getTime() > Date.now()
              const lease = rentals.leases.find((l) => l.unitId === u.id && l.status === 'active')
              return (
                <li key={u.id} className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <Link to={`/unit/${u.id}`} className="font-semibold hover:text-nile">{u.title}</Link>
                    <p className="text-sm text-mute">{fmtPrice(u.price, u.rentType)} · {u.governorateName} — {u.areaName}</p>
                    <p className="mt-1 flex flex-wrap gap-2 text-xs">
                      <Badge tone={u.status === 'active' && !expired ? 'nile' : 'plain'}>{expired ? ar.dash.expired : statusLabel(u)}</Badge>
                      {u.hiddenByAdmin && <Badge tone="sand">{ar.dash.hiddenByAdmin}</Badge>}
                      {u.rentedUntil && u.status === 'rented' && <Badge tone="sand">{rt.rentedUntil} {fmtYmd(u.rentedUntil)}</Badge>}
                      <span className="text-mute">{u.expiresAt ? `${ar.dash.validUntil} ${fmtDate(u.expiresAt)}` : ar.dash.noExpiry}</span>
                    </p>
                    {locked && <p className="mt-1 text-xs text-mute">{rt.lockedNote} {rt.backOn}{lease ? ` · ${rt.tenantLabel}: ${lease.tenantName}` : ''}</p>}
                  </div>
                  <dl className="flex gap-5 text-sm">
                    <div><dt className="text-mute">{ar.dash.views}</dt><dd className="font-medium">{s ? fmtNum(s.views) : '—'}</dd></div>
                    <div><dt className="text-mute">{ar.dash.reveals}</dt><dd className="font-medium">{s ? fmtNum(s.reveals) : '—'}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Link className="btn-ghost !py-1.5" to={`/dashboard/units/${u.id}/edit`}>{ar.common.edit}</Link>
                    {!locked && u.status === 'active' && <button type="button" className="btn-ghost !py-1.5" onClick={() => void setStatus(u, 'hidden')}>{ar.dash.hide}</button>}
                    {!locked && u.status === 'hidden' && !u.hiddenByAdmin && <button type="button" className="btn-ghost !py-1.5" onClick={() => void setStatus(u, 'active')}>{ar.dash.show}</button>}
                    {!locked && u.status !== 'rented' && u.status !== 'removed' && <button type="button" className="btn-ghost !py-1.5" onClick={() => void setStatus(u, 'rented')}>{ar.dash.markRented}</button>}
                    {!locked && u.status === 'rented' && !u.hiddenByAdmin && <button type="button" className="btn-ghost !py-1.5" onClick={() => void setStatus(u, 'active')}>{ar.dash.markActive}</button>}
                    {!locked && <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => void remove(u)}>{ar.common.delete}</button>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
