import { Component, type ErrorInfo, type ReactNode } from 'react'

const FLAG = 'ejar:reloaded-at'

/** After a new deploy, a page that was open can ask for a script file that no longer exists. One automatic reload fixes it (never a loop: at most once per 30 s). */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(FLAG) ?? 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(FLAG, String(Date.now()))
  } catch { /* storage blocked: still try once */ }
  window.location.reload()
  return true
}

const isChunkError = (e: unknown): boolean => /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(String((e as Error)?.message ?? e))

/** Last line of defence: a bug or a failed download in one part of the page shows a friendly screen with a reload button instead of a blank site. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true } }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (isChunkError(error) && reloadOnce()) return
    console.error('render failed', error, info.componentStack)
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div role="alert" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center', fontFamily: 'Tahoma, sans-serif' }}>
        <div>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>حصلت مشكلة مؤقتة</h1>
          <p style={{ marginBottom: 16 }}>جرّب تحدّث الصفحة. لو المشكلة فضلت، ارجع بعد دقايق.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '10px 24px', borderRadius: 8, border: 0, background: '#C9A24B', color: '#0A1830', fontWeight: 700, cursor: 'pointer' }}>تحديث الصفحة</button>
        </div>
      </div>
    )
  }
}
