import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { ar } from '../../i18n/ar'
import { BRAND_EN } from '../../lib/brand'
import { images } from '../../lib/images'
import { prefersReducedMotion, useReveal, useScrollFrame } from '../../lib/motion'
import { UnitCard } from '../../components/UnitCard'
import { Empty, ErrorBox, Spinner } from '../../components/ui'
import type { HomeData } from './useHomeData'
import './home-royal.css'

/** English small caps shown above the type names (design detail). Unknown / admin-added types simply show no English line. */
const TYPE_EN: Record<string, string> = { apartment: 'APARTMENTS', studio: 'STUDIOS', room: 'ROOMS', villa: 'VILLAS', floor: 'FLOORS', commercial: 'SHOPS & OFFICES' }
const HERO_PICK = ['apartment', 'villa', 'commercial']
const FAMILY = [
  { img: '/design/royal-pharaoh.webp', name: 'إيجار مصر البلاتيني', en: 'PLATINUM' },
  { img: '/design/royal-medallion.webp', name: 'مجموعة إيجار مصر', en: 'GROUP' },
  { img: '/design/royal-monogram.webp', name: 'إيجار مصر الملكي', en: 'ROYAL' },
  { img: '/design/royal-pyramid.webp', name: 'إيجار مصر للإسكان', en: 'HOME RENTALS' },
]
const clamp = (v: number) => Math.min(1, Math.max(0, v))

function tilt(e: PointerEvent<HTMLElement>) {
  if (prefersReducedMotion()) return
  const el = e.currentTarget
  const b = el.getBoundingClientRect()
  const x = (e.clientX - b.left) / b.width - 0.5
  const y = (e.clientY - b.top) / b.height - 0.5
  el.style.transform = `perspective(900px) rotateY(${x * 12}deg) rotateX(${-y * 12}deg) translateY(-4px)`
}
const untilt = (e: PointerEvent<HTMLElement>) => { e.currentTarget.style.transform = '' }

/** Number that counts up the first time it is on screen. */
function CountUp({ to }: { to: number }) {
  const ref = useRef<HTMLElement>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) { setN(to); return }
    let raf = 0
    const io = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting) return
      io.disconnect()
      const t0 = performance.now()
      const step = (t: number) => { const f = Math.min(1, (t - t0) / 1500); setN(Math.round(to * (1 - (1 - f) ** 3))); if (f < 1) raf = requestAnimationFrame(step) }
      raf = requestAnimationFrame(step)
    }, { threshold: 0.6 })
    io.observe(el)
    return () => { io.disconnect(); cancelAnimationFrame(raf) }
  }, [to])
  return <b ref={ref}>+{n.toLocaleString('en-US')}</b>
}

/** Home page, royal design: same content and real data as the classic home, in the layout and motion of design 2. */
export function HomeRoyal(d: HomeData) {
  const { locations, settings, gov, setGov, type, setType, units, err, count, tab, setTab, posts, popular, go, steps } = d
  const root = useRef<HTMLDivElement>(null)
  const hero = useRef<HTMLElement>(null)
  const tower = useRef<HTMLImageElement>(null)
  const big = useRef<HTMLDivElement>(null)
  const dust = useRef<HTMLCanvasElement>(null)
  const srv = useRef<HTMLElement>(null)
  const wave = useRef<HTMLImageElement>(null)
  const tl = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('all')
  useReveal(root, [units, posts, count])

  const picks = (() => {
    const byId = HERO_PICK.map((id) => settings.unitTypes.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t)
    return (byId.length === 3 ? byId : settings.unitTypes.slice(0, 3))
  })()

  const frame = useCallback(() => {
    const r = root.current
    if (!r) return
    const vh = window.innerHeight
    const hb = hero.current?.getBoundingClientRect()
    const p = hb ? clamp(-hb.top / Math.max(1, hb.height - vh)) : 0
    if (tower.current) tower.current.style.transform = `translateY(${18 - p * 20}%) scale(${0.78 + p * 0.42})`
    if (big.current) big.current.style.transform = `translateX(${p * -12}vw) scale(${1 + p * 0.2})`
    r.querySelectorAll('.rh-sv').forEach((e, i) => e.classList.toggle('on', p > 0.12 + i * 0.2 && p < 0.98))

    const sb = srv.current?.getBoundingClientRect()
    if (sb && wave.current) {
      const q = clamp(-sb.top / Math.max(1, sb.height - vh))
      wave.current.style.transform = `rotate(${(q - 0.5) * 14}deg) translateY(${-q * 30 + 15}px) scale(${0.96 + q * 0.08})`
    }
    r.querySelectorAll('.rh-sr').forEach((e) => e.classList.toggle('on', e.getBoundingClientRect().top < vh * 0.72))

    const tb = tl.current
    if (tb) {
      const rect = tb.getBoundingClientRect()
      const u = clamp((vh * 0.7 - rect.top) / Math.max(1, rect.height))
      tb.style.setProperty('--p', `${u * 100}%`)
      const stp = tb.querySelectorAll('.rh-stp')
      stp.forEach((e, k) => e.classList.toggle('on', u >= (k + 0.25) / stp.length))
    }
  }, [])
  useScrollFrame(frame, !prefersReducedMotion())

  useEffect(() => { // reduced motion: show everything in its final state
    if (!prefersReducedMotion() || !root.current) return
    root.current.querySelectorAll('.rh-sr, .rh-stp').forEach((e) => e.classList.add('on'))
    tl.current?.style.setProperty('--p', '100%')
  }, [tab])

  useEffect(() => { // gold light that follows the pointer over the hero
    const el = hero.current?.querySelector<HTMLElement>('.rh-hs')
    if (!el) return
    const move = (e: globalThis.PointerEvent) => { const b = el.getBoundingClientRect(); el.style.setProperty('--mx', `${e.clientX - b.left}px`); el.style.setProperty('--my', `${e.clientY - b.top}px`) }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [])

  useEffect(() => { // floating gold dust
    const cv = dust.current
    const c = cv?.getContext?.('2d')
    if (!cv || !c) return
    const still = prefersReducedMotion()
    let W = 0; let H = 0; let raf = 0
    const size = () => { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight }
    size()
    window.addEventListener('resize', size)
    const P = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.8 + 0.4, v: Math.random() * 0.0007 + 0.0002, a: Math.random() * 0.6 + 0.2 }))
    const draw = () => {
      c.clearRect(0, 0, W, H)
      for (const p of P) { p.y -= p.v; if (p.y < 0) { p.y = 1; p.x = Math.random() } c.fillStyle = `rgba(240,207,134,${p.a})`; c.beginPath(); c.arc(p.x * W, p.y * H, p.r, 0, 6.3); c.fill() }
      if (!still) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', size) }
  }, [])

  const shown = (units ?? []).filter((u) => filter === 'all' || u.typeId === filter)
  const present = settings.unitTypes.filter((t) => (units ?? []).some((u) => u.typeId === t.id))

  return (
    <div ref={root} className="rh">
      <section ref={hero} className="rh-hero" aria-label={ar.home.heroTitle}>
        <div className="rh-hs">
          <div ref={big} className="rh-big" aria-hidden="true">إيجار</div>
          <div className="rh-glow" />
          <canvas ref={dust} id="rh-dust" aria-hidden="true" />
          <img ref={tower} className="rh-tw" src="/design/royal-tower.webp" alt="برج إيجار مصر" width={419} height={800} />
          {picks.map((t, i) => (
            <div key={t.id} className={`rh-sv rh-s${i + 1}`} aria-hidden="true"><small>{TYPE_EN[t.id] ?? ''}</small>{t.plural ?? t.label}</div>
          ))}
          <div className="rh-hi">
            <div className="rh-eb">{BRAND_EN.toUpperCase()} · RENT</div>
            <h1>{ar.home.heroTitle}<span className="dot">.</span></h1>
            <form onSubmit={go} className="rh-sbx" aria-label={ar.nav.search}>
              <select aria-label={ar.home.typeLabel} value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">{ar.home.anyType}</option>
                {settings.unitTypes.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <select aria-label={ar.home.govLabel} value={gov} onChange={(e) => setGov(e.target.value)}>
                <option value="">{ar.home.anyGov}</option>
                {locations.govs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button className="btn-primary" type="submit">{ar.home.searchBtn}</button>
            </form>
          </div>
        </div>
      </section>

      <section ref={srv} className="rh-s lattice" id="services">
        <div className="rh-w rh-split">
          <div className="rh-pinw"><img ref={wave} src="/design/royal-wave.webp" alt="مجسم إيجار مصر" width={411} height={800} loading="lazy" /></div>
          <div>
            <div className="reveal"><h2>{ar.home.whatTitle}</h2><div className="rh-rule" /><p className="rh-sub">{ar.home.whatText}</p></div>
            {settings.unitTypes.map((t, i) => (
              <Link key={t.id} to={`/search?type=${encodeURIComponent(t.id)}`} className="rh-sr">
                <div className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</div>
                <h3>{t.plural ?? t.label}</h3>
                <p>{TYPE_EN[t.id] ? `${TYPE_EN[t.id]} · ` : ''}{ar.home.viewAll}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="rh-s rh-navy" id="list">
        <div className="rh-w">
          <div className="reveal"><h2>{ar.home.latest}<span className="dot">.</span></h2><div className="rh-rule" /></div>
          {units && units.length > 0 && (
            <div className="rh-lt" role="group" aria-label={ar.home.typeLabel}>
              <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>{ar.common.all}</button>
              {present.map((t) => <button key={t.id} type="button" aria-pressed={filter === t.id} onClick={() => setFilter(t.id)}>{t.plural ?? t.label}</button>)}
            </div>
          )}
          {err ? <ErrorBox error={err} /> : units === null ? <Spinner /> : units.length === 0 ? (
            <Empty title={ar.home.latestEmpty} action={<Link to="/dashboard/new" className="btn-primary">{ar.nav.add}</Link>} />
          ) : (
            <>
              <div className="rh-ls grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{shown.map((u) => <UnitCard key={u.id} unit={u} />)}</div>
              <p className="mt-8"><Link to="/search" className="btn-ghost">{ar.home.viewAll}</Link></p>
            </>
          )}
        </div>
      </section>

      <section className="rh-s lattice" id="areas">
        <div className="rh-w">
          <div className="reveal"><h2>{ar.home.popular}<span className="dot">.</span></h2><div className="rh-rule" /></div>
          <div className="rh-ar reveal">
            {popular.map((g) => <Link key={g.id} to={`/rent/${g.slug}`}>{g.name}</Link>)}
          </div>
        </div>
      </section>

      <section className="rh-s rh-fam" id="family">
        <div className="rh-w">
          <div className="reveal"><h2>عائلة إيجار مصر<span className="dot">.</span></h2><div className="rh-rule" /><p className="rh-sub">هوية واحدة بأوجه متعددة، تتعرف عليها من أي علامة.</p></div>
          <div className="rh-gr">
            {FAMILY.map((f) => (
              <div key={f.en} className="rh-cd reveal" onPointerMove={tilt} onPointerLeave={untilt}>
                <div className="im"><img src={f.img} alt="" loading="lazy" /></div>
                <h3>{f.name}</h3><span>{f.en}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rh-s rh-navy lattice" id="how">
        <div className="rh-w">
          <div className="reveal"><h2>{ar.home.howTitle}<span className="dot">.</span></h2><div className="rh-rule" /></div>
          <div role="tablist" className="rh-tabs">
            {(['client', 'adv'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}>{k === 'client' ? ar.home.forClient : ar.home.forAdvertiser}</button>)}
          </div>
          <div ref={tl} className="rh-tl"><i />
            {steps.map((s) => <div key={s.t} className="rh-stp"><h3>{s.t}</h3><p>{s.d}</p></div>)}
          </div>
          {count !== null && count > 0 && (
            <>
              <div className="rh-stats reveal">
                <div><CountUp to={count} /><span>{ar.home.statsUnits}</span></div>
                <div><CountUp to={locations.govs.length} /><span>{ar.home.statsGovs}</span></div>
              </div>
              <p className="mt-3 text-xs text-mute">{ar.home.statsAsOf}</p>
            </>
          )}
        </div>
      </section>

      {posts.length > 0 && (
        <section className="rh-s">
          <div className="rh-w">
            <div className="flex items-end justify-between"><div className="reveal"><h2>{ar.home.blogTitle}<span className="dot">.</span></h2><div className="rh-rule" /></div><a href="/blog" className="text-nile underline">{ar.home.blogAll}</a></div>
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
          </div>
        </section>
      )}

      <section className="rh-s rh-navy" id="faq">
        <div className="rh-w">
          <div className="reveal"><h2>{ar.home.faqTitle}<span className="dot">.</span></h2><div className="rh-rule" /></div>
          <div className="rh-faq reveal">
            {ar.home.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
        </div>
      </section>

      <section className="rh-s rh-cta" id="cta">
        <div className="rh-w">
          <div className="box reveal">
            <img src="/design/royal-logo.webp" alt="شعار إيجار مصر" width={353} height={520} loading="lazy" />
            <h2>{ar.home.ctaTitle}</h2><div className="rh-rule" />
            <p>{ar.home.ctaText}</p>
            <Link to="/dashboard/new" className="btn-primary" style={{ fontSize: 18, padding: '12px 40px' }}>{ar.nav.add}</Link>
          </div>
        </div>
      </section>
    </div>
  )
}

