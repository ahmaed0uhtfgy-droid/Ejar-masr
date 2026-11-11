import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Timestamp, collection, deleteDoc, doc, getDocs, limit, orderBy, query, updateDoc } from 'firebase/firestore'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { db } from '../lib/firebase'
import { fmtDate } from '../lib/format'
import { usePageMeta } from '../lib/seo'
import { getUnits } from '../lib/units'
import type { AccountType, AppNotification, Unit } from '../lib/types'
import { UnitCard } from '../components/UnitCard'
import { Empty, ErrorBox, Field, Spinner } from '../components/ui'
import { PayoutForm } from '../components/PayoutForm'
import { rt } from '../i18n/rent'

type Tab = 'favorites' | 'saved' | 'notifications' | 'profile' | 'payout'
interface Saved { id: string; query: string }

export default function Account() {
  usePageMeta({ title: ar.account.title, noindex: true })
  const { user, profile, favorites, refreshProfile } = useAuth()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('favorites')
  const [favUnits, setFavUnits] = useState<Unit[] | null>(null)
  const [saved, setSaved] = useState<Saved[] | null>(null)
  const [notifs, setNotifs] = useState<AppNotification[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [name, setName] = useState(profile?.displayName ?? '')
  const [type, setType] = useState<AccountType>(profile?.accountType ?? 'owner')

  const load = useCallback(async () => {
    if (!user) return
    setErr(null)
    try {
      if (tab === 'favorites') setFavUnits(await getUnits([...favorites]))
      if (tab === 'saved') {
        const s = await getDocs(collection(db, 'users', user.uid, 'savedSearches'))
        setSaved(s.docs.map((d) => ({ id: d.id, query: String(d.data().query ?? '') })))
      }
      if (tab === 'notifications') {
        const s = await getDocs(query(collection(db, 'users', user.uid, 'notifications'), orderBy('createdAt', 'desc'), limit(50)))
        setNotifs(s.docs.map((d) => {
          const x = d.data()
          return { id: d.id, type: x.type, title: String(x.title ?? ''), body: String(x.body ?? ''), unitId: x.unitId ?? null, read: !!x.read, createdAt: x.createdAt instanceof Timestamp ? x.createdAt.toDate() : null }
        }))
      }
    } catch (e) { setErr(e) }
  }, [tab, user, favorites])

  useEffect(() => { void load() }, [load])

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    try {
      await updateDoc(doc(db, 'users', user.uid), { displayName: name.trim().slice(0, 60), accountType: type })
      await refreshProfile()
      toast.ok(ar.account.profileSaved)
    } catch { toast.err(ar.errors.generic) }
  }

  const tabs: [Tab, string][] = [['favorites', ar.account.favorites], ['saved', ar.account.saved], ['notifications', ar.account.notifications], ['profile', ar.account.profile], ['payout', rt.payoutTab]]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">{ar.account.title}</h1>
      <div role="tablist" className="mt-5 flex flex-wrap gap-2">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`btn ${tab === k ? 'bg-nile-dark text-white dark:text-paper' : 'border border-line bg-surface'}`}>{label}</button>
        ))}
      </div>
      <div className="mt-6">
        {err ? <ErrorBox error={err} onRetry={() => void load()} /> : (
          <>
            {tab === 'favorites' && (favUnits === null ? <Spinner /> : favUnits.length === 0 ? <Empty title={ar.account.favEmpty} /> : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{favUnits.map((u) => <UnitCard key={u.id} unit={u} />)}</div>
            ))}
            {tab === 'saved' && (saved === null ? <Spinner /> : saved.length === 0 ? <Empty title={ar.account.savedEmpty} /> : (
              <ul className="space-y-3">
                {saved.map((s) => (
                  <li key={s.id} className="panel flex items-center justify-between gap-3 p-4">
                    <Link className="text-nile underline" to={`/search?${s.query}`}>{ar.account.open}</Link>
                    <code className="truncate text-xs text-mute" dir="ltr">{s.query || '(all)'}</code>
                    <button type="button" className="text-danger underline" onClick={() => { deleteDoc(doc(db, 'users', user!.uid, 'savedSearches', s.id)).then(() => setSaved((p) => p?.filter((x) => x.id !== s.id) ?? null)).catch(() => toast.err(ar.errors.generic)) }}>{ar.common.delete}</button>
                  </li>
                ))}
              </ul>
            ))}
            {tab === 'notifications' && (notifs === null ? <Spinner /> : notifs.length === 0 ? <Empty title={ar.account.notifEmpty} /> : (
              <ul className="space-y-3">
                {notifs.map((n) => (
                  <li key={n.id} className={`panel p-4 ${n.read ? 'opacity-70' : 'border-nile'}`}>
                    <p className="font-medium">{n.title}</p>
                    <p className="text-mute">{n.body}</p>
                    <p className="mt-1 flex gap-3 text-xs text-mute">
                      <span>{fmtDate(n.createdAt)}</span>
                      {n.unitId && <Link className="text-nile underline" to={`/unit/${n.unitId}`}>{ar.common.search}</Link>}
                      {!n.read && <button type="button" className="underline" onClick={() => { updateDoc(doc(db, 'users', user!.uid, 'notifications', n.id), { read: true }).then(() => setNotifs((p) => p?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? null)).catch(() => toast.err(ar.errors.generic)) }}>{ar.account.markRead}</button>}
                    </p>
                  </li>
                ))}
              </ul>
            ))}
            {tab === 'payout' && <PayoutForm />}
            {tab === 'profile' && (
              <form className="panel max-w-md space-y-4 p-5" onSubmit={(e) => void saveProfile(e)}>
                <Field label={ar.auth.name}><input className="field" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></Field>
                <Field label={ar.account.accountType}>
                  <select className="field" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                    <option value="owner">{ar.auth.typeOwner}</option>
                    <option value="broker">{ar.auth.typeBroker}</option>
                  </select>
                </Field>
                <button className="btn-primary" type="submit">{ar.account.saveProfile}</button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
