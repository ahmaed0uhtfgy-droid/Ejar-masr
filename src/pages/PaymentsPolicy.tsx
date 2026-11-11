import { Link } from 'react-router-dom'
import { DEFAULT_SECTIONS, fillTokens, policyVars } from '../i18n/policy'
import { usePaySettings, usePolicy } from '../lib/rentals'
import { usePageMeta } from '../lib/seo'
import { Spinner } from '../components/ui'
import NotFound from './NotFound'

export default function PaymentsPolicy() {
  usePageMeta({ title: 'سياسة الإيجار والدفع', description: 'إزاي بيتم الدفع وحجز الفلوس والتأمين والاسترداد في إيجار مصر', path: '/payments-policy' })
  const ps = usePaySettings()
  const policy = usePolicy()
  if (!policy) return <Spinner />
  if (!policy.visible) return <NotFound />
  const vars = policyVars({ fee: ps.platformFeePercent, feePayer: ps.feePayer, claimDays: ps.depositClaimDays, payoutDays: ps.payoutDays, refundDays: ps.refundDays, disputeDays: ps.disputeDays, cancelAfterPayment: ps.cancelAfterPayment, cancelFeePercent: ps.cancelFeePercent })
  const sections = policy.sections ?? DEFAULT_SECTIONS
  const f = (t: string) => fillTokens(t, vars)
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-3xl">سياسة الإيجار والدفع</h1>
      {policy.draft && <p className="mt-4 rounded-field border border-sand p-3 text-sm" role="note">النسخة دي لسه قيد المراجعة، وممكن تتعدّل قبل الإطلاق الرسمي.</p>}
      {sections.map((s) => (
        <section key={s.h} className="mt-8">
          <h2 className="font-display text-xl">{s.h}</h2>
          {s.p?.map((t) => <p key={t} className="mt-2 text-mute">{f(t)}</p>)}
          {s.ul && <ul className="mt-2 list-disc space-y-2 ps-6 text-mute">{s.ul.map((t) => <li key={t}>{f(t)}</li>)}</ul>}
        </section>
      ))}
      <p className="mt-6 text-xs text-mute">آخر تحديث: {policy.version}</p>
      <p className="mt-4 text-sm text-mute"><Link className="text-nile underline" to="/terms">الشروط والأحكام</Link> · <Link className="text-nile underline" to="/privacy">الخصوصية</Link> · <Link className="text-nile underline" to="/contact">تواصل معنا</Link></p>
    </article>
  )
}
