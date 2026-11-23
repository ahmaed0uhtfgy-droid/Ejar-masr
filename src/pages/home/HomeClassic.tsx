import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ar } from '../../i18n/ar'
import { fmtNum } from '../../lib/format'
import { images } from '../../lib/images'
import { prefersReducedMotion, sectionProgress, useReveal, useScrollFrame } from '../../lib/motion'
import { UnitCard } from '../../components/UnitCard'
import { Empty, ErrorBox, Field, Spinner } from '../../components/ui'
import type { HomeData } from './useHomeData'
import './home-classic.css'

const STORY = ['/design/classic-family-tower.webp', '/design/classic-stationery.webp', '/design/classic-family-sphinx.webp']

/** Home page, classic design: same content as always (hero + search, what is it, how it works, latest units, stats, articles, FAQ, CTA) in the ivory / navy / gold layout of design 1. */
export function HomeClassic(d: HomeData) {
  const { locations, settings, gov, setGov, type, setType, rent, setRent, units, err, count, tab, setTab, posts, popular, go, steps } = d
  const root = useRef<HTMLDivElement>(null)
  const art = useRef<HTMLImageElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  useReveal(root, [units, posts, count])

  const frame = useCallback((y: number) => {
    if (art.current && y < window.innerHeight) art.current.style.transform = `translateY(${y * 0.1}px) scale(${1 + y / 4500})`
    const i = Math.min(2, Math.floor(sectionProgress(track.current) * 3))
    setActive((a) => (a === i ? a : i))
  }, [])
  useScrollFrame(frame, !prefersReducedMotion())

  return (
    <div ref={root} className="ch">
      <section className="ch-wrap ch-hero">
        <div>
          <small className="font-display text-nile">مكانك في مصر، بإيجار موثوق</small>
          <h1 className="mt-2 font-display font-bold">{ar.home.heroTitle}</h1>
          <p className="text-mute">{ar.home.heroText}</p>
          <div className="ch-cta">
            <Link to="/search" className="btn-primary">{ar.nav.search}</Link>
            <Link to="/dashboard/new" className="btn-ghost">{ar.nav.add}</Link>
          </div>
        </div>
        <div className="ch-art"><img ref={art} src="/design/classic-hero.webp" alt="شعار إيجار مصر: برج زجاجي فوق أبو الهول" width={900} height={900} /></div>
      </section>

      <div className="ch-wrap">
        <form onSubmit={go} className="ch-search" aria-label={ar.nav.search}>
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
          <button className="btn-primary" type="submit">{ar.home.searchBtn}</button>
        </form>
        <div className="ch-popular">
          <p className="mb-2 text-sm text-mute">{ar.home.popular}</p>
          <ul className="flex flex-wrap gap-2">
            {popular.map((g) => <li key={g.id}><Link className="chip hover:border-nile hover:text-nile" to={`/rent/${g.slug}`}>{g.name}</Link></li>)}
          </ul>
        </div>
      </div>

      <section className="ch-dark ch-sec mt-10">
        <div className="ch-wrap">
          <h2 className="ch-h reveal font-display">أنواع الوحدات للإيجار</h2>
          <p className="reveal max-w-xl opacity-85">اختار النوع اللي يناسبك وشوف الوحدات المتاحة منه في كل المحافظات.</p>
          <div className="ch-types">
            {settings.unitTypes.map((t, i) => (
              <Link key={t.id} to={`/search?type=${encodeURIComponent(t.id)}`} className="reveal" style={{ transitionDelay: `${(i % 3) * 120}ms` }}>
                <h3 className="font-display">{t.plural ?? t.label}</h3>
                <p>{ar.home.viewAll}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="ch-sec">
        <div className="ch-wrap ch-split">
          <div className="reveal">
            <h2 className="ch-h font-display">{ar.home.whatTitle}</h2>
            <p className="text-mute">{ar.home.whatText}</p>
          </div>
          <img className="reveal" src="/design/classic-wave.webp" alt="تصميم برج إيجار مصر" width={900} height={900} loading="lazy" />
        </div>
      </section>

      <section className="ch-story border-y border-line">
        <div ref={track} className="ch-track">
          <div className="ch-stick ch-wrap">
            <div>
              <h2 className="font-display text-2xl">{ar.home.howTitle}</h2>
              <div role="tablist" className="ch-tabs mt-3 inline-flex rounded-field border border-line p-1">
                {(['client', 'adv'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
                    className={`rounded-md px-4 py-1.5 text-sm ${tab === k ? 'bg-nile-dark text-white dark:text-paper' : ''}`}>
                    {k === 'client' ? ar.home.forClient : ar.home.forAdvertiser}
                  </button>
                ))}
              </div>
              <ol className="ch-steps mt-4">
                {steps.map((s, i) => (
                  <li key={s.t} className={`ch-step ${i === active ? 'on' : ''}`}>
                    <small>{`${fmtNum(i + 1)} / ${fmtNum(steps.length)}`}</small>
                    <h3 className="font-display">{s.t}</h3>
                    <p className="mt-2 max-w-md text-mute">{s.d}</p>
                  </li>
                ))}
              </ol>
            </div>
            <div className="ch-frame" aria-hidden="true">
              {STORY.map((src, i) => <img key={src} src={src} alt="" className={i === active ? 'on' : ''} loading="lazy" width={900} height={i === 1 ? 491 : 900} />)}
            </div>
          </div>
        </div>
      </section>

      <section className="ch-wrap ch-sec">
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

      <section className="ch-tour ch-sec">
        <div className="ch-wrap ch-split">
          <img className="reveal" src="/design/classic-stationery.webp" alt="هوية إيجار مصر على الموبايل والمطبوعات" width={900} height={491} loading="lazy" />
          <div className="reveal">
            <h2 className="ch-h font-display">كل التفاصيل قبل ما تتحرك</h2>
            <p className="opacity-85">شوف الصور والمواصفات والموقع على الخريطة، وقارن بين الوحدات، وقرر من موبايلك.</p>
            <Link to="/search" className="btn-primary mt-5">{ar.nav.search}</Link>
          </div>
        </div>
      </section>

      {count !== null && count > 0 && (
        <section className="border-b border-line bg-surface">
          <div className="ch-wrap py-10">
            <h2 className="font-display text-2xl">{ar.home.statsTitle}</h2>
            <dl className="mt-4 grid gap-6 sm:grid-cols-2">
              <div><dd className="font-display text-3xl text-nile">{fmtNum(count)}</dd><dt className="text-mute">{ar.home.statsUnits}</dt></div>
              <div><dd className="font-display text-3xl text-nile">{fmtNum(locations.govs.length)}</dd><dt className="text-mute">{ar.home.statsGovs}</dt></div>
            </dl>
            <p className="mt-3 text-xs text-mute">{ar.home.statsAsOf}</p>
          </div>
        </section>
      )}

      <section className="ch-sec">
        <div className="ch-wrap ch-split">
          <div className="reveal">
            <h2 className="ch-h font-display">عائلة إيجار مصر</h2>
            <p className="text-mute">هوية واحدة بأوجه متعددة، تتعرف عليها من أي علامة.</p>
          </div>
          <img className="ch-brand-img reveal" src="/design/classic-family-sphinx.webp" alt="عائلة علامات إيجار مصر" width={900} height={900} loading="lazy" />
        </div>
      </section>

      {posts.length > 0 && (
        <section className="ch-wrap pb-14">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-2xl">{ar.home.blogTitle}</h2>
            <a href="/blog" className="text-nile underline">{ar.home.blogAll}</a>
          </div>
          <ul className="mt-6 grid gap-5 sm:grid-cols-3">
            {posts.map((p) => (
              <li key={p.slug} className="panel overflow-hidden">
                <a href={`/blog/${encodeURIComponent(p.slug)}`} className="block">
                  {p.cover && <img src={images.url(p.cover, { w: 400, h: 250 })} alt={p.coverAlt || p.title} width={400} height={250} loading="lazy" className="aspect-[8/5] w-full object-cover" />}
                  <div className="p-4"><h3 className="font-display text-lg">{p.title}</h3><p className="mt-1 text-sm text-mute">{p.description.slice(0, 110)}</p></div>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-3xl px-4 pb-14">
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

      <section className="ch-seal">
        <img className="reveal" src="/design/classic-seal.webp" alt="ختم إيجار مصر" width={900} height={502} loading="lazy" />
        <h2 className="reveal font-display">{ar.home.ctaTitle}</h2>
        <p className="reveal mt-2">{ar.home.ctaText}</p>
        <Link to="/dashboard/new" className="btn-primary reveal">{ar.nav.add}</Link>
      </section>
    </div>
  )
}
