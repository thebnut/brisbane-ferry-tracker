/**
 * /map (B-Map): every bus stop on a MapLibre map. There is no PMTiles stops archive from the pipeline yet, so the
 * stops layer is GeoJSON built from the geohash-5 tiles covering the visible area (zoom 14+, at most 16 tiles).
 * Scope toggle: around you (or `?lat=&lon=`) or your saved stops. Tap a stop for its board.
 */
import { useGeolocation } from '@bft/ui'
import { SegmentedControl } from '@bft/ui/bus'
import type { MapMarker, ViewBounds } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ClientOnly } from '../components/ClientOnly.tsx'
import { BusNav, DesktopNav, SiteHeader } from '../components/Shell.tsx'
import { at } from '../lib/base.ts'
import { cellsCovering, positionFromParams } from '../lib/geo.ts'
import { useGeoTiles } from '../lib/geo-queries.ts'
import { useApi } from '../lib/mode.ts'
import { useStopIndex } from '../lib/queries.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { getEnv } from '../lib/server.server.ts'
import { stopHref } from '../lib/stops.ts'
import { useSavedStops } from '../lib/storage.ts'
import type { Route } from './+types/map'

/** The site's own URL (inside BrisbaneTransit, its page there), for the canonical and OG tags. */
export function loader({ context }: Route.LoaderArgs) {
  return { siteUrl: getEnv(context)?.SITE_URL ?? SITE_URL }
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: 'Brisbane bus stop map | BrisbaneBus',
    description: 'Every Brisbane bus stop on a map. Tap a stop for its live departures.',
    url: `${loaderData?.siteUrl ?? SITE_URL}/map`,
    siteUrl: loaderData?.siteUrl,
  })

const CBD: [number, number] = [153.0235, -27.4705]
/** The map draws "you are here" itself (from `geolocation`); the stops are a layer. */
const NO_MARKERS: MapMarker[] = []

export default function MapPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const geolocation = useGeolocation(positionFromParams(params))
  const { geo } = geolocation
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
        {/* Left only: the map's own locate-me button (THE-112) sits top right. */}
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <SegmentedControl
            label="Map scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'near', label: geo.state === 'ok' ? 'Near me' : 'All stops' },
              { value: 'saved', label: 'My stops' },
            ]}
          />
        </div>
        <h1 className="sr-only">Bus stop map</h1>
        <ClientOnly fallback={<div className="h-full w-full animate-pulse bg-map-ground" />}>
          {() => (
            <SafeMap
              key={geo.state === 'ok' ? 'located' : 'default'}
              markers={NO_MARKERS}
              geolocation={geolocation}
              stops={stops}
              onStopClick={(id) => navigate(stopHref(id))}
              onViewChange={onView}
              center={center}
              zoom={15}
              fitTo={[]}
              label={`Map of ${stops.length} bus stops`}
              className="h-full w-full bg-map-ground"
              loading={<div className="h-full w-full animate-pulse bg-map-ground" />}
              unavailable={
                <p className="mt-2 flex gap-4 text-sm font-semibold">
                  <Link to={at('/nearby')} className="text-aqua-text underline">
                    Stops near you
                  </Link>
                  <Link to={at('/')} className="text-aqua-text underline">
                    Search stops
                  </Link>
                </p>
              }
            />
          )}
        </ClientOnly>
        {(scope === 'near' && (zoomedOut || tiles.error)) || (scope === 'saved' && index.isError) ? (
          <p
            role="status"
            className="absolute inset-x-0 bottom-24 z-10 mx-auto flex w-fit items-center gap-3 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-charcoal shadow-card md:bottom-6 dark:bg-night-card dark:text-night-text"
          >
            {scope === 'near' && zoomedOut ? (
              'Zoom in to see bus stops'
            ) : (
              <>
                Couldn't load stops
                <button
                  type="button"
                  onClick={scope === 'near' ? tiles.retry : index.retry}
                  className="text-ferry-orange-deep underline dark:text-ferry-sunset"
                >
                  Try again
                </button>
              </>
            )}
          </p>
        ) : null}
      </main>
      <BusNav active="map" />
    </>
  )
}
