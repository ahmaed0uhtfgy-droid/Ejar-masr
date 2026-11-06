import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Timestamp, type Query, collection, doc, getCountFromServer, getDocs, limit, orderBy, query, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useToast } from '../contexts/ToastContext'
import { apiPost } from '../lib/api'
import { logAudit, notifyUser } from '../lib/audit'
import { db } from '../lib/firebase'
import { addDays, fmtDate, fmtNum } from '../lib/format'
import { usePageMeta } from '../lib/seo'
import { saveLocations, saveSettings } from '../lib/settingsStore'
import { getUnit, mapUnit } from '../lib/units'
import type { AppSettings, LocItem, Option, ReportDoc, ReportStatus, Unit, UserDoc } from '../lib/types'
import { Badge, Empty, ErrorBox, Field, Spinner } from '../components/ui'

type Tab = keyof typeof ar.admin.tabs
const TABS = Object.keys(ar.admin.tabs) as Tab[]
const ts = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)
const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

export default function Admin() {
  usePageMeta({ title: ar.admin.title, noindex: true })
  const [tab, setTab] = useState<Tab>('stats')
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="font-display text-3xl">{ar.admin.title}</h1>
      <div role="tablist" className="mt-5 flex flex-wrap gap-2">
        {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} className={`btn ${tab === k ? 'bg-nile-dark text-white dark:text-paper' : 'border border-line bg-surface'}`}>{ar.admin.tabs[k]}</button>)}
      </div>
      <div className="mt-6">
        {tab === 'stats' && <StatsTab />}
        {tab === 'settings' && <SettingsTab />}
        {tab === 'units' && <UnitsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'reports' && <ReportsTab />}
        {tab === 'locations' && <LocationsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  )
}

function StatsTab() {
  const [s, setS] = useState<{ active: number; all: number; users: number; reports: number } | null>(null)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => {
    const c = (q: Query) => getCountFromServer(q).then((x) => x.data().count)
    Promise.all([
      c(query(collection(db, 'units'), where('status', '==', 'active'))), c(collection(db, 'units')), c(collection(db, 'users')), c(query(collection(db, 'reports'), where('status', '==', 'new'))),
    ]).then(([active, all, users, reports]) => setS({ active, all, users, reports })).catch(setErr)
  }, [])
  if (err) return <ErrorBox error={err} />
  if (!s) return <Spinner />
  const items: [string, number][] = [[ar.admin.statUnits, s.active], [ar.admin.statAll, s.all], [ar.admin.statUsers, s.users], [ar.admin.statReports, s.reports]]
  return <dl className="grid gap-4 sm:grid-cols-4">{items.map(([l, v]) => <div key={l} className="panel p-5"><dd className="font-display text-3xl text-nile">{fmtNum(v)}</dd><dt className="text-mute">{l}</dt></div>)}</dl>
}

function OptionsEditor({ title, items, onChange, plural }: { title: string; items: Option[]; onChange: (v: Option[]) => void; plural?: boolean }) {
  return (
    <fieldset className="panel space-y-2 p-4">
      <legend className="px-1 font-display">{title}</legend>
      {items.map((o, i) => (
        <div key={o.id} className="flex gap-2">
          <input className="field" aria-label={ar.admin.label} value={o.label} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
          {plural && <input className="field" aria-label={ar.admin.plural} value={o.plural ?? ''} onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, plural: e.target.value } : x)))} />}
          <button type="button" className="btn-ghost text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>{ar.common.delete}</button>
        </div>
      ))}
      <button type="button" className="btn-ghost" onClick={() => onChange([...items, { id: newId(plural ? 't' : 'a'), label: '', ...(plural ? { plural: '' } : {}) }])}>{ar.admin.addItem}</button>
    </fieldset>
  )
}

function SettingsTab() {
  const { settings, reload } = useSettings()
  const toast = useToast()
  const [s, setS] = useState<AppSettings>(settings)
  const [busy, setBusy] = useState(false)
  useEffect(() => setS(settings), [settings])

  async function save() {
    if (s.minImages < 0 || s.maxImages < Math.max(1, s.minImages) || s.dailyRevealLimit < 1 || s.defaultAdDays < 0) { toast.err(ar.errors.generic); return }
    if (s.unitTypes.some((t) => !t.label.trim())) { toast.err(ar.common.required); return }
    setBusy(true)
    try {
      const clean: AppSettings = { ...s, unitTypes: s.unitTypes.map((t) => ({ ...t, label: t.label.trim(), plural: (t.plural ?? t.label).trim() })), amenities: s.amenities.filter((a) => a.label.trim()).map((a) => ({ ...a, label: a.label.trim() })) }
      await saveSettings(clean)
      await logAudit('settings.update', 'settings', 'app', { before: settings, after: clean })
      if (clean.defaultAdDays !== settings.defaultAdDays && window.confirm(ar.admin.applyExisting)) await applyDuration(clean.defaultAdDays)
      await reload()
      toast.ok(ar.admin.saved)
    } catch { toast.err(ar.errors.generic) } finally { setBusy(false) }
  }

  /** Re-computes expiry for ads still on the default duration. Processes at most 200 ads per run to protect the daily write quota. */
  async function applyDuration(days: number) {
    const snap = await getDocs(query(collection(db, 'units'), where('durationMode', '==', 'default'), limit(200)))
    for (let i = 0; i < snap.docs.length; i += 100) {
      const b = writeBatch(db)
      for (const d of snap.docs.slice(i, i + 100)) {
        const created = ts(d.data().createdAt) ?? new Date()
        const exp = days > 0 ? Timestamp.fromDate(addDays(created, days)) : null
        b.update(doc(db, 'units', d.id), { expiresAt: exp })
        const nref = doc(collection(db, 'users', String(d.data().ownerId), 'notifications'))
        b.set(nref, { type: 'duration', title: 'تغيّرت مدة إعلانك', body: exp ? `${d.data().title}: الإعلان ساري حتى ${fmtDate(exp.toDate())}` : `${d.data().title}: الإعلان بقى بدون تاريخ انتهاء`, unitId: d.id, read: false, createdAt: Timestamp.now() })
      }
      await b.commit()
    }
    await logAudit('duration.applyAll', 'units', 'default', { days, affected: snap.size })
    toast.ok(`${fmtNum(snap.size)} إعلان اتحدّث${snap.size === 200 ? ' (أول ٢٠٠ — كرر العملية للباقي)' : ''}`)
  }

  const n = (k: 'minImages' | 'maxImages' | 'defaultAdDays' | 'dailyRevealLimit', label: string) => (
    <Field label={label}><input className="field" type="number" min={0} value={s[k]} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} /></Field>
  )
  return (
    <div className="space-y-5">
      <div className="panel grid gap-4 p-5 sm:grid-cols-2">
        {n('minImages', ar.admin.imagesMin)}{n('maxImages', ar.admin.imagesMax)}{n('defaultAdDays', ar.admin.adDays)}{n('dailyRevealLimit', ar.admin.revealLimit)}
        <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={s.trackViews} onChange={(e) => setS({ ...s, trackViews: e.target.checked })} /> {ar.admin.trackViews}</label>
      </div>
      <OptionsEditor title={ar.admin.unitTypes} items={s.unitTypes} plural onChange={(v) => setS({ ...s, unitTypes: v })} />
      <OptionsEditor title={ar.admin.amenities} items={s.amenities} onChange={(v) => setS({ ...s, amenities: v })} />
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>{ar.common.save}</button>
    </div>
  )
}

function UnitsTab() {
  const toast = useToast()
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const load = useCallback(async (id?: string) => {
    setErr(null); setUnits(null)
    try {
      if (id) { const u = await getUnit(id); setUnits(u ? [u] : []); return }
      const s = await getDocs(query(collection(db, 'units'), orderBy('createdAt', 'desc'), limit(50)))
      setUnits(s.docs.map((d) => mapUnit(d.id, d.data())))
    } catch (e) { setErr(e) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function patch(u: Unit, data: Record<string, unknown>, action: string) {
    try {
      await updateDoc(doc(db, 'units', u.id), data)
      await logAudit(action, 'unit', u.id, data)
      setUnits((p) => p?.map((x) => (x.id === u.id ? mapUnit(u.id, { ...unitRaw(x), ...data }) : x)) ?? null)
    } catch { toast.err(ar.errors.generic) }
  }
  async function setDuration(u: Unit, value: string) {
    const exp = value ? Timestamp.fromDate(new Date(`${value}T23:59:59`)) : null
    await patch(u, { expiresAt: exp, durationMode: 'custom' }, 'unit.duration')
    await notifyUser(u.ownerId, 'تغيّرت مدة إعلانك', exp ? `${u.title}: الإعلان ساري حتى ${fmtDate(exp.toDate())}` : `${u.title}: الإعلان بقى بدون تاريخ انتهاء`, u.id).catch(() => undefined)
  }

  return (
    <div>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(q.trim() || undefined) }}>
        <input className="field" placeholder={ar.admin.unitsSearch} value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" />
        <button className="btn-primary" type="submit">{ar.common.search}</button>
      </form>
      {err ? <ErrorBox error={err} onRetry={() => void load()} /> : units === null ? <Spinner /> : units.length === 0 ? <Empty title={ar.common.empty} /> : (
        <ul className="space-y-3">
          {units.map((u) => (
            <li key={u.id} className="panel space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/unit/${u.id}`} className="font-semibold hover:text-nile">{u.title}</Link>
                <Badge tone={u.status === 'active' ? 'nile' : 'plain'}>{u.status}</Badge>
                {u.hiddenByAdmin && <Badge tone="sand">{ar.dash.hiddenByAdmin}</Badge>}
                <code className="text-xs text-mute" dir="ltr">{u.id}</code>
              </div>
              <p className="text-sm text-mute">{u.ownerName} — {ar.admin.until}: {u.expiresAt ? fmtDate(u.expiresAt) : ar.admin.noExpiry}</p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link className="btn-ghost !py-1.5" to={`/dashboard/units/${u.id}/edit`}>{ar.common.edit}</Link>
                {u.status !== 'removed' && !u.hiddenByAdmin && <button type="button" className="btn-ghost !py-1.5" onClick={() => void patch(u, { status: 'hidden', hiddenByAdmin: true }, 'unit.hide')}>{ar.admin.hide}</button>}
                {u.hiddenByAdmin && <button type="button" className="btn-ghost !py-1.5" onClick={() => void patch(u, { status: 'active', hiddenByAdmin: false }, 'unit.unhide')}>{ar.admin.unhide}</button>}
                {u.status !== 'removed' && <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => { if (window.confirm(ar.common.confirm)) void patch(u, { status: 'removed', hiddenByAdmin: true }, 'unit.remove') }}>{ar.admin.remove}</button>}
                <label className="flex items-center gap-1">{ar.admin.setDuration}
                  <input type="date" className="field !w-auto !py-1" onChange={(e) => void setDuration(u, e.target.value)} />
                </label>
                <button type="button" className="btn-ghost !py-1.5" onClick={() => void setDuration(u, '')}>{ar.admin.noExpiry}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Reconstructs raw-ish data from a mapped Unit so optimistic updates can reuse mapUnit.
function unitRaw(u: Unit): Record<string, unknown> {
  return { ...u, createdAt: u.createdAt ? Timestamp.fromDate(u.createdAt) : null, expiresAt: u.expiresAt ? Timestamp.fromDate(u.expiresAt) : null }
}

function UsersTab() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [users, setUsers] = useState<UserDoc[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const load = useCallback(async (email?: string) => {
    setErr(null); setUsers(null)
    try {
      const base = collection(db, 'users')
      const s = await getDocs(email ? query(base, where('email', '==', email), limit(10)) : query(base, orderBy('createdAt', 'desc'), limit(50)))
      setUsers(s.docs.map((d) => { const x = d.data(); return { uid: d.id, displayName: String(x.displayName ?? ''), email: String(x.email ?? ''), role: x.role === 'admin' ? 'admin' : 'user', accountType: x.accountType === 'broker' ? 'broker' : 'owner', banned: !!x.banned, verified: !!x.verified, createdAt: ts(x.createdAt) } }))
    } catch (e) { setErr(e) }
  }, [])
  useEffect(() => { void load() }, [load])

  async function patch(u: UserDoc, data: Partial<UserDoc>, action: string) {
    try {
      await updateDoc(doc(db, 'users', u.uid), data)
      if ('verified' in data) { // keep denormalised badge on the user's ads in sync (first 200 ads)
        const s = await getDocs(query(collection(db, 'units'), where('ownerId', '==', u.uid), limit(200)))
        for (let i = 0; i < s.docs.length; i += 100) { const b = writeBatch(db); s.docs.slice(i, i + 100).forEach((d) => b.update(d.ref, { ownerVerified: data.verified })); await b.commit() }
      }
      await logAudit(action, 'user', u.uid, data)
      setUsers((p) => p?.map((x) => (x.uid === u.uid ? { ...x, ...data } : x)) ?? null)
    } catch { toast.err(ar.errors.generic) }
  }
  async function del(u: UserDoc) {
    if (!window.confirm(ar.common.confirm)) return
    try { await apiPost('/api/admin-delete-user', { uid: u.uid }); setUsers((p) => p?.filter((x) => x.uid !== u.uid) ?? null) } catch { toast.err(ar.errors.generic) }
  }

  return (
    <div>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void load(q.trim() || undefined) }}>
        <input className="field" type="email" dir="ltr" placeholder={ar.admin.usersSearch} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary" type="submit">{ar.common.search}</button>
      </form>
      {err ? <ErrorBox error={err} onRetry={() => void load()} /> : users === null ? <Spinner /> : users.length === 0 ? <Empty title={ar.common.empty} /> : (
        <ul className="space-y-3">
          {users.map((u) => {
            const self = u.uid === me?.uid
            return (
              <li key={u.uid} className="panel space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.displayName}</span><span className="text-sm text-mute" dir="ltr">{u.email}</span>
                  {u.role === 'admin' && <Badge tone="nile">admin</Badge>}{u.banned && <Badge tone="sand">{ar.admin.ban}</Badge>}{u.verified && <Badge tone="sand">{ar.unit.verified}</Badge>}
                  <span className="chip">{u.accountType === 'broker' ? ar.unit.broker : ar.unit.owner}</span>
                </div>
                {!self && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    <button type="button" className="btn-ghost !py-1.5" onClick={() => void patch(u, { banned: !u.banned }, u.banned ? 'user.unban' : 'user.ban')}>{u.banned ? ar.admin.unban : ar.admin.ban}</button>
                    <button type="button" className="btn-ghost !py-1.5" onClick={() => void patch(u, { verified: !u.verified }, 'user.verify')}>{u.verified ? ar.admin.unverify : ar.admin.verify}</button>
                    <button type="button" className="btn-ghost !py-1.5" onClick={() => void patch(u, { role: u.role === 'admin' ? 'user' : 'admin' }, 'user.role')}>{u.role === 'admin' ? ar.admin.makeUser : ar.admin.makeAdmin}</button>
                    <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => void del(u)}>{ar.admin.deleteUser}</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ReportsTab() {
  const toast = useToast()
  const [rows, setRows] = useState<ReportDoc[] | null>(null)
  const [filter, setFilter] = useState<ReportStatus | ''>('')
  const [err, setErr] = useState<unknown>(null)
  const load = useCallback(async () => {
    setErr(null); setRows(null)
    try {
      const base = collection(db, 'reports')
      const s = await getDocs(filter ? query(base, where('status', '==', filter), limit(50)) : query(base, orderBy('createdAt', 'desc'), limit(50)))
      setRows(s.docs.map((d) => { const x = d.data(); return { id: d.id, unitId: x.unitId, unitTitle: String(x.unitTitle ?? ''), reporterId: x.reporterId, reason: String(x.reason ?? ''), note: String(x.note ?? ''), status: x.status as ReportStatus, createdAt: ts(x.createdAt) } }))
    } catch (e) { setErr(e) }
  }, [filter])
  useEffect(() => { void load() }, [load])

  async function setStatus(r: ReportDoc, status: ReportStatus) {
    try { await updateDoc(doc(db, 'reports', r.id), { status }); await logAudit('report.status', 'report', r.id, { status }); setRows((p) => p?.map((x) => (x.id === r.id ? { ...x, status } : x)) ?? null) } catch { toast.err(ar.errors.generic) }
  }
  async function act(r: ReportDoc, kind: 'hide' | 'remove' | 'ban') {
    try {
      const u = await getUnit(r.unitId)
      if (!u) { toast.err(ar.errors.notFound); return }
      if (kind === 'ban') { await updateDoc(doc(db, 'users', u.ownerId), { banned: true }); await logAudit('user.ban', 'user', u.ownerId, { via: 'report', reportId: r.id }) }
      else { await updateDoc(doc(db, 'units', u.id), { status: kind === 'hide' ? 'hidden' : 'removed', hiddenByAdmin: true }); await logAudit(`unit.${kind}`, 'unit', u.id, { via: 'report', reportId: r.id }) }
      await setStatus(r, 'done')
    } catch { toast.err(ar.errors.generic) }
  }
  const rl = (s: ReportStatus) => (s === 'new' ? ar.admin.rNew : s === 'review' ? ar.admin.rReview : ar.admin.rDone)

  return (
    <div>
      <div className="mb-4 flex gap-2">{(['', 'new', 'review', 'done'] as const).map((k) => <button key={k} type="button" aria-pressed={filter === k} className={`btn ${filter === k ? 'bg-nile-dark text-white dark:text-paper' : 'border border-line bg-surface'}`} onClick={() => setFilter(k)}>{k ? rl(k) : ar.common.all}</button>)}</div>
      {err ? <ErrorBox error={err} onRetry={() => void load()} /> : rows === null ? <Spinner /> : rows.length === 0 ? <Empty title={ar.admin.reportsEmpty} /> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="panel space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><Link className="font-semibold hover:text-nile" to={`/unit/${r.unitId}`}>{r.unitTitle || r.unitId}</Link><Badge>{rl(r.status)}</Badge><span className="chip">{r.reason}</span><span className="text-xs text-mute">{fmtDate(r.createdAt)}</span></div>
              {r.note && <p className="text-sm text-mute">{r.note}</p>}
              <div className="flex flex-wrap gap-2 text-sm">
                {r.status !== 'review' && <button type="button" className="btn-ghost !py-1.5" onClick={() => void setStatus(r, 'review')}>{ar.admin.rReview}</button>}
                {r.status !== 'done' && <button type="button" className="btn-ghost !py-1.5" onClick={() => void setStatus(r, 'done')}>{ar.admin.rDone}</button>}
                <button type="button" className="btn-ghost !py-1.5" onClick={() => void act(r, 'hide')}>{ar.admin.hide}</button>
                <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => void act(r, 'remove')}>{ar.admin.remove}</button>
                <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => void act(r, 'ban')}>{ar.admin.ban}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LocationsTab() {
  const { locations, locItems, reload } = useSettings()
  const toast = useToast()
  const [govId, setGovId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [name, setName] = useState('')
  const areas = govId ? locations.areasByGov[govId] ?? [] : []
  const locs = areaId ? locations.localitiesByArea[areaId] ?? [] : []

  async function commit(next: LocItem[], action: string, target: string) {
    try { await saveLocations(next); await logAudit(action, 'location', target); await reload(); setName('') } catch { toast.err(ar.errors.generic) }
  }
  const upsert = (it: LocItem) => [...locItems.filter((x) => x.id !== it.id), it]
  const add = (level: 1 | 2 | 3, parentId: string | null) => { if (name.trim()) void commit(upsert({ id: newId(`x${level}`), level, parentId, name: name.trim() }), 'location.add', name) }
  const rename = (it: LocItem) => { const n = window.prompt(ar.admin.label, it.name); if (n?.trim()) void commit(upsert({ ...it, name: n.trim() }), 'location.rename', it.id) }
  const del = (it: LocItem) => { if (window.confirm(ar.common.confirm)) void commit(upsert({ ...it, deleted: true }), 'location.delete', it.id) }

  const row = (it: LocItem, onOpen?: () => void) => (
    <li key={it.id} className="flex items-center gap-2 py-1">
      <button type="button" className="flex-1 text-start hover:text-nile" onClick={onOpen}>{it.name}</button>
      <button type="button" className="text-sm underline" onClick={() => rename(it)}>{ar.common.edit}</button>
      <button type="button" className="text-sm text-danger underline" onClick={() => del(it)}>{ar.common.delete}</button>
    </li>
  )
  return (
    <div className="space-y-4">
      <p className="text-sm text-mute">{ar.admin.locationsHint}</p>
      <div className="grid gap-4 md:grid-cols-3">
        <section className="panel p-4"><h2 className="font-display">{ar.search.gov}</h2>
          <ul className="max-h-72 divide-y divide-line overflow-auto">{locations.govs.map((g) => row({ id: g.id, level: 1, parentId: null, name: g.name }, () => { setGovId(g.id); setAreaId('') }))}</ul>
        </section>
        <section className="panel p-4"><h2 className="font-display">{ar.search.area}</h2>
          <ul className="max-h-72 divide-y divide-line overflow-auto">{areas.map((a) => row({ id: a.id, level: 2, parentId: govId, name: a.name }, () => setAreaId(a.id)))}</ul>
        </section>
        <section className="panel p-4"><h2 className="font-display">{ar.form.locality}</h2>
          <ul className="max-h-72 divide-y divide-line overflow-auto">{locs.map((l) => row({ id: l.id, level: 3, parentId: areaId, name: l.name }))}</ul>
        </section>
      </div>
      <div className="panel flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[200px] flex-1"><Field label={ar.admin.label}><input className="field" value={name} onChange={(e) => setName(e.target.value)} /></Field></div>
        <button type="button" className="btn-ghost" onClick={() => add(1, null)}>+ {ar.search.gov}</button>
        <button type="button" className="btn-ghost" disabled={!govId} onClick={() => add(2, govId)}>+ {ar.search.area}</button>
        <button type="button" className="btn-ghost" disabled={!areaId} onClick={() => add(3, areaId)}>+ {ar.form.locality}</button>
      </div>
    </div>
  )
}

function AuditTab() {
  const [rows, setRows] = useState<{ id: string; action: string; target: string; admin: string; at: Date | null }[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => {
    getDocs(query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(50)))
      .then((s) => setRows(s.docs.map((d) => { const x = d.data(); return { id: d.id, action: String(x.action), target: `${x.targetType}:${x.targetId}`, admin: String(x.adminEmail ?? ''), at: ts(x.createdAt) } })))
      .catch(setErr)
  }, [])
  if (err) return <ErrorBox error={err} />
  if (!rows) return <Spinner />
  if (!rows.length) return <Empty title={ar.admin.auditEmpty} />
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-start text-sm">
      <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-line"><td className="p-2">{fmtDate(r.at)}</td><td className="p-2" dir="ltr">{r.action}</td><td className="p-2" dir="ltr">{r.target}</td><td className="p-2" dir="ltr">{r.admin}</td></tr>)}</tbody>
    </table></div>
  )
}
