import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import { removeFromCompare, useCompareIds } from '../lib/compare'
import { fmtNum, fmtPrice } from '../lib/format'
import { images } from '../lib/images'
import { usePageMeta } from '../lib/seo'
import { getUnits } from '../lib/units'
import type { Unit } from '../lib/types'
import { Empty, ErrorBox, Spinner } from '../components/ui'

export default function Compare() {
  usePageMeta({ title: ar.compare.title, noindex: true })
  const ids = useCompareIds()
  const { settings } = useSettings()
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    setUnits(null)
    getUnits(ids).then((u) => alive && setUnits(u)).catch((e) => alive && setErr(e))
    return () => { alive = false }
  }, [ids])

  if (err) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={err} /></div>
  if (ids.length === 0) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty title={ar.compare.empty} action={<Link to="/search" className="btn-primary">{ar.nav.search}</Link>} /></div>
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
      <h1 className="font-display text-3xl">{ar.compare.title}</h1>
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
                  <button type="button" className="mt-1 text-sm text-danger underline" onClick={() => removeFromCompare(u.id)}>{ar.compare.remove}</button>
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
    </div>
  )
}
