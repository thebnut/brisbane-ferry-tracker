/**
 * /map (?station=): live trains on the network map (T-Map). MapLibre is lazy (about 280 KB gz, never on first load);
 * stations are white square pins, trains pulsing squares (express orange, all stops teal) from /v1/train/vehicles,
 * polled every 15 s. Tapping a train shows its service with a link to the stopping pattern.
 */
import type { Vehicle } from '@bft/core/contract'
import { LineChip, StatusBadge } from '@bft/ui'
import { liveState, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import SafeMap from '@bft/ui/safe-map'
import { useMemo, useState } from 'react'
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
import { useMounted, useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/map'

export function loader({ request, context }: Route.LoaderArgs) {
  const env = getEnv(context)
  const url = new URL(request.url)
  const fixtures = isFixtureMode(request, env)
  return {
    station: stationByKey(url.searchParams.get('station'))?.key ?? null,
    // A trip page's "Track on map" (THE-118 PR 6): that train is selected once its position is in.
    trip: /^.+@\d{8}$/.test(url.searchParams.get('trip') ?? '') ? url.searchParams.get('trip') : null,
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
  const { mode, station, trip } = loaderData
  const fetcher = useFetcher(mode)
  const q = useVehicles(fetcher, mode, true)
  // The header claims LIVE only from the trains' own fresh answer (shared liveState); none yet: "Connecting…".
  const state = liveState(q.data, { offline: !useOnline(), nowMs: useNow(Date.now()), ...usePageCheck() })
  const [selected, setSelected] = useState<string | null>(null)
  const vehicles = q.data?.vehicles ?? []
  const centre = stationByKey(station) ?? (stationByKey('central') as Station)
  // A trip page's "Track on map": that train, highlighted and in view once its position is in.
  const tracked = trip ? (vehicles.find((v) => v.tripKey === trip) ?? null) : null
  const trackedId = tracked?.id ?? ''
  const fitTo = useMemo(
    () => [
      ...[...STATIONS]
        .sort((a, b) => dist2(a, centre) - dist2(b, centre))
        .slice(0, station ? 6 : 14)
        .map((s) => `s:${s.key}`),
      ...(trackedId ? [`v:${trackedId}`] : []),
    ],
    [centre, station, trackedId],
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
        tone: v.id === trackedId ? ('selected' as const) : ('allstops' as const),
        pulse: true,
        label: `Train ${v.label ?? v.id}${v.id === trackedId ? ', your trip' : ''}`,
        onClick: () => setSelected(v.id),
      })),
    ],
    [vehicles, station, trackedId],
  )
  const sel = vehicles.find((v) => v.id === selected) ?? (selected == null ? tracked : null)
  const mounted = useMounted()
  const placeholder = (
    <div
      className="h-[70dvh] w-full animate-pulse rounded-card bg-map-ground"
      role="status"
      aria-label="Loading map"
    />
  )

  return (
    <Shell active="map" live={q.data != null && state == null} pending={!q.data && !q.isError}>
      <div className="relative mx-auto max-w-6xl">
        {mounted ? (
          <SafeMap
            markers={markers}
            fitTo={fitTo}
            // The tracked train's position can arrive after the first fit: fit again once it does.
            fitKey={trackedId}
            label={`Map of ${vehicles.length} live trains${station ? ` near ${centre.name}` : ''}`}
            className="h-[70dvh] w-full overflow-hidden rounded-card bg-map-ground"
            loading={placeholder}
            unavailable={
              <Link
                to={at('/stations')}
                className="mt-2 text-sm font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
              >
                See every station's departures
              </Link>
            }
          />
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
