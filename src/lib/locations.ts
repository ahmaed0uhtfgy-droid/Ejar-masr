import raw from '../data/locations.json'
import type { LocItem } from './types'
import { slugify } from './slug'

export interface Gov { id: string; name: string; nameEn: string; slug: string }
export interface Area { id: string; govId: string; name: string }
export interface Locality { id: string; areaId: string; name: string }
export interface LocationTree {
  govs: Gov[]
  areasByGov: Record<string, Area[]>
  localitiesByArea: Record<string, Locality[]>
  govById: Record<string, Gov>
  areaById: Record<string, Area>
}

interface RawData {
  governorates: { id: string; name: string; nameEn: string }[]
  areas: { id: string; govId: string; name: string }[]
}
const data = raw as RawData

export const STATIC_COUNTS = { governorates: data.governorates.length, areas: data.areas.length }

/** Static open dataset (egydata, MIT) merged with admin edits stored in settings/locations. */
export function buildLocations(custom: LocItem[] = []): LocationTree {
  const govMap = new Map<string, Gov>()
  const areaMap = new Map<string, Area>()
  const locMap = new Map<string, Locality>()
  for (const g of data.governorates) govMap.set(g.id, { id: g.id, name: g.name, nameEn: g.nameEn, slug: slugify(g.nameEn) })
  for (const a of data.areas) areaMap.set(a.id, { id: a.id, govId: a.govId, name: a.name })

  for (const it of custom) {
    if (it.level === 1) {
      if (it.deleted) govMap.delete(it.id)
      else {
        const prev = govMap.get(it.id)
        govMap.set(it.id, { id: it.id, name: it.name, nameEn: prev?.nameEn ?? it.id, slug: prev?.slug ?? it.id })
      }
    } else if (it.level === 2 && it.parentId) {
      if (it.deleted) areaMap.delete(it.id)
      else areaMap.set(it.id, { id: it.id, govId: it.parentId, name: it.name })
    } else if (it.level === 3 && it.parentId) {
      if (it.deleted) locMap.delete(it.id)
      else locMap.set(it.id, { id: it.id, areaId: it.parentId, name: it.name })
    }
  }

  const govs = [...govMap.values()]
  const areasByGov: Record<string, Area[]> = {}
  const localitiesByArea: Record<string, Locality[]> = {}
  const areaById: Record<string, Area> = {}
  for (const a of areaMap.values()) {
    if (!govMap.has(a.govId)) continue
    areaById[a.id] = a
    ;(areasByGov[a.govId] ??= []).push(a)
  }
  for (const l of locMap.values()) {
    if (!areaById[l.areaId]) continue
    ;(localitiesByArea[l.areaId] ??= []).push(l)
  }
  const cmp = (x: { name: string }, y: { name: string }) => x.name.localeCompare(y.name, 'ar')
  for (const k of Object.keys(areasByGov)) areasByGov[k].sort(cmp)
  for (const k of Object.keys(localitiesByArea)) localitiesByArea[k].sort(cmp)
  const govById = Object.fromEntries(govs.map((g) => [g.id, g]))
  return { govs, areasByGov, localitiesByArea, govById, areaById }
}

export const STATIC_TREE = buildLocations()
