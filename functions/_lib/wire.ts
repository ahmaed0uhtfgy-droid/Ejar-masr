/** JSON-safe form of Firestore data: Dates become { __ts: epochMillis } so the browser can turn them back into Firestore Timestamps. */
export function toWire(v: unknown): unknown {
  if (v instanceof Date) return { __ts: v.getTime() }
  if (Array.isArray(v)) return v.map(toWire)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toWire(x)]))
  return v
}

/** Inverse of toWire: { __ts } markers become Dates again (used when a cached document is read back from the edge cache). */
export function fromWire(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(fromWire)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.__ts === 'number' && Object.keys(o).length === 1) return new Date(o.__ts)
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fromWire(x)]))
  }
  return v
}
