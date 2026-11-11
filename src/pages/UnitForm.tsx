import { Suspense, lazy, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Timestamp, doc, getDoc, serverTimestamp, writeBatch } from 'firebase/firestore'
import { ar } from '../i18n/ar'
import { errDetail } from '../lib/errors'
import { rt } from '../i18n/rent'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { db } from '../lib/firebase'
import { PHONE_RE, addDays } from '../lib/format'
import { usePageMeta } from '../lib/seo'
import { getUnit } from '../lib/units'
import { collection } from 'firebase/firestore'
import type { Audience, DepositMode, RentType } from '../lib/types'
import { Empty, ErrorBox, Field, Spinner } from '../components/ui'
import { ImageUploader } from '../components/ImageUploader'
import { LocationSelect } from '../components/LocationSelect'
import type { Pin } from '../components/PinPicker'

const PinPicker = lazy(() => import('../components/PinPicker'))

interface FormState {
  title: string; description: string; typeId: string; rentType: RentType; price: string; deposit: string; depositMode: DepositMode
  govId: string; areaId: string; localityId: string; localityText: string; address: string; pin: Pin | null
  rooms: string; bathrooms: string; area: string; floor: string; furnished: boolean; amenities: string[]
  student: boolean; audience: Audience; images: string[]; phone: string; whatsapp: string
}
const EMPTY: FormState = {
  title: '', description: '', typeId: '', rentType: 'monthly', price: '', deposit: '', depositMode: 'none', govId: '', areaId: '', localityId: '', localityText: '', address: '', pin: null,
  rooms: '1', bathrooms: '1', area: '', floor: '0', furnished: false, amenities: [], student: false, audience: 'all', images: [], phone: '', whatsapp: '',
}
const OTHER = '__other'

export default function UnitForm() {
  const { id } = useParams()
  const editing = !!id
  usePageMeta({ title: editing ? ar.form.editTitle : ar.form.addTitle, noindex: true })
  const { user, profile, isAdmin, banned } = useAuth()
  const { settings, locations } = useSettings()
  const toast = useToast()
  const nav = useNavigate()
  const [f, setF] = useState<FormState>(EMPTY)
  const [loading, setLoading] = useState(editing)
  const [loadErr, setLoadErr] = useState<unknown>(null)
  const [forbidden, setForbidden] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    if (!editing || !id || !user) return
    let alive = true
    ;(async () => {
      try {
        const u = await getUnit(id)
        if (!alive) return
        if (!u || (u.ownerId !== user.uid && !isAdmin)) { setForbidden(true); return }
        const c = await getDoc(doc(db, 'contacts', id))
        setF({
          title: u.title, description: u.description, typeId: u.typeId, rentType: u.rentType, price: String(u.price), deposit: u.deposit != null ? String(u.deposit) : '', depositMode: u.depositMode,
          govId: u.governorateId, areaId: u.areaId, localityId: u.localityId ?? (u.localityName ? OTHER : ''), localityText: u.localityId ? '' : u.localityName, address: u.address,
          pin: u.lat != null && u.lng != null ? { lat: u.lat, lng: u.lng } : null,
          rooms: String(u.rooms), bathrooms: String(u.bathrooms), area: String(u.area), floor: String(u.floor), furnished: u.furnished, amenities: u.amenities,
          student: u.studentHousing, audience: u.audience, images: u.images, phone: String(c.data()?.phone ?? ''), whatsapp: String(c.data()?.whatsapp ?? ''),
        })
      } catch (e) { if (alive) setLoadErr(e) } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [editing, id, user, isAdmin])

  if (loading) return <Spinner />
  if (loadErr) return <div className="mx-auto max-w-3xl px-4 py-10"><ErrorBox error={loadErr} /></div>
  if (forbidden) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty title={ar.errors.permission} /></div>
  if (banned) return <div className="mx-auto max-w-3xl px-4 py-10"><Empty title={ar.form.blocked} /></div>

  const localities = f.areaId ? locations.localitiesByArea[f.areaId] ?? [] : []

  function validate(): boolean {
    const e: Record<string, string> = {}
    if (f.title.trim().length < 5 || f.title.trim().length > 120) e.title = ar.form.errTitle
    if (!f.typeId) e.typeId = ar.form.errType
    const price = Number(f.price)
    if (!Number.isFinite(price) || price <= 0) e.price = ar.form.errPrice
    if (!f.govId || !f.areaId) e.gov = ar.form.errGov
    if (f.images.length < settings.minImages || f.images.length > settings.maxImages) e.images = `${ar.form.errImages} ${settings.minImages} و${settings.maxImages}`
    if (!PHONE_RE.test(f.phone.trim())) e.phone = ar.form.errPhone
    if (f.whatsapp.trim() && !PHONE_RE.test(f.whatsapp.trim())) e.whatsapp = ar.form.errPhone
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!user || !profile || !validate()) return
    setBusy(true)
    try {
      const type = settings.unitTypes.find((x) => x.id === f.typeId)
      const gov = locations.govById[f.govId]
      const area = locations.areaById[f.areaId]
      const loc = f.localityId && f.localityId !== OTHER ? localities.find((l) => l.id === f.localityId) : undefined
      const num = (s: string) => (s.trim() === '' ? 0 : Number(s))
      const editable = {
        title: f.title.trim(), description: f.description.trim().slice(0, 3000), typeId: f.typeId, typeName: type?.label ?? f.typeId, rentType: f.rentType,
        price: Number(f.price), deposit: f.rentType === 'monthly' && f.deposit.trim() !== '' ? Number(f.deposit) : null,
        depositMode: f.rentType === 'monthly' && f.deposit.trim() !== '' && Number(f.deposit) > 0 ? f.depositMode : 'none',
        governorateId: f.govId, governorateName: gov?.name ?? '', areaId: f.areaId, areaName: area?.name ?? '',
        localityId: loc?.id ?? null, localityName: loc?.name ?? f.localityText.trim().slice(0, 80), address: f.address.trim().slice(0, 200),
        lat: f.pin?.lat ?? null, lng: f.pin?.lng ?? null,
        rooms: Math.round(num(f.rooms)), bathrooms: Math.round(num(f.bathrooms)), area: num(f.area), floor: Math.round(num(f.floor)),
        furnished: f.furnished, amenities: f.amenities, studentHousing: f.student, audience: f.audience, images: f.images,
      }
      const contacts = { phone: f.phone.trim(), whatsapp: f.whatsapp.trim() }
      const batch = writeBatch(db)
      if (editing && id) {
        const owner = !isAdmin || (await getUnit(id))?.ownerId === user.uid
        batch.update(doc(db, 'units', id), owner ? { ...editable, ownerName: profile.displayName, ownerType: profile.accountType } : editable)
        const ownerId = (await getDoc(doc(db, 'contacts', id))).data()?.ownerId ?? user.uid
        batch.set(doc(db, 'contacts', id), { ...contacts, ownerId })
      } else {
        const ref = doc(collection(db, 'units'))
        const days = settings.defaultAdDays
        batch.set(ref, {
          ...editable, ownerId: user.uid, ownerName: profile.displayName, ownerType: profile.accountType, ownerVerified: profile.verified,
          status: 'active', hiddenByAdmin: false, durationMode: 'default', createdAt: serverTimestamp(),
          expiresAt: days > 0 ? Timestamp.fromDate(addDays(new Date(), days - 1 / 1440)) : null,
        })
        batch.set(doc(db, 'contacts', ref.id), { ...contacts, ownerId: user.uid })
        await batch.commit()
        toast.ok(ar.form.published)
        nav(`/unit/${ref.id}`)
        return
      }
      await batch.commit()
      toast.ok(ar.form.updated)
      nav(`/unit/${id}`)
    } catch (e) {
      console.error('publish failed', e)
      toast.err(`${ar.errors.generic} (${errDetail(e)})`)
    } finally { setBusy(false) }
  }

  const num = (k: keyof FormState, label: string, min = 0) => (
    <Field label={label}><input className="field" type="number" min={min} value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} /></Field>
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-3xl">{editing ? ar.form.editTitle : ar.form.addTitle}</h1>
      {!editing && <p className="mt-2 text-sm text-mute">{ar.form.expiryInfo} {settings.defaultAdDays > 0 ? `${settings.defaultAdDays} ${ar.form.days}` : ar.form.noExpiry}</p>}
      <form className="mt-6 space-y-8" onSubmit={(e) => void submit(e)} noValidate>
        <section className="panel space-y-4 p-5">
          <Field label={ar.form.title} error={errors.title}><input className="field" maxLength={120} value={f.title} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label={ar.form.description}><textarea className="field" rows={5} maxLength={3000} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={ar.form.type} error={errors.typeId}>
              <select className="field" value={f.typeId} onChange={(e) => set('typeId', e.target.value)}>
                <option value="">—</option>
                {settings.unitTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Field>
            <Field label={ar.form.rent}>
              <select className="field" value={f.rentType} onChange={(e) => set('rentType', e.target.value as RentType)}>
                <option value="monthly">{ar.search.monthly}</option>
                <option value="daily">{ar.search.daily}</option>
              </select>
            </Field>
            <Field label={`${ar.form.price} (${ar.common.currency} / ${f.rentType === 'monthly' ? 'شهر' : 'يوم'})`} error={errors.price}><input className="field" type="number" min={1} inputMode="numeric" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
            {f.rentType === 'monthly' && <Field label={ar.form.deposit}><input className="field" type="number" min={0} inputMode="numeric" value={f.deposit} onChange={(e) => set('deposit', e.target.value)} /></Field>}
            {f.rentType === 'monthly' && Number(f.deposit) > 0 && (
              <Field label={rt.depositModeLabel} hint={rt.depositModeHint}>
                <select className="field" value={f.depositMode} onChange={(e) => set('depositMode', e.target.value as DepositMode)}>
                  {(Object.keys(rt.depositModes) as DepositMode[]).map((m) => <option key={m} value={m}>{rt.depositModes[m]}</option>)}
                </select>
              </Field>
            )}
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <LocationSelect govId={f.govId} areaId={f.areaId} anyLabel={false} onChange={(v) => setF((p) => ({ ...p, govId: v.govId, areaId: v.areaId, localityId: '', localityText: '' }))} />
          </div>
          {errors.gov && <p className="text-xs text-danger" role="alert">{errors.gov}</p>}
          {f.areaId && (
            <div className="grid gap-4 sm:grid-cols-2">
              {localities.length > 0 && (
                <Field label={ar.form.locality}>
                  <select className="field" value={f.localityId} onChange={(e) => set('localityId', e.target.value)}>
                    <option value="">—</option>
                    {localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    <option value={OTHER}>{ar.form.localityOther}</option>
                  </select>
                </Field>
              )}
              {(localities.length === 0 || f.localityId === OTHER) && <Field label={ar.form.localityText}><input className="field" maxLength={80} value={f.localityText} onChange={(e) => set('localityText', e.target.value)} /></Field>}
            </div>
          )}
          <Field label={ar.form.address}><input className="field" maxLength={200} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <div>
            <p className="label">{ar.form.pin}</p>
            <Suspense fallback={<Spinner />}><PinPicker value={f.pin} onChange={(p) => set('pin', p)} /></Suspense>
          </div>
        </section>

        <section className="panel space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-4">
            {num('rooms', ar.form.rooms)}{num('bathrooms', ar.form.baths)}{num('area', ar.form.size)}{num('floor', ar.form.floor, -2)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.furnished} onChange={(e) => set('furnished', e.target.checked)} /> {ar.form.furnished}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.student} onChange={(e) => set('student', e.target.checked)} /> {ar.form.student}</label>
          </div>
          <Field label={ar.form.audience}>
            <select className="field" value={f.audience} onChange={(e) => set('audience', e.target.value as Audience)}>
              <option value="all">{ar.search.audAll}</option>
              <option value="families">{ar.search.audFamilies}</option>
              <option value="singles">{ar.search.audSingles}</option>
            </select>
          </Field>
          <fieldset>
            <legend className="label">{ar.form.amenities}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {settings.amenities.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 text-sm">
                  <input type="checkbox" checked={f.amenities.includes(a.id)} onChange={(e) => set('amenities', e.target.checked ? [...f.amenities, a.id] : f.amenities.filter((x) => x !== a.id))} /> {a.label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="panel space-y-3 p-5">
          <h2 className="font-display text-lg">{ar.form.images}</h2>
          <ImageUploader value={f.images} onChange={(v) => set('images', v)} min={settings.minImages} max={settings.maxImages} />
          {errors.images && <p className="text-sm text-danger" role="alert">{errors.images}</p>}
        </section>

        <section className="panel space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={ar.form.phone} error={errors.phone}><input className="field" dir="ltr" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label={ar.form.whatsapp} error={errors.whatsapp}><input className="field" dir="ltr" inputMode="tel" value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></Field>
          </div>
          <p className="text-xs text-mute">{ar.form.contactNote}</p>
        </section>

        <div className="flex gap-3">
          <button className="btn-primary" type="submit" disabled={busy}>{editing ? ar.form.saveChanges : ar.form.publish}</button>
          <Link className="btn-ghost" to="/dashboard">{ar.common.cancel}</Link>
        </div>
      </form>
    </div>
  )
}
