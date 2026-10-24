/**
 * /map (B-Map, ?stop=, ?route=&trip=, ?lat=&lon=): every bus stop on the shared map page (THE-118 PR 9). There is no
 * PMTiles stops archive from the pipeline yet, so the stops layer is GeoJSON built from the geohash-5 tiles covering
 * the visible area, only from zoom 14 (at most 16 tiles): at city zoom the thousands of stops aren't drawn, and the page
 * says "Zoom in to see bus stops". Scope toggle: around you (or `?lat=&lon=`) or your saved stops. Tap a stop for its
 * board.
 *
 * A stop board's Map chip opens it on that stop with the buses heading there (`?stop=`); a trip's "Track on map"
 * follows that bus among its route's live buses (`?route=&trip=`). Bus positions are live claims: shown only while
 * their own answer is live and fresh, and only then does the header say LIVE ("Connecting…" until it arrives).
 * Without a stop or a route there are no positions, and the header claims nothing.
 */
import { useGeolocation } from '@bft/ui'
import { SegmentedControl } from '@bft/ui/bus'
import { liveState, pagePending, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker, ViewBounds } from '@bft/ui/map'
import { MAP_BOX, MapCard, MapLegend, MapPageShell } from '@bft/ui/map-page'
import SafeMap from '@bft/ui/safe-map'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { BusNav, DesktopNav, SiteHeader } from '../components/Shell.tsx'
import { at } from '../lib/base.ts'
import { cellsCovering, positionFromParams } from '../lib/geo.ts'
import { useGeoTiles } from '../lib/geo-queries.ts'
import { useApi } from '../lib/mode.ts'
import { departuresOptions, useStopIndex } from '../lib/queries.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { getEnv } from '../lib/server.server.ts'
import { routeShortOf, stopHref, tripHref } from '../lib/stops.ts'
import { useSavedStops } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { useVehicles } from '../lib/vehicles.ts'
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
/** Stops are drawn from this zoom (city zoom shows none: the tiles would be thousands of stops). */
export const STOPS_FROM_ZOOM = 14
const ROUTE_RE = /^[\w-]{1,12}$/

export default function MapPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const fixed = positionFromParams(params)
  const geolocation = useGeolocation(fixed)
  const { geo } = geolocation
  const stopId = params.get('stop')
  const route = ROUTE_RE.test(params.get('route') ?? '') ? params.get('route') : null
  const trip = route ? params.get('trip') : null
  const [scope, setScope] = useState<'near' | 'saved'>('near')
  const [cells, setCells] = useState<string[]>([])
  const [zoomedOut, setZoomedOut] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const { mode, fetcher } = useApi()
  const tiles = useGeoTiles(fetcher, mode, scope === 'near' ? cells : [])
  const saved = useSavedStops()
  const index = useStopIndex(fetcher, mode, scope === 'saved' || !!stopId)
  const focus = stopId ? index.byKey.get(stopId) : undefined

  // The route's live buses ("Track on map"), or on a stop the buses heading there: live claims like any board's
  // (R32-RT1).
  const vehicles = useVehicles(fetcher, mode, route, !!route || !!stopId)
  const departures = useQuery({
    ...departuresOptions(fetcher, mode, stopId ?? '', null),
    enabled: !route && !!stopId,
  })
  const nowMs = useNow(Date.now())
  const state = liveState(vehicles.data, { offline: !useOnline(), nowMs, ...usePageCheck() })
  // And no failed request since (React Query keeps the last answer after a failure, retries included).
  const fresh = vehicles.data != null && state == null && !vehicles.isError && vehicles.failureCount === 0
  // A stop's buses are picked by its departures: while that request has failed the page can't tell which buses those
  // are, which is never "none" and never LIVE.
  const filtering = !route && !!stopId
  const filterFailed = filtering && (departures.isError || departures.failureCount > 0)
  const live = fresh && !filterFailed
  const data = vehicles.data
  const trips = departures.data?.departures
  const buses = useMemo(() => {
    if (!fresh || filterFailed) return []
    const all = data?.vehicles ?? []
    if (route) return all
    const heading = new Set((trips ?? []).map((d) => d.tripInstance))
    return all.filter((v) => v.tripKey && heading.has(v.tripKey))
  }, [fresh, filterFailed, data, route, trips])
  /** Which buses the page shows: the route's, or those heading to the stop. */
  const which = route ? `on route ${route}` : focus ? `heading to ${focus.name}` : ''
  const withBuses = !!route || !!stopId
  const tracked = trip ? (buses.find((v) => v.tripKey === trip) ?? null) : null

  const stops = useMemo(() => {
    // City zoom: no stops at all, not the last street's (they stay cached for zooming back in).
    if (scope === 'near' && zoomedOut) return []
    if (scope === 'saved')
      return saved
        .map((s) => index.byKey.get(s.id))
        .filter((s) => !!s)
        .map((s) => ({ id: s.key, lat: s.lat, lon: s.lon, name: s.name }))
    return tiles.tiles.flatMap((t) =>
      t.stops.map((s) => ({ id: s.key, lat: s.lat, lon: s.lon, name: s.name })),
    )
  }, [scope, zoomedOut, saved, index.byKey, tiles.tiles])
  const center: [number, number] = geo.state === 'ok' ? [geo.lon, geo.lat] : CBD
  const fLat = fixed?.lat
  const fLon = fixed?.lon
  const markers = useMemo<MapMarker[]>(
    () => [
      ...(fLat != null && fLon != null
        ? [
            {
              id: 'here',
              lat: fLat,
              lon: fLon,
              tone: 'you' as const,
              pulse: true,
              label: 'Showing stops around here',
            },
          ]
        : []),
      ...(focus
        ? [
            {
              id: `stop:${focus.key}`,
              lat: focus.lat,
              lon: focus.lon,
              shape: 'diamond' as const,
              tone: 'selected' as const,
              label: focus.name,
              onClick: () => navigate(stopHref(focus.key)),
            },
          ]
        : []),
      ...buses.map((v) => ({
        id: `v:${v.id}`,
        lat: v.lat,
        lon: v.lon,
        shape: 'diamond' as const,
        pulse: true,
        tone: v === tracked ? ('selected' as const) : ('allstops' as const),
        label: `${v.label ? `Bus ${v.label}` : 'Bus'}${v.routeId ? ` on route ${routeShortOf(v.routeId)}` : ''}${v === tracked ? ', your trip' : ''}`,
        onClick: () => setSelected(v.id),
      })),
    ],
    [fLat, fLon, focus, buses, tracked, navigate],
  )
  // The followed bus once its position is in, else the stop the board opened the map on.
  const fitTo = useMemo(
    () => (tracked ? [`v:${tracked.id}`] : focus ? [`stop:${focus.key}`] : []),
    [tracked, focus],
  )
  const onView = (b: ViewBounds, zoom: number) => {
    const c = zoom >= STOPS_FROM_ZOOM ? cellsCovering(b) : null
    setZoomedOut(!c)
    if (c) setCells(c)
  }
  const sel = buses.find((v) => v.id === selected) ?? (selected == null ? tracked : null)
  const stopsFailed = (scope === 'near' && tiles.error) || (scope === 'saved' && index.isError)
  const status =
    // Live claims first: a failed position or filter request is never hidden behind a map hint.
    withBuses && (vehicles.isError || (vehicles.data && !fresh)) ? (
      'Live positions are unavailable right now.'
    ) : filterFailed ? (
      <>
        Can't tell which buses are heading to {focus?.name ?? 'this stop'} right now.
        <button
          type="button"
          onClick={() => departures.refetch()}
          className="min-h-11 text-ferry-orange-deep underline dark:text-ferry-sunset"
        >
          Try again
        </button>
      </>
    ) : scope === 'near' && zoomedOut ? (
      'Zoom in to see bus stops'
    ) : stopsFailed ? (
      <>
        Couldn't load stops
        <button
          type="button"
          onClick={scope === 'near' ? tiles.retry : index.retry}
          className="min-h-11 text-ferry-orange-deep underline dark:text-ferry-sunset"
        >
          Try again
        </button>
      </>
    ) : trip && vehicles.data && !tracked ? (
      "Your bus isn't sending its position right now."
    ) : null

  return (
    <>
      <SiteHeader
        live={withBuses ? live : undefined}
        pending={
          withBuses
            ? pagePending([{ q: vehicles, state }, ...(filtering ? [{ q: departures, state: null }] : [])])
            : false
        }
        back={focus ? { href: stopHref(focus.key), label: focus.name } : undefined}
      >
        <DesktopNav active="map" />
      </SiteHeader>
      <MapPageShell
        mode="bus"
        title={route ? `Live buses on route ${route}` : focus ? `Bus map: ${focus.name}` : 'Bus stop map'}
        bottomBar
        // Left only: the map's own locate-me button (THE-112) sits top right.
        controls={
          <SegmentedControl
            label="Map scope"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'near', label: geo.state === 'ok' ? 'Near me' : 'All stops' },
              { value: 'saved', label: 'My stops' },
            ]}
          />
        }
        status={status}
        card={
          sel ? (
            <MapCard>
              <p className="text-base font-bold">
                Route {routeShortOf(sel.routeId ?? '') || route}
                {sel === tracked ? <span className="font-semibold text-sched-text"> · your trip</span> : null}
              </p>
              {sel.label ? (
                <p className="text-[13px] text-gray-600 dark:text-night-text/70">Bus {sel.label}</p>
              ) : null}
              {sel.tripKey ? (
                <Link
                  to={tripHref(sel.tripKey, sel === tracked ? stopId : null)}
                  className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-ferry-orange-deep underline dark:text-ferry-sunset"
                >
                  View trip
                </Link>
              ) : null}
            </MapCard>
          ) : null
        }
        legend={
          <MapLegend
            shape="diamond"
            items={[
              ...(withBuses ? [{ label: route ? `Route ${route}` : 'Bus', tone: 'vehicle' as const }] : []),
              { label: 'Stop', tone: 'stop' },
            ]}
          >
            <span data-map-count="" className="font-normal text-sched-text dark:text-night-text/70">
              {filterFailed
                ? null
                : withBuses
                  ? `${buses.length} with live positions`
                  : `${stops.length} stops shown`}
            </span>
          </MapLegend>
        }
      >
        <SafeMap
          key={geo.state === 'ok' ? 'located' : 'default'}
          markers={markers}
          // ?lat=&lon= isn't the device: the map's own locate-me finds that (THE-112).
          geolocation={fixed ? undefined : geolocation}
          stops={stops}
          onStopClick={(id) => navigate(stopHref(id))}
          onViewChange={onView}
          center={center}
          zoom={15}
          fitTo={fitTo}
          // The stop's place and the followed bus arrive after the map starts: fit again once each does.
          fitKey={tracked ? `v:${tracked.id}` : (focus?.key ?? '')}
          // And keep it in view as it moves.
          follow={tracked ? [tracked.lon, tracked.lat] : null}
          label={
            withBuses
              ? `Map of ${buses.length} live buses ${which}`.trim()
              : `Map of ${stops.length} bus stops`
          }
          className={MAP_BOX}
          loading={<div className={`${MAP_BOX} animate-pulse`} />}
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
      </MapPageShell>
      <BusNav active="map" />
    </>
  )
}
