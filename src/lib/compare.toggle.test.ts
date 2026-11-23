import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToCompare, clearCompare, removeFromCompare, toggleCompare } from './compare'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
}
beforeEach(() => { vi.stubGlobal('localStorage', fakeStorage()); clearCompare() })
afterEach(() => { clearCompare(); vi.unstubAllGlobals() })
const stored = (): string[] => JSON.parse(localStorage.getItem('compare') ?? localStorage.getItem('ejar:compare') ?? '[]') as string[]

describe('toggleCompare (one button to add AND remove)', () => {
  it('adds, then removes on the next press', () => {
    expect(toggleCompare('a')).toBe('added')
    expect(toggleCompare('a')).toBe('removed')
    expect(stored()).not.toContain('a')
  })
  it('the two listings the user could not remove can now be removed one by one or all at once', () => {
    addToCompare('a'); addToCompare('b')
    expect(toggleCompare('a')).toBe('removed')
    expect(stored()).toEqual(['b'])
    addToCompare('a'); clearCompare()
    expect(stored()).toEqual([])
  })
  it('refuses a fourth listing but still lets any existing one be removed', () => {
    for (const id of ['a', 'b', 'c']) expect(toggleCompare(id)).toBe('added')
    expect(toggleCompare('d')).toBe('full')
    expect(toggleCompare('b')).toBe('removed')
    expect(toggleCompare('d')).toBe('added')
  })
  it('removeFromCompare is harmless for an id that is not there', () => { addToCompare('a'); removeFromCompare('zzz'); expect(stored()).toEqual(['a']) })
})
