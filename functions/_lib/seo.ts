import locationsRaw from '../../src/data/locations.json'
import { slugify } from '../../src/lib/slug'
import type { Snapshot, WireDoc } from './listings'

export interface Gov { id: string; name: string; nameEn: string; slug: string }
export const GOVS: Gov[] = (locationsRaw as { governorates: { id: string; name: string; nameEn: string }[] }).governorates.map((g) => ({ ...g, slug: slugify(g.nameEn) }))
export const govBySlug = (slug: string): Gov | undefined => GOVS.find((g) => g.slug === slug)
export const govById = (id: unknown): Gov | undefined => GOVS.find((g) => g.id === id)

const tsOf = (v: unknown): number | null => (v && typeof v === 'object' && typeof (v as { __ts?: unknown }).__ts === 'number' ? (v as { __ts: number }).__ts : null)

/** Live listings of the snapshot (newest first) that belong to a governorate and, optionally, a type. */
export function listingsFor(snap: Snapshot, gov: Gov, typeId?: string, now = Date.now()): WireDoc[] {
  return snap.units
    .filter((d) => d.data.governorateId === gov.id && (!typeId || d.data.typeId === typeId))
    .filter((d) => { const exp = tsOf(d.data.expiresAt); return exp === null || exp > now })
    .sort((a, b) => (tsOf(b.data.createdAt) ?? 0) - (tsOf(a.data.createdAt) ?? 0))
}

/** `YYYY-MM-DD` of the newest listing, for <lastmod>. */
export const newestDay = (docs: WireDoc[]): string | undefined => { const t = docs.length ? Math.max(...docs.map((d) => tsOf(d.data.createdAt) ?? 0)) : 0; return t ? new Date(t).toISOString().slice(0, 10) : undefined }

export const rentWord = (d: WireDoc): string => (d.data.rentType === 'daily' ? 'يوم' : 'شهر')
export const cardText = (d: WireDoc): string => `${String(d.data.title ?? '').slice(0, 80)} — ${Number(d.data.price)} جنيه / ${rentWord(d)}`
