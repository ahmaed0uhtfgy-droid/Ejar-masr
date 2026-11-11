import { useCallback, useEffect, useState } from 'react'
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { addDaysYmd } from '../../functions/_lib/rent'
import { useToast } from '../contexts/ToastContext'
import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { ApiError, apiPost } from '../lib/api'
import { db } from '../lib/firebase'
import { fmtDate, fmtNum } from '../lib/format'
import { PAY_PUBLIC_DEFAULTS, fmtYmd, loadPaySettings, loadPolicy, mapLease, mapPayment, resetPaySettings, resetPolicy, todayYmd, type PayPublicSettings } from '../lib/rentals'
import { DEFAULT_SECTIONS, POLICY_TOKENS, type Section } from '../i18n/policy'
import { usePageMeta } from '../lib/seo'
import type { Lease, Payment } from '../lib/types'
import { Badge, Empty, ErrorBox, Field, Spinner } from '../components/ui'

type Tab = 'settings' | 'policy' | 'payouts' | 'held' | 'deposits' | 'leases' | 'sweep'
interface Dest { method: string; holder: string; account: string }
interface FullSettings extends PayPublicSettings { moveInReminderDays: number; maxOpenRequests: number }
const cur = ar.common.currency

export default function AdminPayments() {
  usePageMeta({ title: rt.adminPayments, noindex: true })
  const [tab, setTab] = useState<Tab>('settings')
  const tabs: [Tab, string][] = [['settings', rt.tabSettings], ['policy', rt.tabPolicy], ['payouts', rt.tabPayouts], ['held', rt.tabHeld], ['deposits', rt.tabDeposits], ['leases', rt.tabLeases], ['sweep', rt.tabSweep]]
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="font-display text-3xl">{rt.adminPayments}</h1>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} type="button" className={tab === k ? 'btn-primary !py-1.5' : 'btn-ghost !py-1.5'} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div className="mt-6">
        {tab === 'settings' && <SettingsTab />}
        {tab === 'policy' && <PolicyTab />}
        {tab === 'payouts' && <PaymentsByPayout status="pending" />}
        {tab === 'held' && <PaymentsByPayout status="held" />}
        {tab === 'deposits' && <DepositsTab />}
        {tab === 'leases' && <LeasesTab />}
        {tab === 'sweep' && <SweepTab />}
      </div>
    </div>
  )
}

function SettingsTab() {
  const toast = useToast()
  const [s, setS] = useState<FullSettings | null>(null)
  useEffect(() => {
    resetPaySettings()
    void Promise.all([loadPaySettings(), getDoc(doc(db, 'settings', 'payments'))]).then(([p, d]) => setS({ ...PAY_PUBLIC_DEFAULTS, ...p, moveInReminderDays: Number(d.data()?.moveInReminderDays ?? 14), maxOpenRequests: Number(d.data()?.maxOpenRequests ?? 5) }))
  }, [])
  if (!s) return <Spinner />
  const num = (k: keyof FullSettings, v: string) => setS({ ...s, [k]: Number(v) })
  async function save(e: React.FormEvent) {
    e.preventDefault()
    try { await setDoc(doc(db, 'settings', 'payments'), { ...s, updatedAt: serverTimestamp() }); resetPaySettings(); toast.ok(rt.sSaved) } catch { toast.err(ar.errors.generic) }
  }
  const nf = (k: keyof FullSettings, label: string, min: number, max: number, step = 1) => (
    <Field label={label}><input className="field" type="number" min={min} max={max} step={step} value={Number(s[k])} onChange={(e) => num(k, e.target.value)} /></Field>
  )
  return (
    <form className="panel grid max-w-2xl gap-4 p-5 md:grid-cols-2" onSubmit={(e) => void save(e)}>
      <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" checked={s.paymentsEnabled} onChange={(e) => setS({ ...s, paymentsEnabled: e.target.checked })} /> {rt.sPaymentsEnabled}</label>
      {nf('platformFeePercent', rt.sFee, 0, 30, 0.5)}
      {nf('depositClaimDays', rt.sClaimDays, 0, 30)}
      {nf('maxLeaseMonths', rt.sMaxMonths, 1, 60)}
      {nf('defaultReminderDays', rt.sReminder, 1, 30)}
      {nf('maxOpenRequests', rt.sMaxOpen, 1, 20)}
      {nf('moveInReminderDays', rt.sMoveIn, 1, 60)}
      <Field label={rt.sFeePayer}><select className="field" value={s.feePayer} onChange={(e) => setS({ ...s, feePayer: e.target.value as FullSettings['feePayer'] })}>{(Object.keys(rt.feePayers) as (keyof typeof rt.feePayers)[]).map((k) => <option key={k} value={k}>{rt.feePayers[k]}</option>)}</select></Field>
      {nf('firstPayoutCapEgp', rt.sFirstCap, 0, 10000000, 1000)}
      <Field label={rt.sCancelMode}><select className="field" value={s.cancelAfterPayment} onChange={(e) => setS({ ...s, cancelAfterPayment: e.target.value as FullSettings['cancelAfterPayment'] })}>{(Object.keys(rt.cancelModes) as (keyof typeof rt.cancelModes)[]).map((k) => <option key={k} value={k}>{rt.cancelModes[k]}</option>)}</select></Field>
      {nf('cancelFeePercent', rt.sCancelFee, 0, 100, 0.5)}
      {nf('payoutDays', rt.sPayoutDays, 0, 60)}
      {nf('refundDays', rt.sRefundDays, 1, 90)}
      {nf('disputeDays', rt.sDisputeDays, 1, 60)}
      <fieldset className="md:col-span-2"><legend className="label">{rt.sCycles}</legend>
        <div className="flex flex-wrap gap-4">
          {[1, 3, 6, 12].map((c) => (
            <label key={c} className="flex items-center gap-2"><input type="checkbox" checked={s.cycles.includes(c)} onChange={(e) => setS({ ...s, cycles: e.target.checked ? [...s.cycles, c].sort((a, b) => a - b) : s.cycles.filter((x) => x !== c) })} />{rt.cycleLabel(c)}</label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-mute md:col-span-2">{rt.sFeeNote}</p>
      <div className="md:col-span-2"><button className="btn-primary" type="submit" disabled={s.cycles.length === 0}>{ar.common.save}</button></div>
    </form>
  )
}

/** status "pending": released to owners and waiting for the admin transfer. status "held": escrow, only the tenant's confirmation releases it. */
function PaymentsByPayout({ status }: { status: 'pending' | 'held' }) {
  const toast = useToast()
  const [rows, setRows] = useState<Payment[] | null>(null)
  const [leases, setLeases] = useState<Record<string, Lease>>({})
  const [dest, setDest] = useState<Record<string, Dest | null>>({})
  const [paidOwners, setPaidOwners] = useState<Set<string>>(new Set())
  const [cap, setCap] = useState(0)
  const [cancelFee, setCancelFee] = useState(0)
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [amts, setAmts] = useState<Record<string, string>>({})
  const [err, setErr] = useState<unknown>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [s, ls, ps] = await Promise.all([
        getDocs(query(collection(db, 'payments'), where('payoutStatus', '==', status), limit(300))),
        getDocs(query(collection(db, 'leases'), limit(500))),
        loadPaySettings(),
      ])
      const list = s.docs.map((d) => mapPayment(d.id, d.data())).sort((a, b) => (a.paidAt?.getTime() ?? 0) - (b.paidAt?.getTime() ?? 0))
      setRows(list)
      setCap(ps.firstPayoutCapEgp); setCancelFee(ps.cancelFeePercent)
      setLeases(Object.fromEntries(ls.docs.map((d) => [d.id, mapLease(d.id, d.data())])))
      if (status === 'pending') {
        const owners = [...new Set(list.map((p) => p.ownerId))]
        const entries = await Promise.all(owners.map(async (o) => [o, (await getDoc(doc(db, 'users', o, 'payout', 'main')).catch(() => null))] as const))
        setDest(Object.fromEntries(entries.map(([o, d]) => [o, d?.exists() ? (d.data() as Dest) : null])))
        const done = await getDocs(query(collection(db, 'payments'), where('payoutStatus', '==', 'paid'), limit(500)))
        setPaidOwners(new Set(done.docs.map((d) => String(d.data().ownerId))))
      }
    } catch (e) { setErr(e) }
  }, [status])
  useEffect(() => { void load() }, [load])

  async function markPaid(p: Payment) {
    try {
      await updateDoc(doc(db, 'payments', p.id), { payoutStatus: 'paid', payoutAt: serverTimestamp(), payoutRef: (refs[p.id] ?? '').slice(0, 60) })
      setRows((r) => r?.filter((x) => x.id !== p.id) ?? null)
    } catch { toast.err(ar.errors.generic) }
  }
  async function recordRefund(p: Payment, suggested: number) {
    if (!window.confirm(rt.confirmRefund)) return
    try {
      await apiPost('/api/refund-record', { paymentId: p.id, amount: Number(amts[p.id] ?? suggested), note: refs[p.id] ?? '' })
      setRows((r) => r?.filter((x) => x.id !== p.id) ?? null)
    } catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }
  if (err) return <ErrorBox error={err} onRetry={() => void load()} />
  if (rows === null) return <Spinner />
  if (!rows.length) return <Empty title={status === 'held' ? rt.heldEmpty : rt.adminEmpty} />
  return (
    <>
      {status === 'held' && <p className="mb-3 text-sm text-mute">{rt.refundHint}</p>}
      <ul className="space-y-3">
        {rows.map((p) => {
          const d = dest[p.ownerId], l = leases[p.leaseId]
          const overCap = status === 'pending' && cap > 0 && !paidOwners.has(p.ownerId) && p.netCents / 100 > cap
          const suggested = l?.cancelRequestedAt ? Math.round((p.amount * 100) * (1 - cancelFee / 100)) / 100 : p.amount
          return (
            <li key={p.id} className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">{l?.unitTitle} · {rt.net}: {fmtNum(p.netCents / 100)} {cur} <span className="text-mute">({rt.fee}: {fmtNum(p.feeCents / 100)})</span></p>
                <p className="text-mute">{fmtDate(p.paidAt)} · {rt.owner}: {l?.ownerName} · {rt.tenant}: {l?.tenantName}</p>
                {status === 'held' && l?.moveInIssue && <p className="text-danger">{rt.issue}</p>}
                {status === 'held' && l?.cancelRequestedAt && <p className="text-sand">{rt.cancelRequested} · {rt.refundSuggest}: {fmtNum(suggested)} {cur}</p>}
                {overCap && <p className="text-danger">{rt.capWarn}</p>}
                {status === 'pending' && (d ? <p>{rt.methods[d.method as keyof typeof rt.methods] ?? d.method} · {d.holder} · <bdi dir="ltr">{d.account}</bdi></p> : <p className="text-danger">{rt.noPayout}</p>)}
              </div>
              {status === 'held' && <input className="field md:w-32" type="number" min={0} max={p.amount} aria-label={rt.refundAmount} placeholder={rt.refundAmount} value={amts[p.id] ?? String(suggested)} onChange={(e) => setAmts((a) => ({ ...a, [p.id]: e.target.value }))} />}
              <input className="field md:w-44" placeholder={status === 'pending' ? rt.ref : rt.refundNote} value={refs[p.id] ?? ''} onChange={(e) => setRefs((r) => ({ ...r, [p.id]: e.target.value }))} />
              {status === 'pending'
                ? <button type="button" className="btn-primary" onClick={() => void markPaid(p)}>{rt.markPaid}</button>
                : <button type="button" className="btn-ghost" onClick={() => void recordRefund(p, suggested)}>{rt.refundRecord}</button>}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function useLeases() {
  const [leases, setLeases] = useState<Lease[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const load = useCallback(async () => {
    setErr(null)
    try { setLeases((await getDocs(query(collection(db, 'leases'), limit(500)))).docs.map((d) => mapLease(d.id, d.data())).sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))) } catch (e) { setErr(e) }
  }, [])
  useEffect(() => { void load() }, [load])
  return { leases, err, load }
}

function DepositsTab() {
  const toast = useToast()
  const { leases, err, load } = useLeases()
  const [amt, setAmt] = useState<Record<string, string>>({})
  const [refs, setRefs] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [claimDays, setClaimDays] = useState(3)
  useEffect(() => { void loadPaySettings().then((s) => setClaimDays(s.depositClaimDays)) }, [])
  const today = todayYmd()
  const call = async (leaseId: string, action: string, extra: Record<string, unknown> = {}) => {
    try { await apiPost('/api/deposit-action', { leaseId, action, ...extra }); await load() } catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }
  if (err) return <ErrorBox error={err} onRetry={() => void load()} />
  if (!leases) return <Spinner />
  const ready = (l: Lease) => l.depositStatus === 'held' && (l.status === 'ended' || l.endDate < today) && today > (l.depositClaimUntil || addDaysYmd(l.endDate, l.depositMode === 'held-claim' ? claimDays : 0))
  const waiting = leases.filter((l) => l.depositStatus === 'claimed')
  const disputes = leases.filter((l) => l.depositStatus === 'disputed')
  const rdy = leases.filter(ready)
  const transfers = leases.filter((l) => l.depositStatus === 'settled' && l.depositTransfer === 'pending')
  const Row = ({ l, children }: { l: Lease; children?: React.ReactNode }) => (
    <li className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center">
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{l.unitTitle} · {rt.deposit}: {fmtNum(l.depositCents / 100)} {cur}</p>
        <p className="text-mute">{rt.owner}: {l.ownerName} · {rt.tenant}: {l.tenantName} · {fmtYmd(l.endDate)}</p>
        {(l.depositStatus === 'claimed' || l.depositStatus === 'disputed') && <p>{rt.claimAmount}: {fmtNum(l.claimCents / 100)} — {l.claimReason}</p>}
      </div>
      {children}
    </li>
  )
  const fullRefund = (l: Lease) => <button type="button" className="btn-primary !py-1.5" onClick={() => void call(l.id, 'settle', { amount: 0 })}>{rt.depRefundAll}</button>
  const byNote = (l: Lease) => (
    <div className="flex flex-wrap items-center gap-2">
      <input className="field !w-28" type="number" min={0} max={l.depositCents / 100} placeholder={rt.depToOwnerLabel} title={rt.depToOwnerLabel} value={amt[l.id] ?? '0'} onChange={(e) => setAmt((a) => ({ ...a, [l.id]: e.target.value }))} />
      <input className="field !w-56" placeholder={rt.depSettleNote} value={notes[l.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [l.id]: e.target.value }))} />
      <button type="button" className="btn-primary !py-1.5" onClick={() => void call(l.id, 'settle', { amount: Number(amt[l.id] ?? 0), note: notes[l.id] ?? '' })}>{rt.depSettle}</button>
    </div>
  )
  const list = (items: Lease[], extra?: (l: Lease) => React.ReactNode) => items.length ? <ul className="space-y-3">{items.map((l) => <Row key={l.id} l={l}>{extra?.(l)}</Row>)}</ul> : <Empty title={rt.depEmpty} />
  return (
    <div className="space-y-6">
      <p className="text-sm text-mute">{rt.depDisputeNote}</p>
      <section><h2 className="mb-2 font-display text-xl">{rt.depAdminClaims}</h2>{list(waiting)}</section>
      <section><h2 className="mb-2 font-display text-xl">{rt.depAdminDisputes}</h2>{list(disputes, byNote)}</section>
      <section><h2 className="mb-2 font-display text-xl">{rt.depReady}</h2>{list(rdy, fullRefund)}</section>
      <section><h2 className="mb-2 font-display text-xl">{rt.depTransfers}</h2>{transfers.length ? (
        <ul className="space-y-3">{transfers.map((l) => (
          <Row key={l.id} l={l}>
            <div className="flex flex-wrap items-center gap-2 text-sm"><span>{rt.depBackToYou(l.depositToTenantCents / 100)} · {rt.depToOwner(l.depositToOwnerCents / 100)}</span>
              <input className="field !w-40" placeholder={rt.ref} value={refs[l.id] ?? ''} onChange={(e) => setRefs((r) => ({ ...r, [l.id]: e.target.value }))} />
              <button type="button" className="btn-primary !py-1.5" onClick={() => void call(l.id, 'transferred', { ref: refs[l.id] ?? '' })}>{rt.depMarkDone}</button></div>
          </Row>))}</ul>) : <Empty title={rt.depEmpty} />}</section>
    </div>
  )
}

function LeasesTab() {
  const toast = useToast()
  const { leases, err, load } = useLeases()
  if (err) return <ErrorBox error={err} onRetry={() => void load()} />
  if (!leases) return <Spinner />
  if (!leases.length) return <Empty title={rt.empty} />
  async function end(l: Lease) {
    if (!window.confirm(rt.confirmEnd)) return
    try { await apiPost('/api/lease-respond', { leaseId: l.id, action: 'end' }); await load() } catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) }
  }
  return (
    <ul className="space-y-3">
      {leases.map((l) => (
        <li key={l.id} className="panel flex flex-wrap items-center gap-3 p-4 text-sm">
          <div className="min-w-0 flex-1"><p className="font-medium">{l.unitTitle}</p><p className="text-mute">{rt.owner}: {l.ownerName} · {rt.tenant}: {l.tenantName} · {fmtYmd(l.startDate)} → {fmtYmd(l.endDate)}</p></div>
          {l.moveInIssue && !l.moveInConfirmedAt && <Badge tone="sand">{rt.issue}</Badge>}
          {l.cancelRequestedAt && l.status === 'active' && <Badge tone="sand">{rt.cancelRequested}</Badge>}
          <Badge tone={l.status === 'active' ? 'nile' : 'plain'}>{rt.status[l.status]}</Badge>
          {l.status === 'active' && <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => void end(l)}>{rt.endByAdmin}</button>}
        </li>
      ))}
    </ul>
  )
}

function SweepTab() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<string[]>([])
  async function run() {
    setBusy(true); setLog([])
    try {
      for (let i = 0; i < 30; i++) {
        const r = await apiPost<{ more: boolean; ended: number; moveInReminders: number; installmentReminders: number; emails: number }>('/api/sweep', {})
        setLog((l) => [...l, `${r.ended} / ${r.moveInReminders} / ${r.installmentReminders} / ${r.emails}`])
        if (!r.more) break
      }
      toast.ok(rt.sweepDone)
    } catch (e) { toast.err(e instanceof ApiError ? e.message : ar.errors.generic) } finally { setBusy(false) }
  }
  return (
    <div className="panel max-w-xl space-y-3 p-5">
      <p className="text-sm text-mute">{rt.sweepHint}</p>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void run()}>{busy ? ar.common.loading : rt.sweepNow}</button>
      {log.length > 0 && <pre dir="ltr" className="text-xs text-mute">ended / move-in / installments / emails{'\n'}{log.join('\n')}</pre>}
    </div>
  )
}

function PolicyTab() {
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(true)
  const [draft, setDraft] = useState(true)
  const [secs, setSecs] = useState<{ h: string; p: string; ul: string }[]>([])
  const toRows = (x: Section[]) => x.map((a) => ({ h: a.h, p: (a.p ?? []).join('\n'), ul: (a.ul ?? []).join('\n') }))
  useEffect(() => {
    resetPolicy()
    void loadPolicy().then((p) => { setVisible(p.visible); setDraft(p.draft); setSecs(toRows(p.sections ?? DEFAULT_SECTIONS)); setLoaded(true) })
  }, [])
  if (!loaded) return <Spinner />
  const upd = (i: number, k: 'h' | 'p' | 'ul', v: string) => setSecs((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  const move = (i: number, d: number) => setSecs((a) => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b })
  async function save() {
    const sections = secs.filter((x) => x.h.trim()).map((x) => {
      const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean)
      const o: Section = { h: x.h.trim() }
      if (lines(x.p).length) o.p = lines(x.p)
      if (lines(x.ul).length) o.ul = lines(x.ul)
      return o
    })
    try {
      await setDoc(doc(db, 'settings', 'policyPage'), { visible, draft, sections, version: todayYmd(), updatedAt: serverTimestamp() })
      resetPolicy(); toast.ok(rt.polSaved)
    } catch { toast.err(ar.errors.generic) }
  }
  return (
    <div className="space-y-4">
      <div className="panel space-y-2 p-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} /> {rt.polVisible}</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> {rt.polDraft}</label>
        <p className="text-xs text-mute">{rt.polHint}</p>
        <p className="text-xs text-mute" dir="rtl">{rt.polTokens}: {Object.entries(POLICY_TOKENS).map(([k, v]) => <span key={k} className="me-3"><bdi dir="ltr">{k}</bdi> = {v}</span>)}</p>
      </div>
      {secs.map((x, i) => (
        <div key={i} className="panel space-y-2 p-4">
          <div className="flex gap-2">
            <input className="field" aria-label={rt.polSectionTitle} placeholder={rt.polSectionTitle} value={x.h} onChange={(e) => upd(i, 'h', e.target.value)} />
            <button type="button" className="btn-ghost !py-1.5" onClick={() => move(i, -1)} aria-label="فوق">↑</button>
            <button type="button" className="btn-ghost !py-1.5" onClick={() => move(i, 1)} aria-label="تحت">↓</button>
            <button type="button" className="btn-ghost !py-1.5 text-danger" onClick={() => setSecs((a) => a.filter((_, j) => j !== i))}>{ar.common.delete}</button>
          </div>
          <Field label={rt.polParas}><textarea className="field" rows={2} value={x.p} onChange={(e) => upd(i, 'p', e.target.value)} /></Field>
          <Field label={rt.polBullets}><textarea className="field" rows={4} value={x.ul} onChange={(e) => upd(i, 'ul', e.target.value)} /></Field>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" onClick={() => setSecs((a) => [...a, { h: '', p: '', ul: '' }])}>{rt.polAddSection}</button>
        <button type="button" className="btn-ghost" onClick={() => { if (window.confirm(rt.polReset)) setSecs(toRows(DEFAULT_SECTIONS)) }}>{rt.polReset}</button>
        <button type="button" className="btn-primary" onClick={() => void save()}>{ar.common.save}</button>
        <a className="btn-ghost" href="/payments-policy" target="_blank" rel="noreferrer">{rt.polView}</a>
      </div>
    </div>
  )
}
