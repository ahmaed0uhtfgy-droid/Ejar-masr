import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { ApiError, apiPost } from '../lib/api'
import { fmtDate, fmtNum, fmtPrice, isExpired, toWhatsAppNumber } from '../lib/format'
import { images } from '../lib/images'
import { addToCompare } from '../lib/compare'
import { SITE_URL } from '../lib/defaults'
import { usePageMeta } from '../lib/seo'
import { getUnit } from '../lib/units'
import { isQuotaError } from '../lib/errors'
import type { Unit } from '../lib/types'
import { Badge, Empty, ErrorBox, Spinner } from '../components/ui'
import { ReportDialog } from '../components/ReportDialog'
import { RentRequestDialog } from '../components/RentRequestDialog'
import { rt } from '../i18n/rent'

const PinPicker = lazy(() => import('../components/PinPicker'))

interface Revealed { phone: string; whatsapp: string; remaining: number }

export default function UnitDetail() {
  const { id = '' } = useParams()
  const { user, profile, isAdmin, banned, favorites, toggleFavorite } = useAuth()
  const { settings, locations, markQuota } = useSettings()
  const toast = useToast()
  const [unit, setUnit] = useState<Unit | null | undefined>(undefined)
  const [err, setErr] = useState<unknown>(null)
  const [img, setImg] = useState(0)
  const [revealed, setRevealed] = useState<Revealed | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [reveal, setRevealErr] = useState('')
  const [reporting, setReporting] = useState(false)
  const [renting, setRenting] = useState(false)

  useEffect(() => {
    let alive = true
    setUnit(undefined); setErr(null); setRevealed(null); setImg(0)
    getUnit(id).then((u) => alive && setUnit(u)).catch((e) => { if (isQuotaError(e)) markQuota(); if (alive) setErr(e) })
    return () => { alive = false }
  }, [id, markQuota])

  const isOwner = !!unit && user?.uid === unit.ownerId
  const privileged = isOwner || isAdmin
  const expired = !!unit && isExpired(unit.expiresAt)
  const unavailable = !!unit && !privileged && (unit.status !== 'active' || expired)

  usePageMeta({
    title: unit ? `${unit.title} — ${unit.typeName} للإيجار في ${unit.areaName}، ${unit.governorateName}` : 'تفاصيل الوحدة',
    description: unit ? `${unit.typeName} للإيجار في ${unit.areaName}، ${unit.governorateName} بسعر ${fmtPrice(unit.price, unit.rentType)}. ${unit.rooms} غرف، ${unit.area} م².` : undefined,
    noindex: !unit || unavailable || unit.status !== 'active' || expired,
    path: `/unit/${id}`,
    image: unit?.images[0] ? images.url(unit.images[0], { w: 1200, h: 630 }) : undefined,
  })

  // One view per unit per browser session (see /api/view for server-side throttling).
  useEffect(() => {
    if (!unit || unit.status !== 'active' || !settings.trackViews || privileged) return
    const k = `ejar:viewed:${unit.id}`
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, '1') } catch { /* ignore */ }
    apiPost('/api/view', { unitId: unit.id }).catch(() => undefined)
  }, [unit, settings.trackViews, privileged])

  if (err) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={err} /></div>
  if (unit === undefined) return <Spinner />
  if (unit === null || unit.status === 'removed' && !privileged) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty title={ar.errors.notFound} action={<Link className="btn-primary" to="/search">{ar.nav.search}</Link>} /></div>
  if (unavailable) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty title={ar.unit.expiredPublic} action={<Link className="btn-primary" to="/search">{ar.nav.search}</Link>} /></div>

  const amenityLabel = (aid: string) => settings.amenities.find((a) => a.id === aid)?.label ?? aid
  const locality = unit.localityId ? locations.localitiesByArea[unit.areaId]?.find((l) => l.id === unit.localityId)?.name ?? unit.localityName : unit.localityName
  const shareUrl = `${SITE_URL}/unit/${unit.id}`
  const fav = favorites.has(unit.id)

  async function doReveal() {
    setRevealing(true); setRevealErr('')
    try { setRevealed(await apiPost<Revealed>('/api/reveal', { unitId: unit!.id })) }
    catch (e) { setRevealErr(e instanceof ApiError && e.status === 429 ? ar.unit.limitReached : e instanceof ApiError ? e.message : ar.errors.generic) }
    finally { setRevealing(false) }
  }
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: unit!.title, url: shareUrl })
      else { await navigator.clipboard.writeText(shareUrl); toast.ok(ar.unit.copied) }
    } catch { /* user cancelled */ }
  }

  const banner = unit.status === 'rented' ? ar.unit.rented : unit.status === 'hidden' ? ar.unit.hidden : unit.status === 'removed' ? ar.unit.removed : expired ? ar.unit.expired : ''

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {banner && <p className="mb-4 rounded-field border border-sand p-3 text-sm" role="status">{banner}{privileged ? ' (ظاهر لك انت بس)' : ''}</p>}
      <div className="grid gap-8 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="panel overflow-hidden">
            <div className="aspect-[4/3] bg-line/50">
              {unit.images[img] && <img src={images.url(unit.images[img], { w: 1000 })} alt={unit.title} width={1000} height={750} className="h-full w-full object-cover" />}
            </div>
          </div>
          {unit.images.length > 1 && (
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {unit.images.map((im, i) => (
                <li key={im}>
                  <button type="button" onClick={() => setImg(i)} aria-label={`صورة ${fmtNum(i + 1)}`} aria-current={i === img} className={`block overflow-hidden rounded-field border-2 ${i === img ? 'border-nile' : 'border-transparent'}`}>
                    <img src={images.url(im, { w: 120, h: 90 })} alt="" loading="lazy" width={120} height={90} className="h-16 w-24 object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <section className="mt-8">
            <h2 className="font-display text-xl">{ar.unit.description}</h2>
            <p className="mt-2 whitespace-pre-line text-mute">{unit.description}</p>
          </section>
          {unit.amenities.length > 0 && (
            <section className="mt-8">
              <h2 className="font-display text-xl">{ar.unit.amenities}</h2>
              <ul className="mt-2 flex flex-wrap gap-2">{unit.amenities.map((a) => <li key={a} className="chip">{amenityLabel(a)}</li>)}</ul>
            </section>
          )}
          <section className="mt-8">
            <h2 className="font-display text-xl">{ar.unit.location}</h2>
            <p className="mt-2 text-mute">{unit.governorateName} — {unit.areaName}{locality ? ` — ${locality}` : ''}</p>
            {unit.address && <p className="text-mute">{ar.unit.address}: {unit.address}</p>}
            <div className="mt-3">
              {unit.lat != null && unit.lng != null
                ? <Suspense fallback={<Spinner />}><PinPicker value={{ lat: unit.lat, lng: unit.lng }} readOnly /></Suspense>
                : <p className="text-sm text-mute">{ar.unit.noMap}</p>}
            </div>
          </section>
        </div>

        <aside className="lg:col-span-2">
          <div className="panel space-y-4 p-5 lg:sticky lg:top-20">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="nile">{unit.typeName}</Badge>
              {unit.ownerType === 'broker' ? <Badge tone="sand">{ar.unit.broker}</Badge> : <Badge>{ar.unit.owner}</Badge>}
              {unit.ownerVerified && <Badge tone="sand">{ar.unit.verified}</Badge>}
            </div>
            <h1 className="font-display text-2xl">{unit.title}</h1>
            <p className="text-2xl font-bold text-nile">{fmtPrice(unit.price, unit.rentType)}</p>
            {unit.rentType === 'monthly' && unit.deposit != null && <p className="text-mute">{ar.unit.deposit}: {fmtNum(unit.deposit)} {ar.common.currency}</p>}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-mute">{ar.unit.rooms}</dt><dd className="font-medium">{fmtNum(unit.rooms)}</dd></div>
              <div><dt className="text-mute">{ar.unit.baths}</dt><dd className="font-medium">{fmtNum(unit.bathrooms)}</dd></div>
              <div><dt className="text-mute">{ar.unit.size}</dt><dd className="font-medium">{fmtNum(unit.area)}</dd></div>
              <div><dt className="text-mute">{ar.unit.floor}</dt><dd className="font-medium">{fmtNum(unit.floor)}</dd></div>
            </dl>
            <p className="flex flex-wrap gap-2 text-sm">
              <span className="chip">{unit.furnished ? ar.unit.furnished : ar.unit.unfurnished}</span>
              {unit.studentHousing && <span className="chip">{ar.unit.student}</span>}
              {unit.audience === 'families' && <span className="chip">{ar.unit.families}</span>}
              {unit.audience === 'singles' && <span className="chip">{ar.unit.singles}</span>}
            </p>
            {unit.expiresAt && <p className="text-sm text-mute">{ar.unit.validUntil} {fmtDate(unit.expiresAt)}</p>}

            {revealed ? (
              <div className="space-y-2 rounded-field border border-nile p-3">
                <a className="btn-primary w-full" href={`tel:${revealed.phone.replace(/\s/g, '')}`}>{ar.unit.call}: <bdi dir="ltr">{revealed.phone}</bdi></a>
                {revealed.whatsapp && <a className="btn-ghost w-full" target="_blank" rel="noopener noreferrer" href={`https://wa.me/${toWhatsAppNumber(revealed.whatsapp)}`}>{ar.unit.whatsapp}</a>}
                <p className="text-xs text-mute">{ar.unit.remaining} {fmtNum(revealed.remaining)}</p>
              </div>
            ) : user ? (
              <button type="button" className="btn-primary w-full" disabled={revealing || banned || !profile} onClick={() => void doReveal()}>{revealing ? ar.unit.revealing : ar.unit.reveal}</button>
            ) : (
              <Link className="btn-primary w-full" to="/login" state={{ from: `/unit/${unit.id}` }}>{ar.unit.loginToReveal}</Link>
            )}
            {reveal && <p className="text-sm text-danger" role="alert">{reveal}</p>}
            {unit.status === 'active' && !isOwner && (user ? (
              <button type="button" className="btn-primary w-full" disabled={banned || !profile} onClick={() => setRenting(true)}>{rt.request}</button>
            ) : (
              <Link className="btn-primary w-full" to="/login" state={{ from: `/unit/${unit.id}` }}>{rt.loginFirst}</Link>
            ))}
            {unit.status === 'active' && !isOwner && <p className="text-xs text-mute">{rt.requestHint}</p>}
            <p className="text-xs text-mute">{ar.unit.safetyHint} <Link className="underline" to="/safety">{ar.footer.safety}</Link></p>

            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" aria-pressed={fav} onClick={() => { if (!user) { toast.err(ar.auth.loginRequired); return } toggleFavorite(unit.id).catch(() => toast.err(ar.errors.generic)) }}>{fav ? '♥' : '♡'} {fav ? ar.unit.unfavorite : ar.unit.favorite}</button>
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => { const r = addToCompare(unit.id); toast[r === 'full' ? 'err' : 'ok'](r === 'full' ? ar.compare.max : ar.unit.inCompare) }}>{ar.unit.compare}</button>
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => void share()}>{ar.unit.share}</button>
              <a className="btn-ghost !px-3 !py-1.5 text-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`${unit.title} ${shareUrl}`)}`}>{ar.unit.shareWa}</a>
            </div>
            <button type="button" className="text-sm text-danger underline" onClick={() => setReporting(true)}>{ar.unit.report}</button>
            {privileged && <Link className="block text-sm text-nile underline" to={`/dashboard/units/${unit.id}/edit`}>{ar.common.edit}</Link>}
          </div>
        </aside>
      </div>
      {reporting && <ReportDialog unit={unit} onClose={() => setReporting(false)} />}
      {renting && <RentRequestDialog unit={unit} onClose={() => setRenting(false)} />}
    </div>
  )
}
