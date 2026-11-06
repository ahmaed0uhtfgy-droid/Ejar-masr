import { useSettings } from '../contexts/SettingsContext'
import { ar } from '../i18n/ar'

interface Props {
  govId: string
  areaId: string
  onChange: (v: { govId: string; areaId: string }) => void
  anyLabel?: boolean
}

export function LocationSelect({ govId, areaId, onChange, anyLabel = true }: Props) {
  const { locations } = useSettings()
  const areas = govId ? locations.areasByGov[govId] ?? [] : []
  return (
    <>
      <label className="block">
        <span className="label">{ar.search.gov}</span>
        <select className="field" value={govId} onChange={(e) => onChange({ govId: e.target.value, areaId: '' })}>
          <option value="">{anyLabel ? ar.home.anyGov : '—'}</option>
          {locations.govs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">{ar.search.area}</span>
        <select className="field" value={areaId} disabled={!govId} onChange={(e) => onChange({ govId, areaId: e.target.value })}>
          <option value="">{anyLabel ? ar.common.all : '—'}</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </label>
    </>
  )
}
