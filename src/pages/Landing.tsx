import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import { LANDING_NOTES } from '../content/landing'
import { usePageMeta } from '../lib/seo'
import { searchUnits } from '../lib/units'
import type { Unit } from '../lib/types'
import { UnitCard } from '../components/UnitCard'
import { Empty, ErrorBox, Spinner } from '../components/ui'
import NotFound from './NotFound'

export default function Landing() {
  const { gov: slug = '', type: typeId } = useParams()
  const { locations, settings } = useSettings()
  const gov = locations.govs.find((g) => g.slug === slug)
  const type = typeId ? settings.unitTypes.find((x) => x.id === typeId) : undefined
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState<unknown>(null)

  const plural = type?.plural ?? type?.label ?? ''
  const title = gov ? (type ? ar.landing.titleType(plural, gov.name) : ar.landing.titleGov(gov.name)) : ''
  const intro = gov ? (type ? ar.landing.introType(plural, gov.name) : ar.landing.intro(gov.name)) : ''
  usePageMeta({ title, description: intro, path: `/rent/${slug}${typeId ? `/${typeId}` : ''}`, noindex: !gov || (!!typeId && !type) })

  useEffect(() => {
    if (!gov) return
    let alive = true
    setUnits(null); setErr(null)
    searchUnits({ governorateId: gov.id, typeId: type?.id }, 'newest', null, 12).then((p) => alive && setUnits(p.items)).catch((e) => alive && setErr(e))
    return () => { alive = false }
  }, [gov, type?.id])

  if (!gov || (typeId && !type)) return <NotFound />
  const notes = LANDING_NOTES[gov.slug] ?? []
  const faqs = [ar.landing.faqPrice(gov.name), ar.landing.faqSafe]
  const params = new URLSearchParams({ gov: gov.id, ...(type ? { type: type.id } : {}) })

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="مسار التنقل" className="text-sm text-mute"><Link to="/">{ar.nav.home}</Link> / <Link to={`/rent/${gov.slug}`}>{gov.name}</Link>{type && <> / {plural}</>}</nav>
      <h1 className="mt-3 font-display text-3xl md:text-4xl">{title}</h1>
      <p className="mt-3 max-w-2xl text-mute">{intro}</p>
      {notes.map((n) => <p key={n} className="mt-3 max-w-2xl text-mute">{n}</p>)}

      <section className="mt-8">
        {err ? <ErrorBox error={err} /> : units === null ? <Spinner /> : units.length === 0 ? (
          <Empty title={ar.landing.empty} action={<Link className="btn-primary" to="/dashboard/new">{ar.nav.add}</Link>} />
        ) : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{units.map((u) => <UnitCard key={u.id} unit={u} />)}</div>}
        <Link className="btn-ghost mt-5" to={`/search?${params.toString()}`}>{ar.landing.browse}</Link>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl">{ar.landing.other}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {settings.unitTypes.filter((x) => x.id !== type?.id).map((x) => <li key={x.id}><Link className="chip hover:border-nile hover:text-nile" to={`/rent/${gov.slug}/${x.id}`}>{x.plural ?? x.label}</Link></li>)}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl">{ar.landing.faqTitle} {gov.name}</h2>
        <div className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface">
          {faqs.map((f) => <details key={f.q} className="p-4"><summary className="cursor-pointer font-medium">{f.q}</summary><p className="mt-2 text-mute">{f.a}</p></details>)}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-xl">{ar.landing.near}</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {locations.govs.filter((g) => g.id !== gov.id).map((g) => <li key={g.id}><Link className="chip hover:border-nile hover:text-nile" to={`/rent/${g.slug}${type ? `/${type.id}` : ''}`}>{g.name}</Link></li>)}
        </ul>
      </section>
    </div>
  )
}
