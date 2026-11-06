import { ar } from '../i18n/ar'
import { useSettings } from '../contexts/SettingsContext'
import type { SearchFilters } from '../lib/types'
import { Field } from './ui'
import { LocationSelect } from './LocationSelect'

interface Props { filters: SearchFilters; onChange: (f: SearchFilters) => void; onReset: () => void }

const numOrUndef = (v: string): number | undefined => (v === '' ? undefined : Number(v))

export function FiltersPanel({ filters: f, onChange, onReset }: Props) {
  const { settings } = useSettings()
  const set = (patch: Partial<SearchFilters>) => onChange({ ...f, ...patch })
  return (
    <form className="panel space-y-4 p-4" onSubmit={(e) => e.preventDefault()} aria-label={ar.search.filters}>
      <div className="grid gap-3">
        <LocationSelect govId={f.governorateId ?? ''} areaId={f.areaId ?? ''} onChange={(v) => set({ governorateId: v.govId || undefined, areaId: v.areaId || undefined })} />
        <Field label={ar.search.type}>
          <select className="field" value={f.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value || undefined })}>
            <option value="">{ar.home.anyType}</option>
            {settings.unitTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Field>
        <Field label={ar.search.rent}>
          <select className="field" value={f.rentType ?? ''} onChange={(e) => set({ rentType: (e.target.value || undefined) as SearchFilters['rentType'] })}>
            <option value="">{ar.home.anyRent}</option>
            <option value="monthly">{ar.search.monthly}</option>
            <option value="daily">{ar.search.daily}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={ar.search.priceMin}><input className="field" type="number" min={0} inputMode="numeric" value={f.priceMin ?? ''} onChange={(e) => set({ priceMin: numOrUndef(e.target.value) })} /></Field>
        <Field label={ar.search.priceMax}><input className="field" type="number" min={0} inputMode="numeric" value={f.priceMax ?? ''} onChange={(e) => set({ priceMax: numOrUndef(e.target.value) })} /></Field>
        <Field label={ar.search.rooms}><input className="field" type="number" min={0} value={f.roomsMin ?? ''} onChange={(e) => set({ roomsMin: numOrUndef(e.target.value) })} /></Field>
        <Field label={ar.search.baths}><input className="field" type="number" min={0} value={f.bathroomsMin ?? ''} onChange={(e) => set({ bathroomsMin: numOrUndef(e.target.value) })} /></Field>
        <Field label={ar.search.size}><input className="field" type="number" min={0} value={f.areaMin ?? ''} onChange={(e) => set({ areaMin: numOrUndef(e.target.value) })} /></Field>
        <Field label={ar.search.furnished}>
          <select className="field" value={f.furnished ?? ''} onChange={(e) => set({ furnished: (e.target.value || undefined) as SearchFilters['furnished'] })}>
            <option value="">{ar.common.all}</option>
            <option value="yes">{ar.search.furnishedYes}</option>
            <option value="no">{ar.search.furnishedNo}</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={ar.search.audience}>
          <select className="field" value={f.audience ?? ''} onChange={(e) => set({ audience: (e.target.value || undefined) as SearchFilters['audience'] })}>
            <option value="">{ar.common.all}</option>
            <option value="families">{ar.search.audFamilies}</option>
            <option value="singles">{ar.search.audSingles}</option>
          </select>
        </Field>
        <Field label={ar.search.by}>
          <select className="field" value={f.ownerType ?? ''} onChange={(e) => set({ ownerType: (e.target.value || undefined) as SearchFilters['ownerType'] })}>
            <option value="">{ar.common.all}</option>
            <option value="owner">{ar.search.byOwner}</option>
            <option value="broker">{ar.search.byBroker}</option>
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={!!f.student} onChange={(e) => set({ student: e.target.checked || undefined })} /> {ar.search.student}</label>
      <fieldset>
        <legend className="label">{ar.search.amenities}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {settings.amenities.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={f.amenities?.includes(a.id) ?? false}
                onChange={(e) => { const cur = new Set(f.amenities ?? []); if (e.target.checked) cur.add(a.id); else cur.delete(a.id); set({ amenities: cur.size ? [...cur] : undefined }) }} /> {a.label}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="button" className="btn-ghost w-full" onClick={onReset}>{ar.search.reset}</button>
    </form>
  )
}
