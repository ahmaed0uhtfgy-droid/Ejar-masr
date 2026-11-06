import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { useAuth } from '../contexts/AuthContext'
import { errCode } from '../lib/errors'
import { firebaseConfigured } from '../lib/firebase'
import { usePageMeta } from '../lib/seo'
import type { AccountType } from '../lib/types'
import { Field } from '../components/ui'

function authMessage(e: unknown): string {
  const c = errCode(e)
  if (c.includes('email-already-in-use')) return ar.auth.errExists
  if (c.includes('weak-password')) return ar.auth.errWeak
  if (c.includes('popup-closed')) return ar.auth.errPopup
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found') || c.includes('invalid-email')) return ar.auth.errInvalid
  if (c.includes('api-key') || c.includes('configuration')) return ar.auth.errConfig
  return ar.errors.generic
}

export default function Auth() {
  usePageMeta({ title: ar.auth.loginTitle, noindex: true })
  const { user, signInEmail, signUpEmail, signInGoogle, resetPassword } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const from = (loc.state as { from?: string } | null)?.from ?? '/'
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('owner')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={from} replace />

  async function run(fn: () => Promise<void>) {
    setBusy(true); setMsg('')
    try { await fn(); nav(from, { replace: true }) } catch (e) { setMsg(authMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="font-display text-3xl">{mode === 'login' ? ar.auth.loginTitle : ar.auth.signupTitle}</h1>
      {!firebaseConfigured && <p className="mt-3 text-sm text-danger" role="alert">{ar.auth.errConfig}</p>}
      <form className="panel mt-6 space-y-4 p-5" onSubmit={(e) => { e.preventDefault(); void run(() => (mode === 'login' ? signInEmail(email, password) : signUpEmail(email, password, name.trim(), type))) }}>
        {mode === 'signup' && (
          <>
            <Field label={ar.auth.name}><input className="field" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
            <Field label={ar.auth.accountType}>
              <select className="field" value={type} onChange={(e) => setType(e.target.value as AccountType)}>
                <option value="owner">{ar.auth.typeOwner}</option>
                <option value="broker">{ar.auth.typeBroker}</option>
              </select>
            </Field>
          </>
        )}
        <Field label={ar.auth.email}><input className="field" type="email" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
        <Field label={ar.auth.password}><input className="field" type="password" required minLength={6} dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></Field>
        {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
        <button className="btn-primary w-full" disabled={busy} type="submit">{mode === 'login' ? ar.auth.login : ar.auth.signup}</button>
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={() => void run(signInGoogle)}>{ar.auth.google}</button>
        {mode === 'login' && email && (
          <button type="button" className="text-sm underline" onClick={() => { resetPassword(email).then(() => setMsg(ar.auth.resetSent)).catch((e) => setMsg(authMessage(e))) }}>{ar.auth.forgot}</button>
        )}
      </form>
      <p className="mt-4 text-center text-sm">
        {mode === 'login' ? ar.auth.noAccount : ar.auth.haveAccount}{' '}
        <button type="button" className="text-nile underline" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMsg('') }}>{mode === 'login' ? ar.auth.signupTitle : ar.auth.loginTitle}</button>
      </p>
    </div>
  )
}
