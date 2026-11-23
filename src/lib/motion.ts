import { useEffect, type RefObject } from 'react'

export const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Calls `fn(scrollY)` on every scroll / resize, at most once per animation frame. Does nothing for visitors who asked for less motion. */
export function useScrollFrame(fn: (y: number) => void, enabled = true): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    let queued = false
    const run = () => { queued = false; fn(window.scrollY) }
    const req = () => { if (!queued) { queued = true; requestAnimationFrame(run) } }
    window.addEventListener('scroll', req, { passive: true })
    window.addEventListener('resize', req)
    run()
    return () => { window.removeEventListener('scroll', req); window.removeEventListener('resize', req) }
  }, [fn, enabled])
}

/** Fades `.reveal` elements inside `root` in once they are on screen. `deps` re-scans after content that loads later (units, posts). */
export function useReveal(root: RefObject<HTMLElement | null>, deps: unknown[] = []): void {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const items = [...el.querySelectorAll<HTMLElement>('.reveal:not(.in)')]
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) { items.forEach((i) => i.classList.add('in')); return }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } }), { threshold: 0.12 })
    items.forEach((i) => io.observe(i))
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, ...deps])
}

/** 0..1 progress of `el` through its own height while it crosses the viewport (for sticky / pinned sections). */
export function sectionProgress(el: HTMLElement | null): number {
  if (!el) return 0
  const r = el.getBoundingClientRect()
  const span = Math.max(1, r.height - window.innerHeight)
  return Math.min(1, Math.max(0, -r.top / span))
}
