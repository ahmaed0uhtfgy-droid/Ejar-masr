import { useEffect, useState } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { ar } from '../i18n/ar'
import { rt } from '../i18n/rent'
import { db } from '../lib/firebase'
import { Field, Spinner } from './ui'

export type PayoutMethod = 'wallet' | 'instapay' | 'bank'

export function PayoutForm() {
  const { user } = useAuth()
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [method, setMethod] = useState<PayoutMethod>('wallet')
  const [holder, setHolder] = useState('')
  const [account, setAccount] = useState('')

  useEffect(() => {
    if (!user) return
    getDoc(doc(db, 'users', user.uid, 'payout', 'main')).then((s) => {
      const d = s.data()
      if (d) { setMethod(d.method); setHolder(d.holder ?? ''); setAccount(d.account ?? '') }
    }).catch(() => undefined).finally(() => setLoaded(true))
  }, [user])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    try {
      await setDoc(doc(db, 'users', user.uid, 'payout', 'main'), { method, holder: holder.trim(), account: account.trim() })
      toast.ok(rt.saved)
    } catch { toast.err(ar.errors.generic) }
  }
  if (!loaded) return <Spinner />
  return (
    <form className="panel max-w-md space-y-4 p-5" onSubmit={(e) => void save(e)}>
      <p className="text-sm text-mute">{rt.payoutHint}</p>
      <Field label={rt.method}>
        <select className="field" value={method} onChange={(e) => setMethod(e.target.value as PayoutMethod)}>
          {(Object.keys(rt.methods) as PayoutMethod[]).map((m) => <option key={m} value={m}>{rt.methods[m]}</option>)}
        </select>
      </Field>
      <Field label={rt.holder}><input className="field" required minLength={3} maxLength={80} value={holder} onChange={(e) => setHolder(e.target.value)} /></Field>
      <Field label={rt.account}><input className="field" dir="ltr" required minLength={6} maxLength={40} value={account} onChange={(e) => setAccount(e.target.value)} /></Field>
      <button className="btn-primary" type="submit">{ar.common.save}</button>
    </form>
  )
}
