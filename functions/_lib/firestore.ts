import type { Env } from './env'
import { accessToken } from './google'

export type FsValue = Record<string, unknown>
export type Doc = { id: string; data: Record<string, unknown> }

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
  const d = (await res.json()) as { name: string; fields?: Record<string, FsValue> }
  return { id: d.name.split('/').pop() ?? '', data: decodeFields(d.fields ?? {}) }
}

export interface QueryOpts {
  collection: string
  where?: { field: string; op: 'EQUAL'; value: unknown }[]
  orderBy?: { field: string; dir: 'ASCENDING' | 'DESCENDING' }
  limit?: number
}
export async function runQuery(env: Env, q: QueryOpts): Promise<Doc[]> {
  const filters = (q.where ?? []).map((w) => ({ fieldFilter: { field: { fieldPath: w.field }, op: w.op, value: encodeValue(w.value) } }))
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: q.collection }] }
  if (filters.length) structuredQuery.where = filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } }
  if (q.orderBy) structuredQuery.orderBy = [{ field: { fieldPath: q.orderBy.field }, direction: q.orderBy.dir }]
  if (q.limit) structuredQuery.limit = q.limit
  const res = await fetch(`${base(env)}:runQuery`, { method: 'POST', headers: await hdr(env), body: JSON.stringify({ structuredQuery }) })
  if (!res.ok) throw new Error(`firestore query ${res.status}`)
  const rows = (await res.json()) as { document?: { name: string; fields?: Record<string, FsValue> } }[]
  return rows.filter((r) => r.document).map((r) => ({ id: r.document!.name.split('/').pop() ?? '', data: decodeFields(r.document!.fields ?? {}) }))
}

export type Write =
  | { kind: 'create'; path: string; data: Record<string, unknown> }
  | { kind: 'upsert'; path: string; data: Record<string, unknown>; increments?: Record<string, number> }
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
        ...(w.increments ? { updateTransforms: Object.entries(w.increments).map(([fieldPath, by]) => ({ fieldPath, increment: { integerValue: String(by) } })) } : {}),
      }
      case 'increment': return { transform: { document: name(w.path), fieldTransforms: [{ fieldPath: w.field, increment: { integerValue: String(w.by ?? 1) } }] } }
      case 'delete': return { delete: name(w.path) }
    }
  })
  const res = await fetch(`${base(env)}:commit`, { method: 'POST', headers: await hdr(env), body: JSON.stringify({ writes: body }) })
  if (!res.ok) throw new Error(`firestore commit ${res.status}: ${await res.text()}`)
}
