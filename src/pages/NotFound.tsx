import { Link } from 'react-router-dom'
import { ar } from '../i18n/ar'
import { usePageMeta } from '../lib/seo'

export default function NotFound() {
  usePageMeta({ title: ar.notFound.title, noindex: true })
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-3xl">{ar.notFound.title}</h1>
      <p className="mt-2 text-mute">{ar.notFound.text}</p>
      <Link to="/" className="btn-primary mt-6">{ar.notFound.home}</Link>
    </div>
  )
}
