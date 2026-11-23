import { useCallback, useRef } from 'react'
import { prefersReducedMotion, useScrollFrame } from '../lib/motion'

/** Thin gold line at the top of the page that fills as you scroll (from the two designs). Decorative, hidden from screen readers. */
export function ScrollBar() {
  const bar = useRef<HTMLElement>(null)
  const frame = useCallback((y: number) => {
    const h = document.documentElement.scrollHeight - window.innerHeight
    if (bar.current) bar.current.style.transform = `scaleX(${h > 0 ? Math.min(1, y / h) : 0})`
  }, [])
  useScrollFrame(frame, !prefersReducedMotion())
  return <div className="scroll-bar" aria-hidden="true"><i ref={bar} /></div>
}
