import { Link } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { fmtPrice } from '../lib/format'
import { images } from '../lib/images'
import { addToCompare, useCompareIds } from '../lib/compare'
import type { Unit } from '../lib/types'
import { Badge } from './ui'

export function UnitCard({ unit }: { unit: Unit }) {
  const { user, favorites, toggleFavorite } = useAuth()
  const toast = useToast()
  const compare = useCompareIds()
  const fav = favorites.has(unit.id)
  const cover = unit.images[0]
  return (
    <article className="panel overflow-hidden">
      <Link to={`/unit/${unit.id}`} className="block">
        <div className="aspect-[4/3] bg-line/50">
          {cover && <img src={images.url(cover, { w: 480, h: 360 })} alt={unit.title} loading="lazy" width={480} height={360} className="h-full w-full object-cover" />}
        </div>
      </Link>
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="nile">{unit.typeName}</Badge>
          {unit.ownerType === 'broker' && <Badge tone="sand">{ar.unit.broker}</Badge>}
          {unit.ownerVerified && <Badge tone="sand">{ar.unit.verified}</Badge>}
        </div>
        <h3 className="line-clamp-2 text-base font-semibold"><Link to={`/unit/${unit.id}`}>{unit.title}</Link></h3>
        <p className="text-lg font-bold text-nile">{fmtPrice(unit.price, unit.rentType)}</p>
        <p className="text-sm text-mute">{unit.governorateName} — {unit.areaName}</p>
        <p className="text-sm text-mute">{unit.rooms} {ar.unit.rooms} · {unit.bathrooms} {ar.unit.baths} · {unit.area} {ar.unit.size}</p>
        <div className="flex gap-2 pt-1">
          <button
            type="button" className="btn-ghost !px-3 !py-1.5 text-sm" aria-pressed={fav}
            onClick={() => { if (!user) { toast.err(ar.auth.loginRequired); return } toggleFavorite(unit.id).catch(() => toast.err(ar.errors.generic)) }}
          >{fav ? '♥' : '♡'} <span className="sr-only">{fav ? ar.unit.unfavorite : ar.unit.favorite}</span></button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => { const r = addToCompare(unit.id); toast[r === 'full' ? 'err' : 'ok'](r === 'full' ? ar.compare.max : ar.unit.inCompare) }}>
            {compare.includes(unit.id) ? ar.unit.inCompare : ar.unit.compare}
          </button>
        </div>
      </div>
    </article>
  )
}
