import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { clearCompare, removeFromCompare, useCompareIds } from '../lib/compare'
import { fmtNum, fmtPrice } from '../lib/format'
import { images } from '../lib/images'
import { usePageMeta } from '../lib/seo'
import { getUnit } from '../lib/units'
import type { Unit } from '../lib/types'
import { Empty, ErrorBox, Spinner } from '../components/ui'

type Loaded = { id: string; unit: Unit | null; error: unknown }

export default function Compare() {
  usePageMeta({ title: ar.compare.title, noindex: true })
  const ids = useCompareIds()
  const toast = useToast()
  const { settings } = useSettings()
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [notes, setNotes] = useState<{ gone: boolean; partial: boolean }>({ gone: false, partial: false })

  useEffect(() => {
    let alive = true
    setUnits(null); setErr(null)
    Promise.all(ids.map((id): Promise<Loaded> => getUnit(id).then((unit) => ({ id, unit, error: null }), (error: unknown) => ({ id, unit: null, error }))))
      .then((res) => {
        if (!alive) return
        // A listing that was deleted can never be shown again: drop it, otherwise it would sit in the list with no way to remove it.
        // (A listing that merely failed to load, for example because of the daily quota, is kept.)
        const gone = res.filter((r) => r.unit === null && r.error === null).map((r) => r.id)
        gone.forEach(removeFromCompare)
        const failed = res.filter((r) => r.error !== null)
        if (res.length > 0 && failed.length === res.length) { setErr(failed[0].error); return }
        setNotes({ gone: gone.length > 0, partial: failed.length > 0 })
        setUnits(res.flatMap((r) => (r.unit ? [r.unit] : [])))
      })
    return () => { alive = false }
  }, [ids])

  function clearAll() { clearCompare(); setNotes({ gone: false, partial: false }); toast.ok(ar.compare.cleared) }

  if (ids.length === 0) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty title={ar.compare.empty} action={<Link to="/search" className="btn-primary">{ar.nav.search}</Link>} /></div>
  if (err) return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-10">
      <ErrorBox error={err} />
      <button type="button" className="btn-ghost" onClick={clearAll}>{ar.compare.clear}</button>
    </div>
  )
  if (!units) return <Spinner />

  const label = (a: string) => settings.amenities.find((x) => x.id === a)?.label ?? a
  const rows: [string, (u: Unit) => string][] = [
    [ar.compare.row.price, (u) => fmtPrice(u.price, u.rentType)],
    [ar.compare.row.type, (u) => u.typeName],
    [ar.compare.row.location, (u) => `${u.governorateName} — ${u.areaName}`],
    [ar.compare.row.rooms, (u) => fmtNum(u.rooms)],
    [ar.compare.row.baths, (u) => fmtNum(u.bathrooms)],
    [ar.compare.row.size, (u) => `${fmtNum(u.area)} ${ar.unit.size}`],
    [ar.compare.row.floor, (u) => fmtNum(u.floor)],
    [ar.compare.row.furnished, (u) => (u.furnished ? ar.common.yes : ar.common.no)],
    [ar.compare.row.deposit, (u) => (u.deposit != null ? `${fmtNum(u.deposit)} ${ar.common.currency}` : '—')],
    [ar.compare.row.by, (u) => (u.ownerType === 'broker' ? ar.unit.broker : ar.unit.owner)],
    [ar.compare.row.amenities, (u) => u.amenities.map(label).join('، ') || '—'],
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl">{ar.compare.title}</h1>
        <span className="chip">{ar.compare.count(ids.length)}</span>
        <button type="button" className="btn-ghost ms-auto !py-1.5 text-sm" onClick={clearAll}>🗑 {ar.compare.clear}</button>
      </div>
      {notes.gone && <p role="status" className="mt-3 text-sm text-mute">{ar.compare.goneNote}</p>}
      {notes.partial && <p role="status" className="mt-3 text-sm text-danger">{ar.compare.partialNote}</p>}
      {units.length === 0 ? (
        <div className="mt-6"><Empty title={ar.compare.empty} action={<Link to="/search" className="btn-primary">{ar.nav.search}</Link>} /></div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-start">
            <thead>
              <tr>
                <th className="w-32 p-3" />
                {units.map((u) => (
                  <th key={u.id} className="p-3 text-start align-top">
                    <Link to={`/unit/${u.id}`}>
                      {u.images[0] && <img src={images.url(u.images[0], { w: 320, h: 240 })} alt="" loading="lazy" width={320} height={240} className="aspect-[4/3] w-full rounded-field object-cover" />}
                      <span className="mt-2 block font-semibold">{u.title}</span>
                    </Link>
                    {u.status !== 'active' && <span className="chip mt-1">{ar.compare.unavailable}</span>}
                    <button type="button" className="btn-ghost mt-2 !px-3 !py-1.5 text-sm text-danger" onClick={() => removeFromCompare(u.id)}>✕ {ar.compare.remove}</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, fn]) => (
                <tr key={name} className="border-t border-line">
                  <th scope="row" className="p-3 text-start font-medium text-mute">{name}</th>
                  {units.map((u) => <td key={u.id} className="p-3">{fn(u)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
