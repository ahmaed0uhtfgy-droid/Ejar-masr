import { useSyncExternalStore } from 'react'

const KEY = 'ejar:compare'
export const MAX_COMPARE = 3
const listeners = new Set<() => void>()
let cache: string[] = read()

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_COMPARE) : []
  } catch { return [] }
}
function write(ids: string[]): void {
  cache = ids
  try { localStorage.setItem(KEY, JSON.stringify(ids)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}

export function addToCompare(id: string): 'added' | 'exists' | 'full' {
  if (cache.includes(id)) return 'exists'
  if (cache.length >= MAX_COMPARE) return 'full'
  write([...cache, id])
  return 'added'
}
export function removeFromCompare(id: string): void { write(cache.filter((x) => x !== id)) }
export function useCompareIds(): string[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb) }, () => cache, () => [])
}
