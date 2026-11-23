/**
 * In-memory stand-in for the Firestore REST API used by functions/_lib/firestore.ts.
 * It speaks the real wire format (typed values, runQuery, commit with preconditions / updateMask / increment transforms),
 * so the handlers run unchanged against it and the codec in firestore.ts is exercised for real.
 * It is a separate, throw-away database per test: it can never touch real data.
 */
import { decodeFields, encodeValue, type FsValue } from '../_lib/firestore'

type Fields = Record<string, FsValue>
interface Counters { reads: number; writes: number; fetches: number }

export interface Seeded { path: string; data: Record<string, unknown> }

export class FakeFirestore {
  docs = new Map<string, Fields>()
  /** RFC 3339 last-write time per document: lets the fake enforce `currentDocument.updateTime` preconditions like the real service. */
  times = new Map<string, string>()
  private tick = 0
  private stamp(path: string): void { this.times.set(path, new Date(Date.UTC(2027, 0, 1) + ++this.tick * 1000).toISOString()) }
  counters: Counters = { reads: 0, writes: 0, fetches: 0 }
  /** Every non-Firestore outbound call (Paymob, Resend, Identity Toolkit, ...) is recorded here and answered by `external`. */
  externalCalls: { url: string; init?: RequestInit; body?: unknown }[] = []
  external: (url: string, init?: RequestInit) => Response | Promise<Response> = () => new Response('{}', { status: 200 })
  failCommit = false

  seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, encodeValue(v)])))
    this.stamp(path)
  }
  get(path: string): Record<string, unknown> | undefined {
    const f = this.docs.get(path)
    return f ? decodeFields(f) : undefined
  }
  list(collection: string): { id: string; data: Record<string, unknown> }[] {
    return [...this.docs.keys()].filter((p) => p.startsWith(`${collection}/`) && !p.slice(collection.length + 1).includes('/'))
      .map((p) => ({ id: p.split('/').pop() as string, data: this.get(p) as Record<string, unknown> }))
  }
  resetCounters(): void { this.counters = { reads: 0, writes: 0, fetches: 0 }; this.externalCalls = [] }

  /** Installs itself as global fetch. Returns a restore function. */
  install(): () => void {
    const original = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input instanceof Request ? input.url : input), init)) as typeof fetch
    return () => { globalThis.fetch = original }
  }

  private async handle(url: string, init?: RequestInit): Promise<Response> {
    this.counters.fetches++
    const m = url.match(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/[^/]+\/databases\/\(default\)\/documents(.*)$/)
    if (!m) {
      let body: unknown
      try { body = init?.body ? JSON.parse(String(init.body)) : undefined } catch { body = init?.body }
      this.externalCalls.push({ url, init, body })
      return this.external(url, init)
    }
    const rest = m[1]
    const method = (init?.method ?? 'GET').toUpperCase()
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (method === 'GET') {
      this.counters.reads++
      const path = decodeURIComponent(rest.replace(/^\//, ''))
      const f = this.docs.get(path)
      return f ? j({ name: `projects/p/databases/(default)/documents/${path}`, fields: f, updateTime: this.times.get(path) }) : j({ error: { code: 404 } }, 404)
    }
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
    if (rest === ':runQuery') return this.query(body.structuredQuery as StructuredQuery, j)
    if (rest === ':commit') return this.commit((body.writes ?? []) as WriteOp[], j)
    return j({ error: { code: 400, message: `unsupported ${rest}` } }, 400)
  }

  private query(q: StructuredQuery, j: (v: unknown, s?: number) => Response): Response {
    const coll = q.from[0].collectionId
    const filters: FieldFilter[] = q.where?.compositeFilter ? q.where.compositeFilter.filters : q.where ? [q.where] : []
    let rows = [...this.docs.entries()]
      .filter(([p]) => p.startsWith(`${coll}/`) && !p.slice(coll.length + 1).includes('/'))
      .filter(([, f]) => filters.every((flt) => {
        const { field, op, value } = flt.fieldFilter
        if (op !== 'EQUAL') throw new Error(`fake firestore: unsupported op ${op}`)
        return JSON.stringify(f[field.fieldPath] ?? { nullValue: null }) === JSON.stringify(value)
      }))
    if (q.orderBy?.length) {
      const keyOf = (path: string, f: Fields, field: string): number | string => {
        if (field === '__name__') return path
        const v = decodeFields({ x: f[field] ?? { nullValue: null } }).x as number | string | Date | null
        return v instanceof Date ? v.getTime() : (v ?? 0) as number | string
      }
      const cmp = (a: number | string, b: number | string): number => (a < b ? -1 : a > b ? 1 : 0)
      const order = q.orderBy
      const compareRows = (pa: string, fa: Fields, pb: string, fb: Fields): number => {
        for (const o of order) { const c = cmp(keyOf(pa, fa, o.field.fieldPath), keyOf(pb, fb, o.field.fieldPath)) * (o.direction === 'DESCENDING' ? -1 : 1); if (c) return c }
        return 0
      }
      rows.sort((a, b) => compareRows(a[0], a[1], b[0], b[1]))
      if (q.startAt) {
        // keep only rows strictly AFTER the cursor position in the requested ordering
        const cursorVals = q.startAt.values.map((v) => (v.referenceValue !== undefined ? pathOf(String(v.referenceValue)) : (decodeFields({ x: v }).x instanceof Date ? (decodeFields({ x: v }).x as Date).getTime() : decodeFields({ x: v }).x as number | string)))
        rows = rows.filter(([p, f]) => {
          for (let i = 0; i < order.length && i < cursorVals.length; i++) {
            const c = cmp(keyOf(p, f, order[i].field.fieldPath), cursorVals[i]) * (order[i].direction === 'DESCENDING' ? -1 : 1)
            if (c) return c > 0
          }
          return false
        })
      }
    }
    if (q.limit) rows = rows.slice(0, q.limit)
    this.counters.reads += Math.max(1, rows.length)
    return j(rows.length ? rows.map(([p, f]) => ({ document: { name: `projects/p/databases/(default)/documents/${p}`, fields: f, updateTime: this.times.get(p) } })) : [{}])
  }

  private commit(writes: WriteOp[], j: (v: unknown, s?: number) => Response): Response {
    if (this.failCommit) return j({ error: { code: 500, message: 'injected failure' } }, 500)
    // Validate preconditions first so a failing write leaves nothing behind (Firestore commits are atomic).
    for (const w of writes) {
      if (w.update && w.currentDocument?.exists === false && this.docs.has(pathOf(w.update.name))) {
        return j({ error: { code: 409, status: 'ALREADY_EXISTS', message: 'Document already exists' } }, 409)
      }
      if (w.update && w.currentDocument?.updateTime !== undefined && this.times.get(pathOf(w.update.name)) !== w.currentDocument.updateTime) {
        return j({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'the document was modified' } }, 400)
      }
    }
    const touched = new Set<string>()
    for (const w of writes) {
      this.counters.writes++
      if (w.delete) { this.docs.delete(pathOf(w.delete)); this.times.delete(pathOf(w.delete)); continue }
      if (w.transform) {
        const p = pathOf(w.transform.document)
        const cur = { ...(this.docs.get(p) ?? {}) }
        for (const t of w.transform.fieldTransforms) cur[t.fieldPath] = { integerValue: String(Number(cur[t.fieldPath]?.integerValue ?? 0) + Number(t.increment.integerValue)) }
        this.docs.set(p, cur); touched.add(p)
        continue
      }
      if (w.update) {
        const p = pathOf(w.update.name)
        const existing = this.docs.get(p)
        // updateMask => merge only the listed fields into the existing document (or create it); no mask => replace.
        const next: Fields = w.updateMask ? { ...(existing ?? {}) } : {}
        for (const k of w.updateMask ? w.updateMask.fieldPaths : Object.keys(w.update.fields)) { if (k in w.update.fields) next[k] = w.update.fields[k] }
        for (const t of w.updateTransforms ?? []) next[t.fieldPath] = { integerValue: String(Number(next[t.fieldPath]?.integerValue ?? 0) + Number(t.increment.integerValue)) }
        this.docs.set(p, next); touched.add(p)
      }
    }
    for (const p of touched) this.stamp(p)
    return j({ writeResults: writes.map(() => ({})) })
  }
}

const pathOf = (name: string): string => name.replace(/^projects\/[^/]+\/databases\/\(default\)\/documents\//, '')

interface FieldFilter { fieldFilter: { field: { fieldPath: string }; op: string; value: FsValue } }
interface StructuredQuery {
  from: { collectionId: string }[]
  where?: FieldFilter & { compositeFilter?: { filters: FieldFilter[] } }
  orderBy?: { field: { fieldPath: string }; direction: 'ASCENDING' | 'DESCENDING' }[]
  startAt?: { values: FsValue[]; before: boolean }
  limit?: number
}
interface Increment { fieldPath: string; increment: { integerValue: string } }
interface WriteOp {
  update?: { name: string; fields: Fields }
  updateMask?: { fieldPaths: string[] }
  updateTransforms?: Increment[]
  currentDocument?: { exists?: boolean; updateTime?: string }
  transform?: { document: string; fieldTransforms: Increment[] }
  delete?: string
}
