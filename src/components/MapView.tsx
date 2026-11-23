import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useNavigate } from 'react-router-dom'
import type { Unit } from '../lib/types'
import { fmtNum, fmtPrice } from '../lib/format'
import { images } from '../lib/images'
import { EGYPT_CENTER, FALLBACK_TILES, clusterByGrid, tilesFor } from '../lib/mapUtils'

export { EGYPT_CENTER }

const CLUSTER_PX = 56 // price tags closer than this (on screen) become one numbered bubble
const MAX_CLUSTER_ZOOM = 17 // beyond this, listings in the same building cannot be split any further: show a list instead

type Go = (id: string) => void

/** Popup card for one listing. Built with DOM nodes and textContent (never HTML strings), so listing text can never inject markup. */
function card(u: Unit, go: Go): HTMLElement {
  const box = document.createElement('div')
  box.className = 'map-popup'
  if (u.images[0]) {
    const img = document.createElement('img')
    img.src = images.url(u.images[0], { w: 400, h: 240 }); img.alt = ''; img.loading = 'lazy'
    box.appendChild(img)
  }
  const title = document.createElement('strong'); title.textContent = u.title
  const price = document.createElement('span'); price.className = 'map-popup-price'; price.textContent = fmtPrice(u.price, u.rentType)
  const where = document.createElement('span'); where.textContent = [u.areaName, u.governorateName].filter(Boolean).join('، ')
  const link = document.createElement('a')
  link.href = `/unit/${u.id}`; link.textContent = 'عرض التفاصيل'
  link.addEventListener('click', (e) => { e.preventDefault(); go(u.id) })
  box.append(title, price, where, link)
  return box
}

function list(units: Unit[], go: Go): HTMLElement {
  const box = document.createElement('div'); box.className = 'map-popup'
  for (const u of units.slice(0, 8)) {
    const a = document.createElement('a')
    a.href = `/unit/${u.id}`; a.textContent = `${u.title} — ${fmtPrice(u.price, u.rentType)}`
    a.addEventListener('click', (e) => { e.preventDefault(); go(u.id) })
    box.appendChild(a)
  }
  return box
}

export function MapView({ units, height = 480 }: { units: Unit[]; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const go = useRef<Go>((id) => nav(`/unit/${id}`))
  go.current = (id) => nav(`/unit/${id}`)
  // Depend on what the listings ARE, not on the array identity: a parent that rebuilds the list on every render must not redraw the map and close popups.
  const sig = units.map((u) => `${u.id}|${u.lat}|${u.lng}|${u.price}`).join(';')
  const located = useMemo(() => units.filter((u) => u.lat != null && u.lng != null), [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = useRef<Unit[]>(located)
  current.current = located
  const mapRef = useRef<L.Map | null>(null)
  const draw = useRef<() => void>(() => undefined)
  const fitted = useRef('')

  // The map is created ONCE. (It used to be torn down and rebuilt every time the results changed, which flickered and lost the visitor's zoom.)
  useEffect(() => {
    if (!el.current) return
    const isDark = () => document.documentElement.classList.contains('dark')
    const map = L.map(el.current, { scrollWheelZoom: false }).setView(EGYPT_CENTER, 6)
    const t = tilesFor(isDark())
    const tiles = L.tileLayer(t.url, { attribution: t.attribution, maxZoom: t.maxZoom, subdomains: t.subdomains }).addTo(map)
    let errors = 0
    let fellBack = false
    tiles.on('tileerror', () => { errors += 1; if (errors >= 3 && !fellBack) { fellBack = true; tiles.setUrl(FALLBACK_TILES.url) } }) // CARTO unreachable: plain OpenStreetMap
    const theme = new MutationObserver(() => { if (!fellBack) tiles.setUrl(tilesFor(isDark()).url) })
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    L.control.scale({ imperial: false }).addTo(map)
    // The mouse wheel only zooms after the visitor clicks into the map, so scrolling down the page never gets stuck on it.
    map.on('click focus', () => map.scrollWheelZoom.enable())
    map.on('mouseout', () => map.scrollWheelZoom.disable())

    const layer = L.layerGroup().addTo(map)
    draw.current = () => {
      layer.clearLayers()
      const byId = new Map(current.current.map((u) => [u.id, u]))
      const pts = current.current.map((u) => { const p = map.latLngToLayerPoint([u.lat as number, u.lng as number]); return { id: u.id, x: p.x, y: p.y } })
      for (const c of clusterByGrid(pts, CLUSTER_PX)) {
        const members = c.ids.flatMap((id) => { const u = byId.get(id); return u ? [u] : [] })
        const first = members[0]
        if (!first) continue
        if (members.length === 1) {
          const icon = L.divIcon({ className: 'map-pin', html: `<span class="map-pill">${fmtNum(first.price)}</span>`, iconSize: [0, 0] })
          L.marker([first.lat as number, first.lng as number], { icon, title: first.title, alt: first.title, keyboard: true }).addTo(layer).bindPopup(card(first, go.current), { maxWidth: 260, minWidth: 210 })
        } else {
          const lat = members.reduce((s, u) => s + (u.lat as number), 0) / members.length
          const lng = members.reduce((s, u) => s + (u.lng as number), 0) / members.length
          const icon = L.divIcon({ className: 'map-pin', html: `<span class="map-cluster">${fmtNum(members.length)}</span>`, iconSize: [0, 0] })
          const m = L.marker([lat, lng], { icon, title: `${members.length}`, keyboard: true }).addTo(layer)
          if (map.getZoom() >= MAX_CLUSTER_ZOOM) m.bindPopup(list(members, go.current), { maxWidth: 280 })
          else m.on('click', () => map.fitBounds(L.latLngBounds(members.map((u) => [u.lat as number, u.lng as number] as L.LatLngTuple)), { padding: [50, 50], maxZoom: 18 }))
        }
      }
    }
    map.on('zoomend', () => draw.current())
    mapRef.current = map
    return () => { theme.disconnect(); map.remove(); mapRef.current = null; draw.current = () => undefined }
  }, [])

  // Results changed: redraw the markers, and move the view only when the SET of listings is different (not on every re-render).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    draw.current()
    const key = located.map((u) => u.id).sort().join(',')
    if (key !== fitted.current && located.length > 0) {
      fitted.current = key
      map.fitBounds(L.latLngBounds(located.map((u) => [u.lat as number, u.lng as number] as L.LatLngTuple)), { padding: [40, 40], maxZoom: 16 })
    }
  }, [located])

  const missing = units.length - located.length
  return (
    <div>
      <div ref={el} style={{ height }} className="panel overflow-hidden" role="region" aria-label="خريطة الوحدات" />
      <p className="mt-2 text-sm text-mute" role="status">
        {located.length > 0 ? `${fmtNum(located.length)} وحدة على الخريطة` : 'مفيش وحدات ليها موقع محدد على الخريطة في النتائج دي'}
        {missing > 0 && located.length > 0 ? ` — و${fmtNum(missing)} وحدة من غير موقع محدد مش ظاهرة هنا` : ''}
      </p>
    </div>
  )
}

export default MapView
