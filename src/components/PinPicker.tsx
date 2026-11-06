import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { EGYPT_CENTER } from './MapView'

export interface Pin { lat: number; lng: number }
export const inEgypt = (p: Pin): boolean => p.lat >= 21.5 && p.lat <= 32 && p.lng >= 24.5 && p.lng <= 37

export function PinPicker({ value, onChange, readOnly = false, height = 280 }: { value: Pin | null; onChange?: (p: Pin | null) => void; readOnly?: boolean; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current).setView(value ? [value.lat, value.lng] : EGYPT_CENTER, value ? 15 : 6)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map)
    const icon = L.divIcon({ className: '', html: '<span style="font-size:28px;line-height:1">📍</span>', iconSize: [28, 28], iconAnchor: [14, 26] })
    mapRef.current = map
    if (value) markerRef.current = L.marker([value.lat, value.lng], { icon }).addTo(map)
    if (!readOnly) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        const p = { lat: Number(e.latlng.lat.toFixed(6)), lng: Number(e.latlng.lng.toFixed(6)) }
        if (!inEgypt(p)) return
        if (markerRef.current) markerRef.current.setLatLng(e.latlng)
        else markerRef.current = L.marker(e.latlng, { icon }).addTo(map)
        cb.current?.(p)
      })
    }
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly])

  return (
    <div>
      <div ref={el} style={{ height }} className="panel overflow-hidden" />
      {!readOnly && value && <button type="button" className="mt-2 text-sm text-danger" onClick={() => { markerRef.current?.remove(); markerRef.current = null; cb.current?.(null) }}>إزالة الدبوس</button>}
    </div>
  )
}

export default PinPicker
