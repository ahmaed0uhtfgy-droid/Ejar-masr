import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addDoc, collection, getDocs, serverTimestamp } from 'firebase/firestore'
import type { QueryDocumentSnapshot } from 'firebase/firestore'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { db } from '../lib/firebase'
import { usePageMeta } from '../lib/seo'
import { filtersToParams, paramsToFilters, searchUnits } from '../lib/units'
import { isQuotaError } from '../lib/errors'
import type { SearchFilters, SortKey, Unit } from '../lib/types'
import { FiltersPanel } from '../components/FiltersPanel'
import { UnitCard } from '../components/UnitCard'
import { Empty, ErrorBox, Spinner } from '../components/ui'

const MapView = lazy(() => import('../components/MapView'))
const MAX_SAVED = 5

export default function Search() {
  usePageMeta({ title: ar.search.title, description: ar.search.description, path: '/search' })
  const [params, setParams] = useSearchParams()
  const { filters, sort, view } = useMemo(() => paramsToFilters(params), [params])
  const { user, banned } = useAuth()
  const { markQuota } = useSettings()
  const toast = useToast()
  const [items, setItems] = useState<Unit[]>([])
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<unknown>(null)
  const [showFilters, setShowFilters] = useState(false)
  const reqId = useRef(0)

  const load = useCallback(async (reset: boolean, cur: QueryDocumentSnapshot | null) => {
    const id = ++reqId.current
    setLoading(true); setErr(null)
    try {
      const page = await searchUnits(filters, sort, reset ? null : cur)
      if (id !== reqId.current) return
      setItems((prev) => (reset ? page.items : [...prev, ...page.items]))
      setCursor(page.cursor); setDone(page.done)
    } catch (e) {
      if (id !== reqId.current) return
      if (isQuotaError(e)) markQuota()
      setErr(e)
    } finally { if (id === reqId.current) setLoading(false) }
  }, [filters, sort, markQuota])

  useEffect(() => { void load(true, null) }, [load])

  const update = (f: SearchFilters, s: SortKey = sort, v: 'list' | 'map' = view) => setParams(filtersToParams(f, s, v), { replace: true })

  async function saveSearch() {
    if (!user) { toast.err(ar.search.saveLogin); return }
    try {
      const existing = await getDocs(collection(db, 'users', user.uid, 'savedSearches'))
      if (existing.size >= MAX_SAVED) { toast.err(ar.search.savedLimit); return }
      await addDoc(collection(db, 'users', user.uid, 'savedSearches'), { query: params.toString(), createdAt: serverTimestamp(), lastCheckedAt: serverTimestamp() })
      toast.ok(ar.search.saved)
    } catch { toast.err(ar.errors.generic) }
  }

  const mapUnits = items.filter((u) => u.lat != null)

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">{ar.search.title}</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <aside className="lg:col-span-1">
          <button type="button" className="btn-ghost mb-3 w-full lg:hidden" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>{ar.search.filters}</button>
          <div className={`${showFilters ? 'block' : 'hidden'} lg:block`}>
            <FiltersPanel filters={filters} onChange={(f) => update(f)} onReset={() => setParams({}, { replace: true })} />
            <button type="button" className="btn-ghost mt-3 w-full" disabled={banned} onClick={() => void saveSearch()}>{ar.search.save}</button>
          </div>
        </aside>
        <section className="lg:col-span-3" aria-live="polite">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">{ar.search.sort}
              <select className="field !w-auto" value={sort} onChange={(e) => update(filters, e.target.value as SortKey)}>
                <option value="newest">{ar.search.newest}</option>
                <option value="priceAsc">{ar.search.priceAsc}</option>
                <option value="priceDesc">{ar.search.priceDesc}</option>
              </select>
            </label>
            <div className="ms-auto inline-flex rounded-field border border-line p-1" role="group">
              {(['list', 'map'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} className={`rounded-md px-3 py-1 text-sm ${view === v ? 'bg-nile-dark text-white dark:text-paper' : ''}`} onClick={() => update(filters, sort, v)}>
                  {v === 'list' ? ar.search.list : ar.search.map}
                </button>
              ))}
            </div>
          </div>

          {err ? <ErrorBox error={err} onRetry={() => void load(true, null)} /> : loading && items.length === 0 ? <Spinner /> : items.length === 0 ? (
            <Empty title={ar.search.noResults} hint={ar.search.noResultsHint} />
          ) : view === 'map' ? (
            <>
              <p className="mb-2 text-sm text-mute">{ar.search.mapNote} ({mapUnits.length}/{items.length})</p>
              <Suspense fallback={<Spinner />}><MapView units={mapUnits} /></Suspense>
            </>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{items.map((u) => <UnitCard key={u.id} unit={u} />)}</div>
          )}

          {!err && !done && items.length > 0 && (
            <div className="mt-6 text-center">
              <button type="button" className="btn-ghost" disabled={loading} onClick={() => void load(false, cursor)}>{loading ? ar.search.loadingMore : ar.common.more}</button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
