import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useNavigate } from 'react-router-dom'
import type { Unit } from '../lib/types'
import { fmtNum } from '../lib/format'

const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
export const EGYPT_CENTER: [number, number] = [26.8, 30.8]

export function MapView({ units, height = 480 }: { units: Unit[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current).setView(EGYPT_CENTER, 6)
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map)
    const pts: L.LatLngTuple[] = []
    for (const u of units) {
      if (u.lat == null || u.lng == null) continue
      const icon = L.divIcon({
        className: '',
        html: `<span style="background:#0B1B3A;color:#F4D98A;padding:2px 8px;border-radius:999px;font:600 12px Tahoma;white-space:nowrap;border:2px solid #D4A537;display:inline-block">${fmtNum(u.price)}</span>`,
        iconSize: [60, 24], iconAnchor: [30, 12],
      })
      const m = L.marker([u.lat, u.lng], { icon, title: u.title }).addTo(map)
      m.on('click', () => nav(`/unit/${u.id}`))
      pts.push([u.lat, u.lng])
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 })
    return () => { map.remove() }
  }, [units, nav])
  return <div ref={el} style={{ height }} className="panel overflow-hidden" role="region" aria-label="خريطة الوحدات" />
}

export default MapView
