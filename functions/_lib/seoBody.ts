import { escapeHtml } from './logic'

/** Visually-clipped but crawlable copy of the page's main content (React replaces #root on load, so users never see it twice). */
const HIDE = 'position:absolute;width:1px;height:1px;overflow:hidden'

export interface Faq { readonly q: string; readonly a: string }
export interface Link { href: string; text: string }

export function bodyHtml(opts: { h1: string; paragraphs?: string[]; sections?: { h2: string; links?: Link[]; faqs?: readonly Faq[]; text?: string }[] }): string {
  const e = escapeHtml
  const secs = (opts.sections ?? []).map((s) =>
    `<section><h2>${e(s.h2)}</h2>${s.text ? `<p>${e(s.text)}</p>` : ''}` +
    (s.links?.length ? `<ul>${s.links.map((l) => `<li><a href="${e(l.href)}">${e(l.text)}</a></li>`).join('')}</ul>` : '') +
    (s.faqs?.length ? s.faqs.map((f) => `<h3>${e(f.q)}</h3><p>${e(f.a)}</p>`).join('') : '') + `</section>`).join('')
  return `<main style="${HIDE}"><h1>${e(opts.h1)}</h1>${(opts.paragraphs ?? []).map((p) => `<p>${e(p)}</p>`).join('')}${secs}</main>`
}

export const faqJsonLd = (faqs: readonly Faq[]) => ({
  '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
})
