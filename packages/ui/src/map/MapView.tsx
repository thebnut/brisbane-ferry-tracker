/**
 * MapLibre GL 6 map on OpenFreeMap (keyless) with pulsing vehicle dots and mode pin shapes
 * (ferry circle, train square, bus diamond). Import from `@bft/ui/map` behind React.lazy: maplibre-gl is about
 * 250 KB gz and must never be on the first-load path.
 */
import 'maplibre-gl/dist/maplibre-gl.css'
import { type GeoJSONSource, Marker, Map as MlMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { useEffect, useRef, useState } from 'react'

// MapLibre looks for its worker next to its module URL, which does not survive bundling; ship it as an asset.
setWorkerUrl(workerUrl)

export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'

export type PinShape = 'circle' | 'square' | 'diamond'
/** Vehicles (express, allstops), stops, a selection, the three modes (Around you) and your position. */
export type MarkerTone = 'express' | 'allstops' | 'stop' | 'selected' | 'ferry' | 'train' | 'bus' | 'you'

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

/** A stop drawn in the GeoJSON stops layer (thousands are fine; DOM markers are for a few dozen). */
export interface MapStop {
  id: string
  lat: number
  lon: number
  name: string
}

export interface ViewBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface MapViewProps {
  markers: MapMarker[]
  /** Fit to these markers (default: all). */
  fitTo?: string[]
  className?: string
  /** Accessible description of what the map shows. */
  label: string
  /**
   * Stops layer: bus diamonds (or `stopShape`) as a GeoJSON symbol layer, labelled from zoom 16. Used for the
   * visible geohash tiles on the bus map (no PMTiles archive is published yet).
   */
  stops?: MapStop[]
  stopShape?: PinShape
  onStopClick?: (id: string) => void
  /** Route line [lon, lat][] in `lineColor` (hex without #). */
  line?: Array<[number, number]>
  lineColor?: string
  /** Called after the map settles (move/zoom end) with the visible bounds. */
  onViewChange?: (bounds: ViewBounds, zoom: number) => void
  /** Initial view when there is nothing to fit to. */
  center?: [number, number]
  zoom?: number
  /** Fit to the line or markers only once (default), or every time they change. */
  refit?: boolean
  /** Once the style and the built-in layers are loaded, for callers that add their own (the stop picker's clusters). */
  onReady?: (map: MlMap) => void
}

const TONE_COLOUR: Record<MarkerTone, string> = {
  express: '#E55A2B',
  allstops: '#00A8CC',
  stop: '#FFFFFF',
  selected: '#FF6B35',
  ferry: '#00A8CC',
  train: '#1E7C80',
  bus: '#E55A2B',
  you: '#0066CC',
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
  const face = {
    background: colour,
    border: m.tone === 'stop' ? '3px solid #1E7C80' : '2px solid #FFFFFF',
    borderRadius: shape === 'circle' ? '999px' : '3px',
    boxShadow: '0 1px 4px rgba(0,0,0,.35)',
  }
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    padding: '0',
    cursor: m.onClick ? 'pointer' : 'default',
    // MapLibre positions markers with the element's own transform, so a diamond rotates an inner face instead.
    ...(shape === 'diamond' ? { background: 'transparent', border: '0' } : face),
  })
  if (shape === 'diamond') {
    const inner = document.createElement('span')
    Object.assign(inner.style, {
      position: 'absolute',
      inset: '1px',
      boxSizing: 'border-box',
      transform: 'rotate(45deg)',
      ...face,
    })
    el.style.position = 'relative'
    el.appendChild(inner)
  }
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

/** Pin image for the stops layer: a white diamond/square/circle with a teal border, drawn on a canvas. */
function pinImage(shape: PinShape, size = 22): ImageData | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const g = c.getContext('2d')
  if (!g) return null
  const h = size / 2
  g.fillStyle = '#FFFFFF'
  g.strokeStyle = '#1E7C80'
  g.lineWidth = 3
  g.beginPath()
  if (shape === 'diamond') {
    g.moveTo(h, 2)
    g.lineTo(size - 2, h)
    g.lineTo(h, size - 2)
    g.lineTo(2, h)
    g.closePath()
  } else if (shape === 'square') g.rect(3, 3, size - 6, size - 6)
  else g.arc(h, h, h - 3, 0, Math.PI * 2)
  g.fill()
  g.stroke()
  return g.getImageData(0, 0, size, size)
}

type GeoData = Parameters<GeoJSONSource['setData']>[0]

const stopsGeoJson = (stops: MapStop[]): GeoData => ({
  type: 'FeatureCollection',
  features: stops.map((s) => ({
    type: 'Feature',
    id: s.id,
    properties: { id: s.id, name: s.name },
    geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
  })),
})

const lineGeoJson = (line: Array<[number, number]>): GeoData => ({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: line },
})

export default function MapView({
  markers,
  fitTo,
  className,
  label,
  stops,
  stopShape = 'diamond',
  onStopClick,
  line,
  lineColor,
  onViewChange,
  center = [153.03, -27.47],
  zoom = 12,
  refit = false,
  onReady,
}: MapViewProps) {
  const container = useRef<HTMLElement>(null)
  const map = useRef<MlMap | null>(null)
  const placed = useRef<Marker[]>([])
  const fitted = useRef(false)
  const [ready, setReady] = useState(false)
  const handlers = useRef({ onStopClick, onViewChange, onReady })
  handlers.current = { onStopClick, onViewChange, onReady }

  // biome-ignore lint/correctness/useExhaustiveDependencies: the map is created once; later props flow through effects.
  useEffect(() => {
    if (!container.current) return
    const m = new MlMap({
      container: container.current,
      style: BASEMAP_STYLE_URL,
      center,
      zoom,
      attributionControl: { compact: true },
    })
    map.current = m
    const report = () => {
      const b = m.getBounds()
      handlers.current.onViewChange?.(
        { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
        m.getZoom(),
      )
    }
    m.on('load', () => {
      const img = pinImage(stopShape)
      if (img) m.addImage('bft-stop', img, { pixelRatio: 1 })
      m.addSource('bft-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'bft-line-casing',
        type: 'line',
        source: 'bft-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#FFFFFF', 'line-width': 9 },
      })
      m.addLayer({
        id: 'bft-line',
        type: 'line',
        source: 'bft-line',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#1E7C80', 'line-width': 5 },
      })
      m.addSource('bft-stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({
        id: 'bft-stops',
        type: 'symbol',
        source: 'bft-stops',
        layout: {
          'icon-image': 'bft-stop',
          'icon-allow-overlap': true,
          'text-field': ['step', ['zoom'], '', 16, ['get', 'name']],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': '#2D3436', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.5 },
      })
      m.on('click', 'bft-stops', (e) => {
        const id = e.features?.[0]?.properties?.id
        if (typeof id === 'string') handlers.current.onStopClick?.(id)
      })
      m.on('mouseenter', 'bft-stops', () => {
        m.getCanvas().style.cursor = 'pointer'
      })
      m.on('mouseleave', 'bft-stops', () => {
        m.getCanvas().style.cursor = ''
      })
      handlers.current.onReady?.(m)
      setReady(true)
      report()
    })
    m.on('moveend', report)
    return () => {
      for (const mk of placed.current) mk.remove()
      placed.current = []
      m.remove()
      map.current = null
      fitted.current = false
      setReady(false)
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m) return
    for (const mk of placed.current) mk.remove()
    placed.current = markers.map((mk) =>
      new Marker({ element: markerElement(mk) }).setLngLat([mk.lon, mk.lat]).addTo(m),
    )
    if (!fitted.current || refit) {
      const pts = line?.length
        ? line.map(([lon, lat]) => ({ lat, lon }))
        : fitTo
          ? markers.filter((mk) => fitTo.includes(mk.id))
          : markers
      const b = boundsOf(pts)
      if (b) {
        m.fitBounds(b, { padding: 48, maxZoom: 15, duration: 0 })
        fitted.current = true
      }
    }
  }, [markers, fitTo, line, refit])

  useEffect(() => {
    const src = ready ? (map.current?.getSource('bft-stops') as GeoJSONSource | undefined) : undefined
    src?.setData(stopsGeoJson(stops ?? []))
  }, [ready, stops])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource('bft-line') as GeoJSONSource | undefined)?.setData(
      line?.length ? lineGeoJson(line) : { type: 'FeatureCollection', features: [] },
    )
    if (lineColor) m.setPaintProperty('bft-line', 'line-color', `#${lineColor}`)
  }, [ready, line, lineColor])

  return (
    <section
      ref={container}
      aria-label={label}
      className={className ?? 'h-80 w-full overflow-hidden rounded-card bg-map-ground'}
    />
  )
}
