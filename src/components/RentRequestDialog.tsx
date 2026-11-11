import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { buildTerms, feeCents, toCents, validCycles } from '../../functions/_lib/rent'
import { useToast } from '../contexts/ToastContext'
import { rt } from '../i18n/rent'
import { ar } from '../i18n/ar'
import { ApiError, apiPost } from '../lib/api'
import { PHONE_RE, fmtNum } from '../lib/format'
import { fmtYmd, todayYmd, usePaySettings, usePolicy } from '../lib/rentals'
import type { Unit } from '../lib/types'
import { Field } from './ui'

const MONTHS = [1, 2, 3, 4, 5, 6, 9, 12, 18, 24]

export function RentRequestDialog({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const toast = useToast()
  const nav = useNavigate()
  const ps = usePaySettings()
  const policy = usePolicy()
  const needAgree = policy?.visible !== false
  const monthly = unit.rentType === 'monthly'
  const deposit = monthly && unit.depositMode !== 'none' && unit.deposit ? unit.deposit : 0
  const [phone, setPhone] = useState('')
  const [start, setStart] = useState(todayYmd())
  const [months, setMonths] = useState(6)
  const [cycle, setCycle] = useState(1)
  const [days, setDays] = useState(3)
  const [note, setNote] = useState('')
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const cycles = validCycles(months, ps.cycles)
  const cyc = cycles.includes(cycle) ? cycle : cycles[0] ?? 1
  const terms = useMemo(() => buildTerms({ rentType: unit.rentType, price: unit.price, startDate: start, durationMonths: months, cycleMonths: cyc, days }, todayYmd(), { maxMonths: ps.maxLeaseMonths, cycles: ps.cycles }), [unit, start, months, cyc, days, ps])

  // The part of the platform fee the tenant pays (admin setting), per installment.
  const tenantFee = (amount: number): number => {
    const f = feeCents(toCents(amount), ps.platformFeePercent)
    return (ps.feePayer === 'tenant' ? f : ps.feePayer === 'split' ? Math.round(f / 2) : 0) / 100
  }
  const fees = terms.ok ? terms.schedule.reduce((s, x) => s + tenantFee(x.amount), 0) : 0

  async function submit() {
    setError('')
    if (!PHONE_RE.test(phone.trim())) { setError(rt.errPhone); return }
    if (!terms.ok) { setError(terms.message); return }
    if (needAgree && !agree) { setError('لازم توافق على سياسة الإيجار والدفع'); return }
    setBusy(true)
    try {
      await apiPost('/api/lease-request', { acceptedPolicy: needAgree ? policy?.version : undefined, unitId: unit.id, startDate: start, durationMonths: months, cycleMonths: cyc, days, phone: phone.trim(), note })
      toast.ok(rt.sent)
      nav('/rentals')
    } catch (e) { setError(e instanceof ApiError ? e.message : ar.errors.generic) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={rt.dlgTitle}>
      <div className="panel my-auto w-full max-w-lg space-y-4 p-5">
        <h2 className="font-display text-lg">{rt.dlgTitle}: {unit.title}</h2>
        <Field label={rt.phone}><input className="field" dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label={rt.start}><input className="field" type="date" min={todayYmd()} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        {monthly ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={rt.months}>
              <select className="field" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {MONTHS.filter((m) => m <= ps.maxLeaseMonths).map((m) => <option key={m} value={m}>{fmtNum(m)} {rt.month}</option>)}
              </select>
            </Field>
            <Field label={rt.cycle}>
              <select className="field" value={cyc} onChange={(e) => setCycle(Number(e.target.value))}>
                {cycles.map((c) => <option key={c} value={c}>{rt.cycleLabel(c)}</option>)}
              </select>
            </Field>
          </div>
        ) : (
          <Field label={rt.days}><input className="field" type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} /></Field>
        )}
        <Field label={rt.note}><textarea className="field" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>

        {terms.ok && (
          <div className="rounded-field border border-line p-3 text-sm">
            <p className="font-medium">{rt.schedule}</p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {terms.schedule.map((s) => (
                <li key={s.index} className="flex justify-between gap-2">
                  <span className="text-mute">{rt.due} {fmtYmd(s.dueDate)}</span>
                  <span>{fmtNum(s.amount)} {ar.common.currency}{tenantFee(s.amount) > 0 ? ` + ${fmtNum(tenantFee(s.amount))} ${rt.serviceFee}` : ''}</span>
                </li>
              ))}
            </ul>
            {deposit > 0 && <p className="mt-2 flex justify-between text-mute"><span>{rt.depositIncluded}</span><span>+ {fmtNum(deposit)} {ar.common.currency}</span></p>}
            <p className="mt-2 flex justify-between border-t border-line pt-2 font-semibold"><span>{rt.total}</span><span>{fmtNum(terms.total + deposit + fees)} {ar.common.currency}</span></p>
            {deposit > 0 && <p className="mt-1 text-xs text-mute">{rt.depositModes[unit.depositMode]}</p>}
          </div>
        )}
        {needAgree && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>قرأت ووافقت على <Link className="text-nile underline" to="/payments-policy" target="_blank">سياسة الإيجار والدفع</Link> (حجز الفلوس والتأمين والإلغاء والاسترداد).</span></label>
        )}
        <p className="text-xs text-mute">{rt.requestNote}</p>
        <p className="text-xs text-mute">{rt.escrowNote}</p>
        <p className="text-xs text-mute">{rt.feeNote}</p>
        {(error || !terms.ok) && <p className="text-sm text-danger" role="alert">{error || (terms.ok ? '' : terms.message)}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn-primary" disabled={busy || !terms.ok} onClick={() => void submit()}>{rt.send}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>{ar.common.close}</button>
        </div>
      </div>
    </div>
  )
}
