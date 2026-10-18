/**
 * /map (?station=): live trains on the network map (T-Map). MapLibre is lazy (about 280 KB gz, never on first load);
 * stations are white square pins, trains pulsing squares (express orange, all stops teal) from /v1/train/vehicles,
 * polled every 15 s. Tapping a train shows its service with a link to the stopping pattern.
 */
import type { Vehicle } from '@bft/core/contract'
import { LineChip, StatusBadge } from '@bft/ui'
import type { MapMarker } from '@bft/ui/map'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Shell } from '../components/Chrome.tsx'
import { at } from '../lib/base.ts'
import { lineLabel } from '../lib/lineNames.ts'
import { cleanStopName } from '../lib/names.ts'
import { lineFor, STATIONS, type Station, stationByKey, stationKeyOfStop } from '../lib/network.ts'
import { useFetcher, useTrip, useVehicles } from '../lib/queries.ts'
import { pageMeta } from '../lib/seo.ts'
import { getEnv, isFixtureMode, siteInfo } from '../lib/server.server.ts'
import { vehicleStatusText } from '../lib/trip.ts'
import { useMounted } from '../lib/useNow.ts'
import type { Route } from './+types/map'

// Client-only: the map never renders on the server, and keeping MapLibre out of the Worker bundle keeps it small.
const MapView = lazy(() => (import.meta.env.SSR ? new Promise<never>(() => {}) : import('@bft/ui/map')))

export function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context)
  const url = new URL(request.url)
  const fixtures = isFixtureMode(request, env)
  return {
    station: stationByKey(url.searchParams.get('station'))?.key ?? null,
    mode: { fixtures, rt: fixtures ? url.searchParams.get('rt') : null },
    site: siteInfo(env),
  }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const site = loaderData?.site ?? { siteUrl: '', indexable: false }
  return pageMeta({
    title: 'Live train map | BrisbaneTrain',
    description: 'Where every South East Queensland train is right now, updated every 15 seconds.',
    url: `${site.siteUrl}/map`,
    site,
    noindex: true,
  })
}

const dist2 = (a: Station, b: Station) => (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2

function SelectedTrain({ v, mode }: { v: Vehicle; mode: Route.ComponentProps['loaderData']['mode'] }) {
  const fetcher = useFetcher(mode)
  const q = useTrip(fetcher, mode, v.tripKey ?? '', null, !!v.tripKey)
  const trip = q.data
  const line = trip ? lineFor(trip.route, trip.headsign) : null
  const nextKey = v.stopId ? stationKeyOfStop(v.stopId) : null
  return (
    <div
      className="absolute inset-x-3 bottom-3 z-10 rounded-card bg-white/95 p-3.5 shadow-header dark:bg-night-card"
      role="status"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="live" />
        <StatusBadge kind="gps" />
        {line ? <LineChip name={lineLabel(line.name)} color={line.color} /> : null}
      </div>
      <p className="mt-1.5 text-base font-bold">
        {trip ? `To ${cleanStopName(trip.headsign)}` : 'Loading service…'}
      </p>
      <p className="text-[13px] text-gray-600 dark:text-night-text/70">
        {[
          v.label,
          vehicleStatusText(v.status),
          nextKey
            ? `${v.status === 'STOPPED_AT' ? 'at' : 'next'} ${stationByKey(nextKey)?.name ?? ''}`
            : null,
          v.speed ? `${Math.round(v.speed * 3.6)} km/h` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {v.tripKey ? (
        <Link
          to={`${at('/trip')}/${encodeURIComponent(v.tripKey)}`}
          className="mt-2 inline-block text-sm font-bold text-ferry-orange-deep underline dark:text-ferry-sunset"
        >
          View stopping pattern
        </Link>
      ) : null}
    </div>
  )
}

export default function MapPage({ loaderData }: Route.ComponentProps) {
  const { mode, station } = loaderData
  const fetcher = useFetcher(mode)
  const q = useVehicles(fetcher, mode, true)
  const [selected, setSelected] = useState<string | null>(null)
  const vehicles = q.data?.vehicles ?? []
  const centre = stationByKey(station) ?? (stationByKey('central') as Station)
  const fitTo = useMemo(
    () =>
      [...STATIONS]
        .sort((a, b) => dist2(a, centre) - dist2(b, centre))
        .slice(0, station ? 6 : 14)
        .map((s) => `s:${s.key}`),
    [centre, station],
  )
  const markers: MapMarker[] = useMemo(
    () => [
      ...STATIONS.map((s) => ({
        id: `s:${s.key}`,
        lat: s.lat,
        lon: s.lon,
        shape: 'square' as const,
        tone: s.key === station ? ('selected' as const) : ('stop' as const),
        label: `${s.name} station`,
      })),
      ...vehicles.map((v) => ({
        id: `v:${v.id}`,
        lat: v.lat,
        lon: v.lon,
        shape: 'square' as const,
        tone: 'allstops' as const,
        pulse: true,
        label: `Train ${v.label ?? v.id}`,
        onClick: () => setSelected(v.id),
      })),
    ],
    [vehicles, station],
  )
  const sel = vehicles.find((v) => v.id === selected) ?? null
  const mounted = useMounted()
  const placeholder = (
    <div
      className="h-[70dvh] w-full animate-pulse rounded-card bg-map-ground"
      role="status"
      aria-label="Loading map"
    />
  )

  return (
    <Shell active="map">
      <div className="relative mx-auto max-w-6xl">
        {mounted ? (
          <Suspense fallback={placeholder}>
            <MapView
              markers={markers}
              fitTo={fitTo}
              label={`Map of ${vehicles.length} live trains${station ? ` near ${centre.name}` : ''}`}
              className="h-[70dvh] w-full overflow-hidden rounded-card bg-map-ground"
            />
          </Suspense>
        ) : (
          placeholder
        )}
        <p className="mt-2 flex items-center gap-3 text-xs text-gray-600 dark:text-night-text/70">
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-ferry-aqua" /> Train
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm border-2 border-teal-text bg-white" /> Station
          </span>
          <span className="ml-auto">{vehicles.length} trains with live positions</span>
        </p>
        {sel ? <SelectedTrain v={sel} mode={mode} /> : null}
      </div>
    </Shell>
  )
}
