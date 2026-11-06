import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import { db } from '../lib/firebase'
import { usePageMeta } from '../lib/seo'
import { latestUnits } from '../lib/units'
import { fmtNum } from '../lib/format'
import { isQuotaError } from '../lib/errors'
import type { Unit } from '../lib/types'
import { UnitCard } from '../components/UnitCard'
import { Empty, ErrorBox, Field, Spinner } from '../components/ui'

const POPULAR = ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الشرقية', 'المنوفية', 'الغربية', 'أسيوط', 'سوهاج', 'جنوب سيناء', 'البحر الأحمر', 'الأقصر']

export default function Home() {
  usePageMeta({ title: ar.home.title, description: ar.home.description, path: '/' })
  const { locations, settings, markQuota } = useSettings()
  const nav = useNavigate()
  const [gov, setGov] = useState('')
  const [type, setType] = useState('')
  const [rent, setRent] = useState('')
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [count, setCount] = useState<number | null>(null)
  const [tab, setTab] = useState<'client' | 'adv'>('client')

  useEffect(() => {
    let alive = true
    latestUnits(8).then((u) => alive && setUnits(u)).catch((e) => { if (isQuotaError(e)) markQuota(); if (alive) setErr(e) })
    // Count of documents with status=active (may include a few whose automatic expiry has passed).
    getCountFromServer(query(collection(db, 'units'), where('status', '==', 'active'))).then((s) => alive && setCount(s.data().count)).catch(() => undefined)
    return () => { alive = false }
  }, [markQuota])

  const popular = POPULAR.map((n) => locations.govs.find((g) => g.name === n)).filter((g): g is NonNullable<typeof g> => !!g)

  function go(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (gov) p.set('gov', gov)
    if (type) p.set('type', type)
    if (rent) p.set('rent', rent)
    nav(`/search?${p.toString()}`)
  }

  const steps = tab === 'client' ? ar.home.clientSteps : ar.home.advSteps

  return (
    <>
      <section className="border-b border-line bg-gradient-to-b from-surface to-paper">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-14 md:grid-cols-5 md:py-20">
          <div className="md:col-span-3">
            <h1 className="font-display text-4xl font-bold leading-snug md:text-5xl">{ar.home.heroTitle}</h1>
            <p className="mt-4 max-w-xl text-lg text-mute">{ar.home.heroText}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/search" className="btn-primary">{ar.nav.search}</Link>
              <Link to="/dashboard/new" className="btn-ghost">{ar.nav.add}</Link>
            </div>
          </div>
          <form onSubmit={go} className="panel space-y-3 rounded-hero p-5 shadow-sm md:col-span-2" aria-label={ar.nav.search}>
            <Field label={ar.home.govLabel}>
              <select className="field" value={gov} onChange={(e) => setGov(e.target.value)}>
                <option value="">{ar.home.anyGov}</option>
                {locations.govs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label={ar.home.typeLabel}>
              <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{ar.home.anyType}</option>
                {settings.unitTypes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </Field>
            <Field label={ar.home.rentLabel}>
              <select className="field" value={rent} onChange={(e) => setRent(e.target.value)}>
                <option value="">{ar.home.anyRent}</option>
                <option value="monthly">{ar.search.monthly}</option>
                <option value="daily">{ar.search.daily}</option>
              </select>
            </Field>
            <button className="btn-primary w-full" type="submit">{ar.home.searchBtn}</button>
          </form>
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-8">
          <p className="mb-2 text-sm text-mute">{ar.home.popular}</p>
          <ul className="flex flex-wrap gap-2">
            {popular.map((g) => <li key={g.id}><Link className="chip hover:border-nile hover:text-nile" to={`/rent/${g.slug}`}>{g.name}</Link></li>)}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="font-display text-2xl">{ar.home.whatTitle}</h2>
        <p className="mt-3 text-mute">{ar.home.whatText}</p>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="font-display text-2xl">{ar.home.howTitle}</h2>
          <div role="tablist" className="mt-4 inline-flex rounded-field border border-line p-1">
            {(['client', 'adv'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                className={`rounded-md px-4 py-1.5 text-sm ${tab === k ? 'bg-nile-dark text-white dark:text-paper' : ''}`}>
                {k === 'client' ? ar.home.forClient : ar.home.forAdvertiser}
              </button>
            ))}
          </div>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.t} className="rounded-panel border border-line bg-paper p-5">
                <span className="font-display text-nile" aria-hidden="true">{fmtNum(i + 1)}</span>
                <h3 className="mt-1 font-display text-lg">{s.t}</h3>
                <p className="mt-1 text-mute">{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-2xl">{ar.home.latest}</h2>
          <Link to="/search" className="text-nile underline">{ar.home.viewAll}</Link>
        </div>
        <div className="mt-6">
          {err ? <ErrorBox error={err} /> : units === null ? <Spinner /> : units.length === 0 ? (
            <Empty title={ar.home.latestEmpty} action={<Link to="/dashboard/new" className="btn-primary">{ar.nav.add}</Link>} />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{units.map((u) => <UnitCard key={u.id} unit={u} />)}</div>
          )}
        </div>
      </section>

      {count !== null && count > 0 && (
        <section className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-10">
            <h2 className="font-display text-2xl">{ar.home.statsTitle}</h2>
            <dl className="mt-4 grid gap-6 sm:grid-cols-2">
              <div><dd className="font-display text-3xl text-nile">{fmtNum(count)}</dd><dt className="text-mute">{ar.home.statsUnits}</dt></div>
              <div><dd className="font-display text-3xl text-nile">{fmtNum(locations.govs.length)}</dd><dt className="text-mute">{ar.home.statsGovs}</dt></div>
            </dl>
            <p className="mt-3 text-xs text-mute">{ar.home.statsAsOf}</p>
          </div>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-4 py-14">
        <h2 className="font-display text-2xl">{ar.home.faqTitle}</h2>
        <div className="mt-4 divide-y divide-line rounded-panel border border-line bg-surface">
          {ar.home.faq.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="cursor-pointer font-medium">{f.q}</summary>
              <p className="mt-2 text-mute">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="bg-nile-dark text-white dark:text-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-display text-2xl">{ar.home.ctaTitle}</h2>
            <p className="mt-1 opacity-90">{ar.home.ctaText}</p>
          </div>
          <Link to="/dashboard/new" className="btn bg-white text-nile-dark hover:bg-line dark:bg-paper dark:text-ink">{ar.nav.add}</Link>
        </div>
      </section>
    </>
  )
}
