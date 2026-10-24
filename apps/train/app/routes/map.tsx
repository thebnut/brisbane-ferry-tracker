/**
 * /map (?station=, ?trip=): live trains on the network map (T-Map), on the shared map page (THE-118 PR 9). MapLibre
 * is lazy (about 280 KB gz, never on first load); stations are white square pins, trains pulsing squares from
 * /v1/train/vehicles, polled every 15 s. Tapping a train shows its service with a link to the stopping pattern.
 * Positions are live claims: shown only while their own answer is live and fresh (the header's LIVE follows it).
 */
import type { Vehicle } from '@bft/core/contract'
import { LineChip, StatusBadge } from '@bft/ui'
import { Chip } from '@bft/ui/board-header'
import { liveState, pagePending, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import { MAP_BOX, MapCard, MapLegend, MapPageShell } from '@bft/ui/map-page'
import SafeMap from '@bft/ui/safe-map'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Shell } from '../components/Chrome.tsx'
import { DEPARTURE_LIMIT } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { lineLabel } from '../lib/lineNames.ts'
import { cleanStopName } from '../lib/names.ts'
import {
  lineFor,
  STATIONS,
  type Station,
  stationByKey,
  stationHref,
  stationKeyOfStop,
} from '../lib/network.ts'
import { departuresOptions, useFetcher, useTrip, useVehicles } from '../lib/queries.ts'
import { pageMeta } from '../lib/seo.ts'
import { getEnv, isFixtureMode, siteInfo } from '../lib/server.server.ts'
import { vehicleStatusText } from '../lib/trip.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
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

function SelectedTrain({
  v,
  mode,
  yours,
}: {
  v: Vehicle
  mode: Route.ComponentProps['loaderData']['mode']
  /** The train a trip page's "Track on map" follows. */
  yours: boolean
}) {
  const fetcher = useFetcher(mode)
  const q = useTrip(fetcher, mode, v.tripKey ?? '', null, !!v.tripKey)
  const trip = q.data
  const line = trip ? lineFor(trip.route, trip.headsign) : null
  const nextKey = v.stopId ? stationKeyOfStop(v.stopId) : null
  return (
    <MapCard>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge kind="live" />
        <StatusBadge kind="gps" />
        {line ? <LineChip name={lineLabel(line.name)} color={line.color} /> : null}
      </div>
      <p className="mt-1.5 text-base font-bold">
        {trip ? `To ${cleanStopName(trip.headsign)}` : 'Loading service…'}
        {yours ? <span className="font-semibold text-sched-text"> · your trip</span> : null}
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
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-ferry-orange-deep underline dark:text-ferry-sunset"
        >
          View stopping pattern
        </Link>
      ) : null}
    </MapCard>
  )
}

/** A new station or trip starts the page afresh (its filter and selection). */
export default function MapPage({ loaderData }: Route.ComponentProps) {
  return <TrainMap key={`${loaderData.station ?? ''}:${loaderData.trip ?? ''}`} loaderData={loaderData} />
}

function TrainMap({ loaderData }: Pick<Route.ComponentProps, 'loaderData'>) {
  const { mode, station, trip } = loaderData
  const fetcher = useFetcher(mode)
  const q = useVehicles(fetcher, mode, true)
  // The header claims LIVE only from the trains' own fresh answer (shared liveState); none yet: "Connecting…".
  const state = liveState(q.data, { offline: !useOnline(), nowMs: useNow(Date.now()), ...usePageCheck() })
  // And no failed request since (React Query keeps the last answer after a failure, retries included).
  const fresh = q.data != null && state == null && !q.isError && q.failureCount === 0
  const [selected, setSelected] = useState<string | null>(null)
  // Positions are live claims: none from an answer that isn't live and fresh.
  const data = q.data
  const vehicles = useMemo(() => (fresh ? (data?.vehicles ?? []) : []), [fresh, data])
  const centre = stationByKey(station) ?? (stationByKey('central') as Station)
  // A trip page's "Track on map": that train, highlighted and in view once its position is in.
  const tracked = trip ? (vehicles.find((v) => v.tripKey === trip) ?? null) : null
  const trackedId = tracked?.id ?? ''
  // A station's Map chip: only the trains on its departures ("All trains" shows the rest); the tracked one always.
  const [all, setAll] = useState(!station)
  const deps = useQuery({
    ...departuresOptions(fetcher, mode, station ?? '', null, DEPARTURE_LIMIT, null),
    enabled: !!station,
  })
  const atStation = useMemo(() => {
    const trips = new Set((deps.data?.departures ?? []).map((d) => d.tripInstance))
    return vehicles.filter((v) => v.tripKey && trips.has(v.tripKey))
  }, [vehicles, deps.data])
  // "At <station>" picks its trains by the station's departures: while that request has failed the page can't tell
  // which trains those are, which is never "none" and never LIVE.
  const filtering = !!station && !all
  const filterFailed = filtering && (deps.isError || deps.failureCount > 0)
  const live = fresh && !filterFailed
  const base = all ? vehicles : filterFailed ? [] : atStation
  const shown = tracked && !base.includes(tracked) ? [...base, tracked] : base
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
      ...shown.map((v) => ({
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
    [shown, station, trackedId],
  )
  const sel = vehicles.find((v) => v.id === selected) ?? (selected == null ? tracked : null)
  const status =
    q.isError || (q.data && !fresh) ? (
      'Live positions are unavailable right now.'
    ) : filterFailed ? (
      <>
        Can't tell which trains stop at {centre.name} right now.
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-11 text-ferry-orange-deep underline dark:text-ferry-sunset"
        >
          All trains
        </button>
      </>
    ) : trip && q.data && !tracked ? (
      "Your train isn't sending its position right now."
    ) : !all && deps.data && atStation.length === 0 ? (
      `No trains at ${centre.name} have live positions right now.`
    ) : null

  return (
    <Shell
      active="map"
      live={live}
      pending={pagePending([{ q, state }, ...(filtering ? [{ q: deps, state: null }] : [])])}
      back={station ? { href: stationHref(centre.key), label: centre.name } : undefined}
      bleed
    >
      <MapPageShell
        mode="train"
        title={station ? `Live train map: ${centre.name}` : 'Live train map'}
        bottomBar
        controls={
          station ? (
            <fieldset className="flex min-w-0 flex-wrap gap-2">
              <legend className="sr-only">Trains shown</legend>
              <Chip pressed={!all} onClick={() => setAll(false)}>
                At {centre.name}
              </Chip>
              <Chip pressed={all} onClick={() => setAll(true)}>
                All trains
              </Chip>
            </fieldset>
          ) : null
        }
        status={status}
        card={sel ? <SelectedTrain v={sel} mode={mode} yours={sel === tracked} /> : null}
        legend={
          <MapLegend
            shape="square"
            items={[
              { label: 'Train', tone: 'vehicle' },
              { label: 'Station', tone: 'stop' },
            ]}
          >
            {filterFailed ? null : (
              <span data-map-count="" className="font-normal text-sched-text dark:text-night-text/70">
                {shown.length} with live positions
              </span>
            )}
          </MapLegend>
        }
      >
        <SafeMap
          markers={markers}
          fitTo={fitTo}
          // The tracked train's position can arrive after the first fit: fit again once it does.
          fitKey={trackedId}
          // And keep it in view as it moves.
          follow={tracked ? [tracked.lon, tracked.lat] : null}
          label={`Map of ${shown.length} live trains${station ? ` near ${centre.name}` : ''}`}
          className={MAP_BOX}
          unavailable={
            <Link
              to={at('/stations')}
              className="mt-2 text-sm font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
            >
              See every station's departures
            </Link>
          }
        />
      </MapPageShell>
    </Shell>
  )
}
