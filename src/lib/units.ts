import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where,
  Timestamp, type DocumentData, type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from './firebase'
import { isExpired } from './format'
import { PAGE_SIZE } from './defaults'
import { errCode } from './errors'
import type { SearchFilters, SortKey, Unit } from './types'

const toDate = (v: unknown): Date | null => (v instanceof Timestamp ? v.toDate() : null)

export function mapUnit(id: string, d: DocumentData): Unit {
  return {
    id,
    title: d.title ?? '', description: d.description ?? '',
    typeId: d.typeId ?? '', typeName: d.typeName ?? '',
    rentType: d.rentType === 'daily' ? 'daily' : 'monthly',
    price: Number(d.price ?? 0), deposit: typeof d.deposit === 'number' ? d.deposit : null,
    governorateId: d.governorateId ?? '', governorateName: d.governorateName ?? '',
    areaId: d.areaId ?? '', areaName: d.areaName ?? '',
    localityId: d.localityId ?? null, localityName: d.localityName ?? '',
    address: d.address ?? '',
    lat: typeof d.lat === 'number' ? d.lat : null, lng: typeof d.lng === 'number' ? d.lng : null,
    rooms: Number(d.rooms ?? 0), bathrooms: Number(d.bathrooms ?? 0), area: Number(d.area ?? 0), floor: Number(d.floor ?? 0),
    furnished: !!d.furnished, amenities: Array.isArray(d.amenities) ? d.amenities : [],
    studentHousing: !!d.studentHousing, audience: d.audience ?? 'all',
    images: Array.isArray(d.images) ? d.images : [],
    ownerId: d.ownerId ?? '', ownerName: d.ownerName ?? '',
    ownerType: d.ownerType === 'broker' ? 'broker' : 'owner', ownerVerified: !!d.ownerVerified,
    status: d.status ?? 'active', hiddenByAdmin: !!d.hiddenByAdmin,
    durationMode: d.durationMode === 'custom' ? 'custom' : 'default',
    depositMode: d.depositMode === 'held-claim' || d.depositMode === 'held-auto' ? d.depositMode : 'none',
    lockedUntil: toDate(d.lockedUntil), rentedUntil: typeof d.rentedUntil === 'string' ? d.rentedUntil : null,
    createdAt: toDate(d.createdAt), expiresAt: toDate(d.expiresAt),
  }
}

/** Filters that Firestore cannot combine without a composite index per combination are applied client-side. */
export function matchesFilters(u: Unit, f: SearchFilters, now: Date = new Date()): boolean {
  if (u.status !== 'active' || isExpired(u.expiresAt, now)) return false
  if (f.governorateId && u.governorateId !== f.governorateId) return false
  if (f.areaId && u.areaId !== f.areaId) return false
  if (f.typeId && u.typeId !== f.typeId) return false
  if (f.rentType && u.rentType !== f.rentType) return false
  if (f.priceMin != null && u.price < f.priceMin) return false
  if (f.priceMax != null && u.price > f.priceMax) return false
  if (f.roomsMin != null && u.rooms < f.roomsMin) return false
  if (f.bathroomsMin != null && u.bathrooms < f.bathroomsMin) return false
  if (f.areaMin != null && u.area < f.areaMin) return false
  if (f.furnished === 'yes' && !u.furnished) return false
  if (f.furnished === 'no' && u.furnished) return false
  if (f.student && !u.studentHousing) return false
  if (f.audience && f.audience !== 'all' && u.audience !== 'all' && u.audience !== f.audience) return false
  if (f.ownerType && u.ownerType !== f.ownerType) return false
  if (f.amenities?.length && !f.amenities.every((a) => u.amenities.includes(a))) return false
  return true
}

export interface Page { items: Unit[]; cursor: QueryDocumentSnapshot | null; done: boolean; reads: number }

const MAX_ROUNDS = 3 // caps Firestore reads per "load more" click: at most MAX_ROUNDS * FETCH_SIZE

/**
 * Server-side: status, governorate, rentType equality + one ordering (indexes in firestore.indexes.json).
 * Everything else is filtered client-side, so selective filters can cost more reads per visible card.
 */
export async function searchUnits(f: SearchFilters, sort: SortKey, cursor: QueryDocumentSnapshot | null = null, pageSize = PAGE_SIZE): Promise<Page> {
  const fetchSize = pageSize * 2
  const eq: QueryConstraint[] = [where('status', '==', 'active')]
  if (f.governorateId) eq.push(where('governorateId', '==', f.governorateId))
  if (f.rentType) eq.push(where('rentType', '==', f.rentType))
  const base: QueryConstraint[] = [...eq]
  base.push(sort === 'newest' ? orderBy('createdAt', 'desc') : orderBy('price', sort === 'priceAsc' ? 'asc' : 'desc'))

  const items: Unit[] = []
  let cur = cursor
  let done = false
  let reads = 0
  try {
  for (let round = 0; round < MAX_ROUNDS && items.length < pageSize && !done; round++) {
    const snap = await getDocs(query(db_units(), ...base, ...(cur ? [startAfter(cur)] : []), limit(fetchSize)))
    reads += snap.size
    for (const d of snap.docs) {
      const u = mapUnit(d.id, d.data())
      if (matchesFilters(u, f)) items.push(u)
    }
    cur = snap.docs.length ? snap.docs[snap.docs.length - 1] : cur
    if (snap.size < fetchSize) done = true
  }
  } catch (e) {
    if (errCode(e) !== 'failed-precondition' || cursor) throw e
    // The composite index is missing or still building: read the active units without server-side ordering and sort here.
    // Works for a small catalogue; create the indexes in firestore.indexes.json to get paging and cheaper reads.
    const snap = await getDocs(query(db_units(), ...eq, limit(200)))
    const all = snap.docs.map((d) => mapUnit(d.id, d.data())).filter((u) => matchesFilters(u, f))
    all.sort(sortFn(sort))
    return { items: all.slice(0, pageSize), cursor: null, done: true, reads: snap.size }
  }
  return { items, cursor: cur, done, reads }
}

const sortFn = (sort: SortKey) => (a: Unit, b: Unit): number =>
  sort === 'priceAsc' ? a.price - b.price : sort === 'priceDesc' ? b.price - a.price : (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)

const db_units = () => collection(db, 'units')

export async function getUnit(id: string): Promise<Unit | null> {
  const s = await getDoc(doc(db, 'units', id))
  return s.exists() ? mapUnit(s.id, s.data()) : null
}

export async function getUnits(ids: string[]): Promise<Unit[]> {
  const res = await Promise.all(ids.map((i) => getUnit(i).catch(() => null)))
  return res.filter((u): u is Unit => u !== null)
}

export async function latestUnits(n = 8): Promise<Unit[]> {
  let docs
  try {
    docs = (await getDocs(query(db_units(), where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(n * 2)))).docs
  } catch (e) {
    if (errCode(e) !== 'failed-precondition') throw e
    docs = (await getDocs(query(db_units(), where('status', '==', 'active'), limit(100)))).docs // index missing: sort here
  }
  return docs.map((d) => mapUnit(d.id, d.data())).filter((u) => !isExpired(u.expiresAt)).sort(sortFn('newest')).slice(0, n)
}

export async function ownerUnits(uid: string): Promise<Unit[]> {
  const snap = await getDocs(query(db_units(), where('ownerId', '==', uid), limit(200)))
  return snap.docs.map((d) => mapUnit(d.id, d.data())).sort(sortFn('newest')) // sorted here: no composite index needed
}

export const filtersToParams = (f: SearchFilters, sort: SortKey, view: 'list' | 'map'): URLSearchParams => {
  const p = new URLSearchParams()
  const set = (k: string, v: unknown) => { if (v !== undefined && v !== '' && v !== false) p.set(k, String(v)) }
  set('gov', f.governorateId); set('area', f.areaId); set('type', f.typeId); set('rent', f.rentType)
  set('pmin', f.priceMin); set('pmax', f.priceMax); set('rooms', f.roomsMin); set('baths', f.bathroomsMin); set('size', f.areaMin)
  set('furn', f.furnished); set('student', f.student); set('aud', f.audience); set('by', f.ownerType)
  if (f.amenities?.length) p.set('am', f.amenities.join(','))
  if (sort !== 'newest') p.set('sort', sort)
  if (view === 'map') p.set('view', 'map')
  return p
}

export const paramsToFilters = (p: URLSearchParams): { filters: SearchFilters; sort: SortKey; view: 'list' | 'map' } => {
  const num = (k: string): number | undefined => { const v = p.get(k); if (v == null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined }
  const str = (k: string): string | undefined => p.get(k) || undefined
  const filters: SearchFilters = {
    governorateId: str('gov'), areaId: str('area'), typeId: str('type'),
    rentType: (['monthly', 'daily'] as const).find((x) => x === p.get('rent')),
    priceMin: num('pmin'), priceMax: num('pmax'), roomsMin: num('rooms'), bathroomsMin: num('baths'), areaMin: num('size'),
    furnished: (['yes', 'no'] as const).find((x) => x === p.get('furn')),
    student: p.get('student') === 'true' ? true : undefined,
    audience: (['all', 'families', 'singles'] as const).find((x) => x === p.get('aud')),
    ownerType: (['owner', 'broker'] as const).find((x) => x === p.get('by')),
    amenities: p.get('am') ? p.get('am')!.split(',').filter(Boolean) : undefined,
  }
  const s = p.get('sort')
  const sort: SortKey = s === 'priceAsc' || s === 'priceDesc' ? s : 'newest'
  return { filters, sort, view: p.get('view') === 'map' ? 'map' : 'list' }
}
