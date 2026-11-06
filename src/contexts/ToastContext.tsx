import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface Toast { id: number; text: string; kind: 'ok' | 'err' }
interface ToastState { ok(t: string): void; err(t: string): void }
const Ctx = createContext<ToastState | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, kind: Toast['kind']) => {
    const id = Date.now() + Math.random()
    setItems((p) => [...p, { id, text, kind }])
    setTimeout(() => setItems((p) => p.filter((x) => x.id !== id)), 4500)
  }, [])
  const value = useMemo(() => ({ ok: (t: string) => push(t, 'ok'), err: (t: string) => push(t, 'err') }), [push])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 start-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`rounded-field px-4 py-3 text-sm shadow-lg ${t.kind === 'ok' ? 'bg-nile-dark text-white' : 'bg-danger text-white'}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export function useToast(): ToastState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast outside ToastProvider')
  return v
}
