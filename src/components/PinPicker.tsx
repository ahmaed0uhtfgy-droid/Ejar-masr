import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EGYPT_CENTER, FALLBACK_TILES, geocodeUrl, googleMapsUrl, inEgypt, parseGeocode, tilesFor, toPin, type Pin, type Place } from '../lib/mapUtils'

export type { Pin }
export { inEgypt }

const PIN_ICON_HTML = '<span style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 2px rgba(0,0,0,.5))">📍</span>'
type Place_ = (p: Pin, zoom?: number) => void

/**
 * Pin on a map. Editing: click the map or DRAG the pin, search an address, or use "my location"; zoom in until the pin sits on the building.
 * Read-only (listing page): a clear map with a link that opens the exact point in Google Maps.
 */
export function PinPicker({ value, onChange, readOnly = false, height = 280 }: { value: Pin | null; onChange?: (p: Pin | null) => void; readOnly?: boolean; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const placeRef = useRef<Place_>(() => undefined)
  const cb = useRef(onChange)
  cb.current = onChange
  const [note, setNote] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Place[]>([])
  const [accuracy, setAccuracy] = useState<number | null>(null)

  useEffect(() => {
    if (!el.current) return
    const isDark = () => document.documentElement.classList.contains('dark')
    const map = L.map(el.current, { scrollWheelZoom: !readOnly }).setView(value ? [value.lat, value.lng] : EGYPT_CENTER, value ? 17 : 6)
    const t = tilesFor(isDark())
    const tiles = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom, subdomains: t.subdomains }).addTo(map)
    let errors = 0
    let fellBack = false
    tiles.on('tileerror', () => { errors += 1; if (errors >= 3 && !fellBack) { fellBack = true; tiles.setUrl(FALLBACK_TILES.url) } })
    const theme = new MutationObserver(() => { if (!fellBack) tiles.setUrl(tilesFor(isDark()).url) })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    L.control.scale({ imperial: false }).addTo(map)
    if (readOnly) { map.on('click focus', () => map.scrollWheelZoom.enable()); map.on('mouseout', () => map.scrollWheelZoom.disable()) } // never trap the page scroll

    const icon = L.divIcon({ className: 'map-pin', html: PIN_ICON_HTML, iconSize: [32, 32], iconAnchor: [16, 30] })
    let last: Pin | null = value
    const marker = (p: Pin): L.Marker => {
      const m = L.marker([p.lat, p.lng], { icon, draggable: !readOnly, keyboard: !readOnly }).addTo(map)
      if (!readOnly) m.on('dragend', () => {
        const ll = m.getLatLng()
        const np = toPin(ll.lat, ll.lng)
        if (inEgypt(np)) { last = np; setNote(null); cb.current?.(np) } else { if (last) m.setLatLng([last.lat, last.lng]); setNote('الموقع ده برا مصر. رجّعنا الدبوس مكانه.') }
      })
      return m
    }
    if (value) markerRef.current = marker(value)
    mapRef.current = map

    placeRef.current = (p, zoom) => {
      if (!inEgypt(p)) { setNote('الموقع ده برا مصر'); return }
      if (markerRef.current) markerRef.current.setLatLng([p.lat, p.lng]); else markerRef.current = marker(p)
      if (zoom) map.setView([p.lat, p.lng], zoom)
      last = p; setNote(null); cb.current?.(p)
    }
    if (!readOnly) map.on('click', (e: L.LeafletMouseEvent) => placeRef.current(toPin(e.latlng.lat, e.latlng.lng)))
    return () => { theme.disconnect(); map.remove(); mapRef.current = null; markerRef.current = null; placeRef.current = () => undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  // The form can change the value after the map exists (editing an existing listing, or clearing the pin): keep the marker in step.
  useEffect(() => {
    const map = mapRef.current
    const m = markerRef.current
    if (!map || !m || !value) return
    const ll = m.getLatLng()
    if (Math.abs(ll.lat - value.lat) > 1e-7 || Math.abs(ll.lng - value.lng) > 1e-7) m.setLatLng([value.lat, value.lng])
  }, [value?.lat, value?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  async function search() {
    const term = q.trim()
    if (busy || term.length < 3) return
    setBusy(true); setNote(null); setResults([]); setAccuracy(null)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8000)
    try {
      const res = await fetch(geocodeUrl(term), { signal: ctl.signal })
      if (!res.ok) throw new Error(String(res.status))
      const found = parseGeocode(await res.json())
      if (found.length === 1) placeRef.current(toPin(found[0].lat, found[0].lng), 17)
      else setResults(found)
      if (found.length === 0) setNote('مفيش نتايج. جرّب اسم المنطقة أو معلم مشهور قريب، أو اضغط على الخريطة مباشرة.')
    } catch { setNote('البحث مش شغال دلوقتي. اضغط على الخريطة أو اسحب الدبوس.') } finally {
      clearTimeout(timer)
      window.setTimeout(() => setBusy(false), 1000) // one request per second at most (the free search service asks for that)
    }
  }

  function locate() {
    if (!('geolocation' in navigator)) { setNote('المتصفح مش بيدعم تحديد الموقع'); return }
    setNote('بنحدد موقعك...'); setResults([])
    navigator.geolocation.getCurrentPosition(
      (pos) => { setAccuracy(Math.round(pos.coords.accuracy)); placeRef.current(toPin(pos.coords.latitude, pos.coords.longitude), 18) },
      (err) => setNote(err.code === 1 ? 'اسمح للموقع يحدد مكانك من إعدادات المتصفح، أو اضغط على الخريطة.' : 'مقدرناش نحدد موقعك. اضغط على الخريطة بدل كده.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    )
  }

  return (
    <div>
      {!readOnly && (
        <div role="search" className="mb-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              className="field min-w-0 flex-1" value={q} maxLength={120} placeholder="ابحث عن عنوان أو منطقة أو معلم قريب" aria-label="ابحث عن عنوان على الخريطة"
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
            />
            <button type="button" className="btn-ghost" disabled={busy || q.trim().length < 3} onClick={() => void search()}>بحث</button>
            <button type="button" className="btn-ghost" onClick={locate}>📍 موقعي</button>
          </div>
          {results.length > 0 && (
            <ul className="panel divide-y divide-line overflow-hidden text-sm">
              {results.map((r) => (
                <li key={`${r.lat},${r.lng}`}><button type="button" className="w-full p-2.5 text-start hover:bg-line/60" onClick={() => { placeRef.current(toPin(r.lat, r.lng), 17); setResults([]) }}>{r.label}</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div ref={el} style={{ height }} className="panel overflow-hidden" />
      {!readOnly && <p className="mt-2 text-xs text-mute">اضغط على الخريطة أو اسحب الدبوس، وكبّر لحد ما الدبوس يبقى على المبنى بالظبط.</p>}
      {note && <p className="mt-1 text-sm text-danger" role="status">{note}</p>}
      {accuracy !== null && <p className="mt-1 text-sm text-mute" role="status">دقة التحديد حوالي {accuracy} متر{accuracy > 100 ? '. الدقة ضعيفة، اسحب الدبوس لمكان العقار بالظبط.' : '.'}</p>}
      {!readOnly && value && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <span dir="ltr" className="text-mute">{value.lat}, {value.lng}</span>
          <button type="button" className="text-danger underline" onClick={() => { markerRef.current?.remove(); markerRef.current = null; setAccuracy(null); cb.current?.(null) }}>إزالة الدبوس</button>
        </div>
      )}
      {readOnly && value && <a className="mt-2 inline-block text-sm text-nile underline" href={googleMapsUrl(value)} target="_blank" rel="noopener noreferrer">افتح الموقع في خرائط جوجل ↗</a>}
    </div>
  )
}

export default PinPicker
