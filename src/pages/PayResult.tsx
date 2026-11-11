import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { rt } from '../i18n/rent'
import { mapPayment } from '../lib/rentals'
import { usePageMeta } from '../lib/seo'
import type { Payment } from '../lib/types'
import { Spinner } from '../components/ui'

/** Landing page after Paymob's checkout. The webhook is the source of truth, so we poll the payment doc a few times. */
export default function PayResult() {
  usePageMeta({ title: rt.resultTitle, noindex: true })
  const [sp] = useSearchParams()
  const id = sp.get('p') ?? ''
  const [pay, setPay] = useState<Payment | null | undefined>(undefined)
  const [tries, setTries] = useState(0)

  const check = useCallback(async () => {
    if (!id) { setPay(null); return }
    const s = await getDoc(doc(db, 'payments', id)).catch(() => null)
    setPay(s?.exists() ? mapPayment(s.id, s.data()) : null)
    setTries((t) => t + 1)
  }, [id])
  useEffect(() => { void check() }, [check])
  useEffect(() => {
    if (pay && (pay.status === 'pending' || pay.status === 'due') && tries < 6) { const t = setTimeout(() => void check(), 3000); return () => clearTimeout(t) }
  }, [pay, tries, check])

  if (pay === undefined) return <Spinner />
  const paid = pay?.status === 'paid'
  const failed = pay?.status === 'failed'
  return (
    <div className="mx-auto max-w-lg px-4 py-12">
      <div className="panel space-y-4 p-6 text-center" role="status">
        <h1 className="font-display text-2xl">{rt.resultTitle}</h1>
        <p className={paid ? 'text-nile' : failed ? 'text-danger' : 'text-mute'}>{paid ? rt.resultPaid : failed ? rt.resultFailed : rt.resultPending}</p>
        <div className="flex justify-center gap-2">
          {!paid && !failed && <button type="button" className="btn-ghost" onClick={() => void check()}>{rt.recheck}</button>}
          <Link to="/rentals" className="btn-primary">{rt.back}</Link>
        </div>
      </div>
    </div>
  )
}
