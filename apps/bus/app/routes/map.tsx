/**
 * /map (B-Map): every bus stop on a MapLibre map. There is no PMTiles stops archive from the pipeline yet, so the
 * stops layer is GeoJSON built from the geohash-5 tiles covering the visible area (zoom 14+, at most 16 tiles).
 * Scope toggle: around you (or `?lat=&lon=`) or your saved stops. Tap a stop for its board.
 */
import { Icon, SegmentedControl } from '@bft/ui'
import type { ViewBounds } from '@bft/ui/map'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ClientOnly } from '../components/ClientOnly.tsx'
import { BusNav, DesktopNav, SiteHeader } from '../components/Shell.tsx'
import { cellsCovering } from '../lib/geo.ts'
import { useApi } from '../lib/mode.ts'
import { useGeoTiles, useStopIndex } from '../lib/queries.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { stopPath } from '../lib/stops.ts'
import { useSavedStops } from '../lib/storage.ts'
import type { Route } from './+types/map'
import { useGeolocation } from './nearby.tsx'

const MapView = lazy(() => import('@bft/ui/map'))

export const meta: Route.MetaFunction = () =>
  pageMeta({
    title: 'Brisbane bus stop map | BrisbaneBus',
    description: 'Every Brisbane bus stop on a map. Tap a stop for its live departures.',
    url: `${SITE_URL}/map`,
  })

const CBD: [number, number] = [153.0235, -27.4705]

export default function MapPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { geo, locate } = useGeolocation(params)
  const [scope, setScope] = useState<'near' | 'saved'>('near')
  const [cells, setCells] = useState<string[]>([])
  const [zoomedOut, setZoomedOut] = useState(false)
  const { mode, fetcher } = useApi()
  const tiles = useGeoTiles(fetcher, mode, scope === 'near' ? cells : [])
  const saved = useSavedStops()
  const index = useStopIndex(fetcher, mode, scope === 'saved')
  const stops = useMemo(() => {
    if (scope === 'saved')
      return saved
        .map((s) => index.byKey.get(s.id))
        .filter((s) => !!s)
        .map((s) => ({ id: s.key, lat: s.lat, lon: s.lon, name: s.name }))
    return tiles.tiles.flatMap((t) =>
      t.stops.map((s) => ({ id: s.key, lat: s.lat, lon: s.lon, name: s.name })),
    )
  }, [scope, saved, index.byKey, tiles.tiles])
  const center: [number, number] = geo.state === 'ok' ? [geo.lon, geo.lat] : CBD
  const me =
    geo.state === 'ok'
      ? [
          {
            id: 'me',
            lat: geo.lat,
            lon: geo.lon,
            tone: 'allstops' as const,
            pulse: true,
            label: 'You are here',
          },
        ]
      : []
  const onView = (b: ViewBounds, zoom: number) => {
    const c = zoom >= 14 ? cellsCovering(b) : null
    setZoomedOut(!c)
    if (c) setCells(c)
  }
  return (
    <>
      <SiteHeader>
        <DesktopNav active="map" />
      </SiteHeader>
      <main className="relative h-[calc(100dvh-74px)] md:h-[calc(100dvh-120px)]">
        <div className="absolute inset-x-3 top-3 z-10 flex items-center gap-2">
          <SegmentedControl
            label="Map scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'near', label: geo.state === 'ok' ? 'Near me' : 'All stops' },
              { value: 'saved', label: 'My stops' },
            ]}
          />
          <button
            type="button"
            onClick={locate}
            aria-label="Centre on my location"
            className="ml-auto flex size-11 items-center justify-center rounded-full border border-ferry-orange/20 bg-white text-aqua-text shadow-card dark:bg-night-card"
          >
            <Icon name="locate" size={20} />
          </button>
        </div>
        <h1 className="sr-only">Bus stop map</h1>
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-map-ground" />}>
          {() => (
            <Suspense fallback={<div className="h-full w-full animate-pulse bg-map-ground" />}>
              <MapView
                key={geo.state === 'ok' ? 'located' : 'default'}
                markers={me}
                stops={stops}
                onStopClick={(id) => navigate(stopPath(id))}
                onViewChange={onView}
                center={center}
                zoom={15}
                fitTo={[]}
                label={`Map of ${stops.length} bus stops`}
                className="h-full w-full bg-map-ground"
              />
            </Suspense>
          )}
        </ClientOnly>
        {scope === 'near' && zoomedOut ? (
          <p className="absolute inset-x-0 bottom-24 z-10 mx-auto w-fit rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-charcoal shadow-card md:bottom-6 dark:bg-night-card dark:text-night-text">
            Zoom in to see bus stops
          </p>
        ) : null}
      </main>
      <BusNav active="map" />
    </>
  )
}
