/**
 * THE-112: the locate-me button every map gets (MapView mounts it, so SafeMap and the stop pickers do too). It lives in
 * the lazy map chunk only. A tap asks for the device's position (the browser prompt appears only then; an
 * already-granted permission may locate on mount, via useGeolocation) and frames the map on it; a position found
 * without a tap shows the "you are here" dot and accuracy circle but never moves the map, so maps framed around a
 * route or stop stay put. Denied and unavailable (or timed out) answers show a short line under the button.
 */
import { type GeoJSONSource, type IControl, Marker, type Map as MlMap } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type GeoState, useGeolocation } from '../geolocation.ts'
import { Icon } from '../icons.tsx'

/** A caller's own geolocation (its `useGeolocation()`), so the map shares its position instead of asking again. */
export interface GeoSource {
  geo: GeoState
  locate: () => void
}

export const YOU_COLOUR = '#0066CC'
const ACCURACY = 'bft-you-accuracy'
const EMPTY = { type: 'FeatureCollection', features: [] } as const

/** A circle of `metres` around a point, as a 48-sided polygon (good enough at map scale). */
export function accuracyCircle(
  lat: number,
  lon: number,
  metres: number,
): Parameters<GeoJSONSource['setData']>[0] {
  const dLat = metres / 111_320
  const dLon = metres / (111_320 * Math.cos((lat * Math.PI) / 180))
  const ring: Array<[number, number]> = []
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

/** Frame the position and its accuracy (at least 150 m around it), no closer than zoom 16. */
export function frameOn(map: MlMap, lat: number, lon: number, accuracy: number | null): void {
  const r = Math.max(accuracy ?? 0, 150)
  const dLat = r / 111_320
  const dLon = r / (111_320 * Math.cos((lat * Math.PI) / 180))
  map.fitBounds(
    [
      [lon - dLon, lat - dLat],
      [lon + dLon, lat + dLat],
    ],
    { padding: 48, maxZoom: 16 },
  )
}

function youElement(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('aria-label', 'You are here')
  el.setAttribute('data-you', '')
  el.title = 'You are here'
  // No `position`: MapLibre makes markers absolute (see markerElement in MapView.tsx).
  Object.assign(el.style, {
    width: '18px',
    height: '18px',
    borderRadius: '999px',
    background: YOU_COLOUR,
    border: '3px solid #FFFFFF',
    boxShadow: '0 1px 4px rgba(0,0,0,.35)',
    boxSizing: 'border-box',
  })
  const ring = document.createElement('span')
  Object.assign(ring.style, {
    position: 'absolute',
    inset: '-7px',
    borderRadius: '999px',
    background: YOU_COLOUR,
    opacity: '0.3',
    animation: 'pulse-dot 2s ease-in-out infinite',
    pointerEvents: 'none',
  })
  el.appendChild(ring)
  return el
}

/**
 * What the line under the button says after a tap, or null. A timeout and no position at all read the same (the shared
 * hook reports both as `unavailable`, and telling them apart would grow every page's first load), with Try again.
 */
export function locateMessage(geo: GeoState): string | null {
  if (geo.state === 'denied') return 'Location is off. Allow it in your browser settings.'
  if (geo.state === 'unavailable') return "Couldn't find your location."
  return null
}

function Control({ map, ready, geo, locate }: { map: MlMap; ready: boolean } & GeoSource) {
  const [host] = useState(() => {
    const el = document.createElement('div')
    el.className = 'maplibregl-ctrl'
    return el
  })
  useEffect(() => {
    const ctrl: IControl = { onAdd: () => host, onRemove: () => host.remove() }
    map.addControl(ctrl, 'top-right')
    return () => {
      // The map may already be gone (MapView removes it on unmount).
      try {
        map.removeControl(ctrl)
      } catch {
        host.remove()
      }
    }
  }, [map, host])

  // Only a tap moves the map, once its answer arrives; the message shows only after a tap, too.
  const [asked, setAsked] = useState(false)
  const flyOnFix = useRef(false)
  const tap = () => {
    setAsked(true)
    flyOnFix.current = true
    locate()
  }
  useEffect(() => {
    if (geo.state === 'ok' && flyOnFix.current) frameOn(map, geo.lat, geo.lon, geo.accuracy)
    if (geo.state !== 'locating' && geo.state !== 'idle') flyOnFix.current = false
  }, [map, geo])

  useEffect(() => {
    if (geo.state !== 'ok') return
    const marker = new Marker({ element: youElement() }).setLngLat([geo.lon, geo.lat]).addTo(map)
    return () => {
      marker.remove()
    }
  }, [map, geo])

  // The accuracy circle: a fill layer (so it scales with the zoom) under the route line and stops, and the markers.
  useEffect(() => {
    if (!ready) return
    const data = geo.state === 'ok' && geo.accuracy ? accuracyCircle(geo.lat, geo.lon, geo.accuracy) : EMPTY
    const src = map.getSource(ACCURACY) as GeoJSONSource | undefined
    if (src) return void src.setData(data)
    map.addSource(ACCURACY, { type: 'geojson', data })
    map.addLayer(
      {
        id: ACCURACY,
        type: 'fill',
        source: ACCURACY,
        paint: { 'fill-color': YOU_COLOUR, 'fill-opacity': 0.12, 'fill-outline-color': YOU_COLOUR },
      },
      map.getLayer('bft-line-casing') ? 'bft-line-casing' : undefined,
    )
  }, [map, ready, geo])

  const busy = geo.state === 'locating'
  const message = asked ? locateMessage(geo) : null
  return createPortal(
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={tap}
        disabled={busy}
        aria-busy={busy}
        aria-label={busy ? 'Finding your location…' : 'Show my location'}
        title={busy ? 'Finding your location…' : 'Show my location'}
        data-locate-me=""
        className="flex size-11 items-center justify-center rounded-full border border-ferry-orange/30 bg-white text-aqua-text shadow-card disabled:cursor-wait dark:bg-night-card dark:text-ferry-aqua-light"
      >
        {busy ? (
          <span className="box-border size-5 rounded-full border-[3px] border-ferry-orange-light border-t-ferry-orange motion-safe:animate-spin" />
        ) : (
          <Icon name="locate" size={20} />
        )}
      </button>
      {message ? (
        <p
          role="status"
          className="flex max-w-60 flex-col items-end gap-1 rounded-card bg-white/95 px-3 py-2 text-right text-xs font-semibold text-charcoal shadow-card dark:bg-night-card dark:text-night-text"
        >
          {message}
          {geo.state === 'unavailable' ? (
            <button
              type="button"
              onClick={tap}
              className="min-h-11 px-1 text-ferry-orange-deep underline dark:text-ferry-sunset"
            >
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
    </div>,
    host,
  )
}

/** The map's own geolocation, when the caller has none to share. */
function OwnGeo(props: { map: MlMap; ready: boolean }) {
  const { geo, locate } = useGeolocation()
  return <Control {...props} geo={geo} locate={locate} />
}

export default function LocateControl({
  source,
  ...props
}: {
  map: MlMap
  /** Ready for layers (the style has loaded). The button shows before that. */
  ready: boolean
  source?: GeoSource
}) {
  return source ? <Control {...props} {...source} /> : <OwnGeo {...props} />
}
