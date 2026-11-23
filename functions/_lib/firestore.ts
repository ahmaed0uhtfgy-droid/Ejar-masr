import type { Env } from './env'
import { accessToken } from './google'

export type FsValue = Record<string, unknown>
export type Doc = { id: string; data: Record<string, unknown>; /** RFC 3339 time of the last write; used for optimistic concurrency (see commitGuarded). */ updateTime?: string }

/** Thrown when a write lost a race: the document changed after it was read, or it already exists. Mapped to HTTP 409 by errorResponse. */
export class ConflictError extends Error { constructor(message: string) { super(message); this.name = 'ConflictError' } }

export function decodeValue(v: FsValue): unknown {
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('timestampValue' in v) return new Date(String(v.timestampValue))
  if ('nullValue' in v) return null
  if ('arrayValue' in v) return ((v.arrayValue as { values?: FsValue[] }).values ?? []).map(decodeValue)
  if ('mapValue' in v) return decodeFields((v.mapValue as { fields?: Record<string, FsValue> }).fields ?? {})
  return undefined
}
export function decodeFields(f: Record<string, FsValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decodeValue(v)]))
}
export function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'string') return { stringValue: v }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encodeValue(x)])) } }
}

const base = (env: Env) => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`
const hdr = async (env: Env) => ({ Authorization: `Bearer ${await accessToken(env)}`, 'Content-Type': 'application/json' })

export async function getDocument(env: Env, path: string): Promise<Doc | null> {
  const res = await fetch(`${base(env)}/${path}`, { headers: await hdr(env) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`firestore get ${res.status}`)
  const d = (await res.json()) as { name: string; fields?: Record<string, FsValue>; updateTime?: string }
  return { id: d.name.split('/').pop() ?? '', data: decodeFields(d.fields ?? {}), updateTime: d.updateTime }
}

export interface QueryOpts {
  collection: string
  where?: { field: string; op: 'EQUAL'; value: unknown }[]
  orderBy?: { field: string; dir: 'ASCENDING' | 'DESCENDING' }
  limit?: number
  /** Continue after this position: the value of the orderBy field and the document id (needs `orderBy`). */
  startAfter?: { value: unknown; id: string }
}
export async function runQuery(env: Env, q: QueryOpts): Promise<Doc[]> {
  const filters = (q.where ?? []).map((w) => ({ fieldFilter: { field: { fieldPath: w.field }, op: w.op, value: encodeValue(w.value) } }))
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: q.collection }] }
  if (filters.length) structuredQuery.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } }
  if (q.orderBy) {
    structuredQuery.orderBy = [{ field: { fieldPath: q.orderBy.field }, direction: q.orderBy.dir }]
    if (q.startAfter) {
      // Cursor = (orderBy value, document name). __name__ is explicit and follows the last field's direction, exactly like Firestore's implicit tie-break.
      structuredQuery.orderBy = [...(structuredQuery.orderBy as unknown[]), { field: { fieldPath: '__name__' }, direction: q.orderBy.dir }]
      structuredQuery.startAt = { values: [encodeValue(q.startAfter.value), { referenceValue: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${q.collection}/${q.startAfter.id}` }], before: false }
    }
  }
  if (q.limit) structuredQuery.limit = q.limit
  const res = await fetch(`${base(env)}:runQuery`, { method: 'POST', headers: await hdr(env), body: JSON.stringify({ structuredQuery }) })
  if (!res.ok) throw new Error(`firestore query ${res.status}`)
  const rows = (await res.json()) as { document?: { name: string; fields?: Record<string, FsValue>; updateTime?: string } }[]
  return rows.filter((r) => r.document).map((r) => ({ id: r.document!.name.split('/').pop() ?? '', data: decodeFields(r.document!.fields ?? {}), updateTime: r.document!.updateTime }))
}

export type Write =
  | { kind: 'create'; path: string; data: Record<string, unknown> }
  /** `ifUpdateTime`: apply only if the document has not been written since it was read (otherwise the whole commit fails with ConflictError). */
  | { kind: 'upsert'; path: string; data: Record<string, unknown>; increments?: Record<string, number>; ifUpdateTime?: string }
  | { kind: 'increment'; path: string; field: string; by?: number }
  | { kind: 'delete'; path: string }

export async function commit(env: Env, writes: Write[]): Promise<void> {
  const name = (p: string) => `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/${p}`
  const body = writes.map((w) => {
    switch (w.kind) {
      case 'create': return { update: { name: name(w.path), fields: Object.fromEntries(Object.entries(w.data).map(([k, v]) => [k, encodeValue(v)])) }, currentDocument: { exists: false } }
      case 'upsert': return {
        update: { name: name(w.path), fields: Object.fromEntries(Object.entries(w.data).map(([k, v]) => [k, encodeValue(v)])) },
        updateMask: { fieldPaths: Object.keys(w.data) },
        ...(w.ifUpdateTime ? { currentDocument: { updateTime: w.ifUpdateTime } } : {}),
        ...(w.increments ? { updateTransforms: Object.entries(w.increments).map(([fieldPath, by]) => ({ fieldPath, increment: { integerValue: String(by) } })) } : {}),
      }
      case 'increment': return { transform: { document: name(w.path), fieldTransforms: [{ fieldPath: w.field, increment: { integerValue: String(w.by ?? 1) } }] } }
      case 'delete': return { delete: name(w.path) }
    }
  })
  const res = await fetch(`${base(env)}:commit`, { method: 'POST', headers: await hdr(env), body: JSON.stringify({ writes: body }) })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 409 || /ALREADY_EXISTS|FAILED_PRECONDITION|ABORTED/.test(text)) throw new ConflictError(`firestore commit conflict ${res.status}`)
    throw new Error(`firestore commit ${res.status}: ${text}`)
  }
}

/**
 * Like commit(), but the FIRST write to each listed document only applies if that document is unchanged since it was read.
 * Two requests that read the same state and both try to act on it (double click, two tabs, two owners accepting different requests for one unit)
 * can no longer both succeed: the second fails whole, atomically, with ConflictError (HTTP 409). Documents without a known updateTime are unguarded.
 */
export async function commitGuarded(env: Env, writes: Write[], guards: Record<string, string | undefined>): Promise<void> {
  const used = new Set<string>()
  await commit(env, writes.map((w) => {
    if (w.kind !== 'upsert' || !guards[w.path] || used.has(w.path)) return w
    used.add(w.path)
    return { ...w, ifUpdateTime: guards[w.path] }
  }))
}
