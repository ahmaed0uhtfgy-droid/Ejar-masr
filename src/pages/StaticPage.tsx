import { ar } from '../i18n/ar'
import { usePageMeta } from '../lib/seo'

type Key = 'about' | 'terms' | 'privacy' | 'safety' | 'contact'

export default function StaticPage({ page }: { page: Key }) {
  const p = ar.static[page]
  usePageMeta({ title: p.title, description: p.body[0], path: `/${page}` })
  return (
    <article className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-display text-3xl">{p.title}</h1>
      {page === 'safety' ? (
        <ul className="mt-6 list-disc space-y-3 ps-6 text-mute">{p.body.map((b) => <li key={b}>{b}</li>)}</ul>
      ) : (
        <div className="mt-6 space-y-4 text-mute">{p.body.map((b) => <p key={b}>{b}</p>)}</div>
      )}
      {page === 'contact' && (
        ar.contactEmail
          ? <p className="mt-6"><a className="text-nile underline" href={`mailto:${ar.contactEmail}`} dir="ltr">{ar.contactEmail}</a></p>
          : <p className="mt-6 rounded-field border border-sand p-3 text-sm">{ar.static.contact.emailPlaceholder}</p>
      )}
    </article>
  )
}
