/**
 * /nearby ("Around you", X-Map): stops of every mode around you, grouped by mode with their pin shapes, each with its
 * next departures from /v1, on a lazy MapLibre map. Position: GPS (asked for only after the user taps, unless already
 * granted), else "Use a stop", else `?lat=&lon=` (links, tests). It never leaves the browser: the page only fetches
 * the geohash-5 tiles around it (own + 8 neighbours per mode) and sorts them here (nearby.ts, < 100 ms).
 */
import { positionFromParams } from '@bft/bus/app/lib/geo.ts'
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  ChipFilter,
  EmptyState,
  ErrorState,
  formatDistance,
  Icon,
  ModePin,
  minutesUntil,
  NearbyDepartureRow,
  PillButton,
  PrimaryButton,
  SecondaryButton,
  useGeolocation,
} from '@bft/ui'
import { liveState, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { TransitFooter, TransitHeader, TransitStrip } from '../components/Chrome.tsx'
import type { PickStop } from '../components/StopPicker.tsx'
import { stopPageHref } from '../lib/hrefs.ts'
import {
  cellsFor,
  computeNearby,
  cue,
  NEARBY_MODES,
  NEARBY_RADIUS_M,
  type NearbyMode,
  type NearStop,
  walkMinutes,
} from '../lib/nearby.ts'
import { useGeoTiles, useStopDepartures } from '../lib/nearby-queries.ts'
import { type Place, readPlace, writePlace } from '../lib/place.ts'
import { useApi } from '../lib/queries.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/nearby'

// If this small chunk can't load, the page goes on without its map (SafeMap inside covers MapLibre itself).
const NoMap = (() => null) as never // renders nothing, whatever the props
const NearbyMap = lazy(() => import('../components/NearbyMap.tsx').catch(() => ({ default: NoMap })))
// Only for "Use a stop": its search (and the bus stop index it fetches) stays off the first load.
const StopPicker = lazy(() => import('../components/StopPicker.tsx'))

/** Loading placeholder rows (the bus UI's SkeletonRows would add its whole module to this page). */
function Pulse({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <div key={i} className="h-14 animate-pulse rounded-card bg-white/70 dark:bg-night-card" />
      ))}
    </div>
  )
}

export function loader() {
  return { renderedAt: Date.now(), via: VIA_NETWORK }
}

export const meta: Route.MetaFunction = () => [
  { title: 'Around you: ferries, trains and buses nearby | BrisbaneTransit' },
  { name: 'robots', content: 'noindex' },
]

const LABEL: Record<NearbyMode, string> = { ferry: 'Ferry', train: 'Train', bus: 'Bus' }
type Filter = 'all' | NearbyMode

/** Upcoming departures of a stop, soonest first: cancelled ones kept (struck through), skipped ones dropped. */
export function upcoming(rows: Departure[] | undefined, nowMs: number, n = 3): Departure[] {
  // A skipped service doesn't stop here: no countdown or "Hurry" for it (the stop's own board explains it).
  return (rows ?? [])
    .filter((d) => d.status !== 'skipped' && minutesUntil(d.estDep ?? d.schedDep, nowMs) >= 0)
    .slice(0, n)
}

function StopBlock({
  stop,
  rows,
  pending,
  nowMs,
  live,
}: {
  stop: NearStop
  rows: Departure[]
  pending: boolean
  nowMs: number
  /** The stop's departures are live and fresh (liveState): otherwise timetable times, no live estimates. */
  live: boolean
}) {
  const walk = walkMinutes(stop.metres)
  return (
    <li className="flex flex-col gap-1.5" data-stop={`${stop.mode}:${stop.key}`}>
      <Link
        to={stopPageHref(stop.mode, stop.key)}
        prefetch="intent"
        className="flex items-center gap-2 px-1 text-sm font-bold text-charcoal no-underline dark:text-night-text"
      >
        <ModePin mode={stop.mode} />
        <span className="min-w-0 flex-1 truncate">{stop.name}</span>
        <span className="shrink-0 text-xs font-semibold text-sched-text tabular">
          {formatDistance(stop.metres)} · {walk} min walk
        </span>
        <Icon name="chevronRight" size={16} className="shrink-0 text-ferry-orange-dark" />
      </Link>
      {pending ? (
        <Pulse rows={1} />
      ) : rows.length ? (
        rows.map((d) => {
          const mins = minutesUntil((live && d.estDep) || d.schedDep, nowMs)
          return (
            <NearbyDepartureRow
              key={`${d.tripInstance}:${d.stopSequence}`}
              mode={stop.mode}
              route={d.route.short}
              to={d.headsign.replace(/ (station|ferry terminal)$/, '')}
              walk={d.platform ? `Platform ${d.platform}` : null}
              minutes={mins}
              cue={cue(mins, walk)}
              cancelled={d.status === 'cancelled'}
            />
          )
        })
      ) : (
        <p className="px-1 text-xs text-sched-text">No departures in the next while.</p>
      )}
    </li>
  )
}

/**
 * Nearby's header claim (P-42a1bd5-N1). Before any stop has answered: with no stops listed (no location yet, or none
 * near) the page has no live data of its own and claims nothing; while a listed stop is still waiting it says
 * "Connecting…"; only once every listed stop has failed is it OFFLINE. Once a stop has answered, LIVE while every
 * answered stop is live and fresh, as before (a stop still waiting, or one that failed, is left out: R15-S1). Before
 * this, anything not LIVE was OFFLINE: the red pill showed until the first answer, and for good without a location.
 */
export function nearbyLiveState(
  deps: ReadonlyArray<{ data: DeparturesResponse | undefined; failed: boolean }>,
  isLive: (data: DeparturesResponse | undefined) => boolean,
): { live: boolean | undefined; pending: boolean } {
  const answered = deps.filter((d) => d.data != null)
  if (answered.length > 0) return { live: answered.every((d) => isLive(d.data)), pending: false }
  if (deps.length === 0) return { live: undefined, pending: false }
  const waiting = deps.some((d) => !d.failed)
  return { live: false, pending: waiting }
}

export default function Nearby({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { mode, fetcher } = useApi()
  const now = useNow(loaderData.renderedAt)
  const fromUrl = positionFromParams(params)
  const [place, setPlace] = useState<Place | null>(null)
  const [picking, setPicking] = useState(false)
  // A stop picked earlier ("Use a stop") is kept on this device; GPS positions are not reused.
  useEffect(() => {
    const p = readPlace()
    if (p?.source === 'stop') setPlace(p)
  }, [])
  const fixed = fromUrl ?? (place ? { lat: place.lat, lon: place.lon } : null)
  const geolocation = useGeolocation(fixed)
  const { geo, locate } = geolocation
  const pos = geo.state === 'ok' ? geo : null
  const lat = pos?.lat
  const lon = pos?.lon
  const cells = useMemo(() => (lat != null && lon != null ? cellsFor(lat, lon) : []), [lat, lon])
  const { tiles, loading, error, retry } = useGeoTiles(fetcher, mode, cells)

  // Phase 9 exit criterion: tiles loaded → sorted, grouped and on screen in < 100 ms. Measured from the render that
  // sees the last tile to the commit that shows the groups.
  const t0 = useRef(0)
  const result = useMemo(() => {
    if (lat == null || lon == null || loading) return null
    t0.current = performance.now()
    return computeNearby(lat, lon, tiles)
  }, [lat, lon, tiles, loading])
  const [shownMs, setShownMs] = useState<number | null>(null)
  useEffect(() => {
    if (result) setShownMs(performance.now() - t0.current)
  }, [result])

  const [filter, setFilter] = useState<Filter>('all')
  const [showMap, setShowMap] = useState(true)
  const listed = useMemo(
    () => (result ? (filter === 'all' ? result.stops : result.byMode[filter]) : []),
    [result, filter],
  )
  const deps = useStopDepartures(
    fetcher,
    mode,
    listed.map((s) => ({ mode: s.mode, key: s.key })),
    4,
  )
  const depsByStop = new Map(listed.map((s, i) => [`${s.mode}:${s.key}`, deps[i]]))
  const onStop = useCallback((s: NearStop) => navigate(stopPageHref(s.mode, s.key)), [navigate])
  const pick = (s: PickStop) => {
    const p: Place = { lat: s.lat, lon: s.lon, source: 'stop', label: s.name }
    writePlace(p)
    setPlace(p)
    setPicking(false)
  }

  const where = fromUrl ? 'the map position' : place ? place.label : 'you'
  const counts = result ? NEARBY_MODES.map((m) => ({ m, n: result.byMode[m].length })) : []
  const updatedAt = deps.find((d) => d.data)?.data?.generatedAt ?? null
  // The header's claim from the listed stops' answers (nearbyLiveState): LIVE only over live, fresh answers (@bft/ui
  // liveState, as on every board; it used to say LIVE whenever the browser was online, R15).
  const online = useOnline()
  const page = usePageCheck()
  const isLive = (data: DeparturesResponse | undefined) =>
    data != null && liveState(data, { offline: !online, nowMs: now, ...page }) == null
  const { live, pending } = nearbyLiveState(
    deps.map((d) => ({ data: d.data, failed: d.isError || d.failureCount > 0 })),
    isLive,
  )

  return (
    <>
      <TransitHeader live={live} pending={pending} />
      <TransitStrip updatedAt={updatedAt}>
        {result ? (
          <span className="text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light">
            {counts.map(({ m, n }) => `${n} ${m}`).join(', ')}
          </span>
        ) : null}
      </TransitStrip>
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-3.5 pt-3.5 pb-4 md:px-4">
        <div className="flex items-baseline justify-between gap-2">
          <h1 className="text-[20px] font-extrabold">Around {where === 'you' ? 'you' : where}</h1>
          {pos ? (
            <span className="text-xs text-sched-text">within {formatDistance(NEARBY_RADIUS_M)}</span>
          ) : null}
        </div>

        {picking ? (
          <Suspense fallback={<Pulse rows={2} />}>
            <StopPicker onPick={pick} onCancel={() => setPicking(false)} />
          </Suspense>
        ) : !pos ? (
          <div className="flex flex-col gap-3 rounded-card bg-white/90 p-4 shadow-card dark:bg-night-card">
            <p className="text-[15px]">
              {geo.state === 'denied'
                ? 'Location is turned off for this site. Pick a stop instead, or allow location in your browser settings.'
                : geo.state === 'unavailable'
                  ? "We couldn't get your location. Pick a stop instead, or try again."
                  : 'See the ferries, trains and buses leaving near you. Your location stays on this device.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {geo.state !== 'denied' ? (
                <PrimaryButton onClick={locate} disabled={geo.state === 'locating'}>
                  {geo.state === 'locating' ? 'Finding you…' : 'Use my location'}
                </PrimaryButton>
              ) : null}
              <SecondaryButton onClick={() => setPicking(true)}>Use a stop</SecondaryButton>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ChipFilter<Filter>
                label="Show modes"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  ...counts.map(({ m, n }) => ({ value: m, label: LABEL[m], count: n })),
                ]}
              />
              <span className="flex gap-1.5">
                <PillButton icon="map" pressed={showMap} onClick={() => setShowMap((v) => !v)}>
                  Map
                </PillButton>
                <PillButton
                  icon="locate"
                  onClick={() => {
                    setPlace(null)
                    locate()
                  }}
                  label="Use my location"
                >
                  <span className="hidden sm:inline">Locate</span>
                </PillButton>
                <PillButton icon="search" onClick={() => setPicking(true)} label="Use a stop">
                  <span className="hidden sm:inline">Stop</span>
                </PillButton>
              </span>
            </div>
            {showMap && result && lat != null && lon != null ? (
              <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-map-ground md:h-80" />}>
                <NearbyMap
                  lat={lat}
                  lon={lon}
                  stops={listed}
                  onStop={onStop}
                  geolocation={fixed ? undefined : geolocation}
                />
              </Suspense>
            ) : null}
            {error && (!result || listed.length === 0) ? (
              // Never "No stops nearby" when tiles failed: that would be a false empty.
              <ErrorState title="Couldn't load nearby stops" onRetry={retry}>
                Check your connection and try again.
              </ErrorState>
            ) : !result ? (
              <Pulse rows={4} />
            ) : listed.length === 0 ? (
              <EmptyState title="No stops nearby">Try a different place with "Use a stop".</EmptyState>
            ) : (
              <>
                {error ? (
                  <p
                    role="status"
                    className="flex flex-wrap items-center gap-x-2 text-[13px] text-sched-text"
                  >
                    Couldn't load some stops nearby.
                    <button
                      type="button"
                      onClick={retry}
                      className="font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
                    >
                      Try again
                    </button>
                  </p>
                ) : null}
                {(filter === 'all' ? NEARBY_MODES : [filter]).map((m) =>
                  result.byMode[m].length ? (
                    <section key={m} aria-labelledby={`near-${m}`} className="flex flex-col gap-2">
                      <h2
                        id={`near-${m}`}
                        className="flex items-center gap-2 text-[13px] font-extrabold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light"
                      >
                        <ModePin mode={m} />
                        {LABEL[m]}
                      </h2>
                      <ul className="flex flex-col gap-3">
                        {result.byMode[m].map((s) => {
                          const q = depsByStop.get(`${s.mode}:${s.key}`)
                          return (
                            <StopBlock
                              key={s.key}
                              stop={s}
                              rows={upcoming(q?.data?.departures, now)}
                              pending={!!q?.isPending}
                              nowMs={now}
                              live={isLive(q?.data)}
                            />
                          )
                        })}
                      </ul>
                    </section>
                  ) : null,
                )}
                <p
                  className="text-xs text-sched-text"
                  data-nearby-ms={shownMs?.toFixed(1)}
                  data-sort-ms={result.ms.toFixed(2)}
                >
                  {result.stops.length} stops sorted across 3 modes
                  {shownMs != null ? ` in ${Math.max(1, Math.round(shownMs))} ms` : ''}.
                </p>
              </>
            )}
          </>
        )}
      </main>
      <TransitFooter />
    </>
  )
}
