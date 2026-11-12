import type { ReactNode } from 'react'
import { ar } from '../i18n/ar'
import { errDetail, isPermissionError, isQuotaError } from '../lib/errors'
import { firebaseConfigured } from '../lib/firebase'

export function Spinner({ label = ar.common.loading }: { label?: string }) {
  return <p className="py-10 text-center text-mute" role="status">{label}</p>
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="panel p-8 text-center">
      <p className="font-display text-lg">{title}</p>
      {hint && <p className="mt-1 text-mute">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function QuotaNotice() {
  return (
    <div className="panel border-sand p-6" role="alert">
      <h2 className="font-display text-lg">{ar.errors.quotaTitle}</h2>
      <p className="mt-1 text-mute">{ar.errors.quotaBody}</p>
    </div>
  )
}

export function ConfigNotice() {
  if (firebaseConfigured) return null
  return (
    <div className="border-b border-sand bg-surface px-4 py-2 text-center text-sm" role="alert">
      <strong>{ar.errors.configTitle}.</strong> {ar.errors.configBody}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isQuotaError(error)) return <QuotaNotice />
  return (
    <div className="panel p-6 text-center" role="alert">
      <p>{isPermissionError(error) ? ar.errors.permission : ar.errors.generic}</p>
      {errDetail(error) && (
        <p dir="ltr" className="mt-2 break-all text-xs text-mute">
          {errDetail(error).split(/(https?:\/\/\S+)/g).map((part, i) => (i % 2 ? <a key={i} className="text-nile underline" href={part} target="_blank" rel="noreferrer">{part}</a> : part))}
        </p>
      )}
      {onRetry && <button type="button" className="btn-ghost mt-3" onClick={onRetry}>{ar.common.retry}</button>}
    </div>
  )
}

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: string; error?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-danger" role="alert">{error}</span>}
    </label>
  )
}

export function Badge({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'sand' | 'nile' }) {
  const cls = tone === 'sand' ? 'border-sand text-sand' : tone === 'nile' ? 'border-nile text-nile' : 'border-line text-mute'
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>
}
