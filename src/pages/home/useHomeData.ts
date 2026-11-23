import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSettings } from '../../contexts/SettingsContext'
import { activeUnitCount } from '../../lib/stats'
import { latestUnits } from '../../lib/units'
import { isQuotaError } from '../../lib/errors'
import { ar } from '../../i18n/ar'
import type { Unit } from '../../lib/types'

export interface BlogTeaser { slug: string; title: string; description: string; cover: string; coverAlt: string }

const POPULAR = ['القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'الشرقية', 'المنوفية', 'الغربية', 'أسيوط', 'سوهاج', 'جنوب سيناء', 'البحر الأحمر', 'الأقصر']

/** Everything the home page shows that comes from data (real listings, counts, articles, search form). Both home designs use it, so the content is identical. */
export function useHomeData() {
  const { locations, settings, markQuota } = useSettings()
  const nav = useNavigate()
  const [gov, setGov] = useState('')
  const [type, setType] = useState('')
  const [rent, setRent] = useState('')
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [count, setCount] = useState<number | null>(null)
  const [tab, setTab] = useState<'client' | 'adv'>('client')
  const [posts, setPosts] = useState<BlogTeaser[]>([])

  useEffect(() => { // latest articles for internal linking; any failure just means no strip
    if (typeof fetch !== 'function') return
    let alive = true
    fetch('/api/blog-latest').then((r) => (r.ok ? r.json() : { articles: [] })).then((d: { articles?: BlogTeaser[] }) => { if (alive && Array.isArray(d.articles)) setPosts(d.articles) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    latestUnits(8).then((u) => alive && setUnits(u)).catch((e) => { if (isQuotaError(e)) markQuota(); if (alive) setErr(e) })
    // Count of active listings (may include a few whose automatic expiry has passed); cached, see lib/stats.ts.
    activeUnitCount().then((n) => alive && setCount(n)).catch(() => undefined)
    return () => { alive = false }
  }, [markQuota])

  const popular = POPULAR.map((n) => locations.govs.find((g) => g.name === n)).filter((g): g is NonNullable<typeof g> => !!g)

  function go(e: FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (gov) p.set('gov', gov)
    if (type) p.set('type', type)
    if (rent) p.set('rent', rent)
    nav(`/search?${p.toString()}`)
  }

  const steps = tab === 'client' ? ar.home.clientSteps : ar.home.advSteps
  return { locations, settings, gov, setGov, type, setType, rent, setRent, units, err, count, tab, setTab, posts, popular, go, steps }
}

export type HomeData = ReturnType<typeof useHomeData>
