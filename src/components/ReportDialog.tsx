import { useState } from 'react'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ar } from '../i18n/ar'
import { REPORT_REASONS } from '../lib/defaults'
import { db } from '../lib/firebase'
import { errCode } from '../lib/errors'
import type { Unit } from '../lib/types'
import { Field } from './ui'

export function ReportDialog({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const { user, banned } = useAuth()
  const toast = useToast()
  const [reason, setReason] = useState<string>(REPORT_REASONS[0].id)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!user) return
    setBusy(true)
    try {
      await setDoc(doc(db, 'reports', `${user.uid}_${unit.id}`), {
        unitId: unit.id, unitTitle: unit.title.slice(0, 120), reporterId: user.uid, reason, note: note.slice(0, 500), status: 'new', createdAt: serverTimestamp(),
      })
      toast.ok(ar.report.sent)
      onClose()
    } catch (e) {
      toast.err(errCode(e).includes('permission') ? ar.report.exists : ar.errors.generic)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={ar.report.title}>
      <div className="panel w-full max-w-md space-y-4 p-5">
        <h2 className="font-display text-lg">{ar.report.title}</h2>
        {!user ? <p>{ar.report.login}</p> : (
          <>
            <Field label={ar.report.reason}>
              <select className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REPORT_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
            <Field label={ar.report.note}><textarea className="field" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </>
        )}
        <div className="flex gap-2">
          {user && <button type="button" className="btn-primary" disabled={busy || banned} onClick={() => void submit()}>{ar.report.send}</button>}
          <button type="button" className="btn-ghost" onClick={onClose}>{ar.common.close}</button>
        </div>
      </div>
    </div>
  )
}
