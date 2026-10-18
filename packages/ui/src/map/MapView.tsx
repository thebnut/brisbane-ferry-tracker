/**
 * MapLibre GL 6 map on OpenFreeMap (keyless) with pulsing vehicle dots and mode pin shapes
 * (ferry circle, train square, bus diamond). Import from `@bft/ui/map` behind React.lazy: maplibre-gl is about
 * 250 KB gz and must never be on the first-load path.
 */
import 'maplibre-gl/dist/maplibre-gl.css'
import { Marker, Map as MlMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef } from 'react'

// MapLibre looks for its worker next to its module URL, which does not survive bundling; ship it as an asset.
setWorkerUrl(workerUrl)

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export type PinShape = 'circle' | 'square' | 'diamond'
export type MarkerTone = 'express' | 'allstops' | 'stop' | 'selected'

export interface MapMarker {
  id: string
  lat: number
  lon: number
  /** ferry = circle, train = square, bus = diamond. */
  shape?: PinShape
  tone?: MarkerTone
  /** Vehicles pulse; stops don't. */
  pulse?: boolean
  label: string
  onClick?: () => void
}

export interface MapViewProps {
  markers: MapMarker[]
  /** Fit to these markers (default: all). */
  fitTo?: string[]
  className?: string
  /** Accessible description of what the map shows. */
  label: string
}

const TONE_COLOUR: Record<MarkerTone, string> = {
  express: '#E55A2B',
  allstops: '#00A8CC',
  stop: '#FFFFFF',
  selected: '#FF6B35',
}

export function markerElement(m: MapMarker): HTMLElement {
  const el = document.createElement(m.onClick ? 'button' : 'div')
  const size = m.pulse ? 18 : 14
  const shape = m.shape ?? 'circle'
  const colour = TONE_COLOUR[m.tone ?? 'allstops']
  el.className = 'bft-marker'
  el.setAttribute('aria-label', m.label)
  el.title = m.label
  if (m.onClick) (el as HTMLButtonElement).type = 'button'
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    padding: '0',
    background: colour,
    border: m.tone === 'stop' ? '3px solid #1E7C80' : '2px solid #FFFFFF',
    borderRadius: shape === 'circle' ? '999px' : '3px',
    transform: shape === 'diamond' ? 'rotate(45deg)' : '',
    boxShadow: '0 1px 4px rgba(0,0,0,.35)',
    cursor: m.onClick ? 'pointer' : 'default',
  })
  if (m.pulse) {
    const ring = document.createElement('span')
    Object.assign(ring.style, {
      position: 'absolute',
      inset: '-6px',
      borderRadius: shape === 'circle' ? '999px' : '4px',
      background: colour,
      opacity: '0.35',
      animation: 'pulse-dot 2s ease-in-out infinite',
      pointerEvents: 'none',
    })
    el.style.position = 'relative'
    el.appendChild(ring)
  }
  if (m.onClick) el.addEventListener('click', m.onClick)
  return el
}

/** Bounds [[w,s],[e,n]] around the given points, or null for none. */
export function boundsOf(
  points: Array<{ lat: number; lon: number }>,
): [[number, number], [number, number]] | null {
  if (points.length === 0) return null
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const p of points) {
    w = Math.min(w, p.lon)
    e = Math.max(e, p.lon)
    s = Math.min(s, p.lat)
    n = Math.max(n, p.lat)
  }
  return [
    [w, s],
    [e, n],
  ]
}

export default function MapView({ markers, fitTo, className, label }: MapViewProps) {
  const container = useRef<HTMLElement>(null)
  const map = useRef<MlMap | null>(null)
  const placed = useRef<Marker[]>([])
  const fitted = useRef(false)

  useEffect(() => {
    if (!container.current) return
    const m = new MlMap({
      container: container.current,
      style: BASEMAP_STYLE_URL,
      center: [153.03, -27.47],
      zoom: 12,
      attributionControl: { compact: true },
    })
    map.current = m
    return () => {
      for (const mk of placed.current) mk.remove()
      placed.current = []
      m.remove()
      map.current = null
      fitted.current = false
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const mk of placed.current) mk.remove()
    placed.current = markers.map((mk) =>
      new Marker({ element: markerElement(mk) }).setLngLat([mk.lon, mk.lat]).addTo(m),
    )
    if (!fitted.current) {
      const pts = fitTo ? markers.filter((mk) => fitTo.includes(mk.id)) : markers
      const b = boundsOf(pts)
      if (b) {
        m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 })
        fitted.current = true
      }
    }
  }, [markers, fitTo])

  return (
    <section
      ref={container}
      aria-label={label}
      className={className ?? 'h-80 w-full overflow-hidden rounded-card bg-map-ground'}
    />
  )
}
