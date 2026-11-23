import { useEffect } from 'react'
import { SITE_URL } from './defaults'
import { BRAND } from './brand'

function setMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el) }
  el.setAttribute('content', content)
}

export interface PageMeta { title: string; description?: string; noindex?: boolean; path?: string; image?: string }

export function usePageMeta({ title, description, noindex, path, image }: PageMeta): void {
  useEffect(() => {
    const full = title.includes(BRAND) ? title : `${title} | ${BRAND}`
    document.title = full
    if (description) { setMeta('name', 'description', description); setMeta('property', 'og:description', description) }
    setMeta('property', 'og:title', full)
    setMeta('property', 'og:type', 'website')
    setMeta('property', 'og:locale', 'ar_EG')
    if (image) setMeta('property', 'og:image', image)
    setMeta('name', 'robots', noindex ? 'noindex,nofollow' : 'index,follow')
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link) }
    link.href = `${SITE_URL}${path ?? window.location.pathname}`
  }, [title, description, noindex, path, image])
}
