/**
 * /trip/:tripInstance?from=stopId: one bus (B-Detail). Hero card with the route tile, destination, LIVE/GPS
 * badges and the countdown at your stop; occupancy, bus and journey tiles; the stops on this trip with the bus as
 * a ringed dot. Server-rendered from /v1/bus/trips, then polled.
 */

import type { TripResponse } from '@bft/core/contract'
import {
  BigCountdown,
  dayMarker,
  delayText,
  ErrorState,
  formatClock,
  formatDuration,
  liveState,
  minutesBetween,
  minutesUntil,
  PrimaryButton,
  RouteTile,
  routeTileVariant,
  StatusBadge,
  tripAsTimetable,
} from '@bft/ui'
import { OccupancyMeter, SkeletonRows, TripTimeline } from '@bft/ui/bus'
import { usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { data, Link, useNavigate } from 'react-router'
import { BusStar } from '../components/BusStar.tsx'
import { BusNav, DataBanner, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { ApiError, fetchRoute } from '../lib/api.ts'
import { validateRoute, validateTrip } from '../lib/contract.server.ts'
import { useApi } from '../lib/mode.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { routeHref, stopHref } from '../lib/stops.ts'
import { at, needsStopNames, schedAt, stopNamesFor, timeline } from '../lib/trip.ts'
import { fetchTrip, useTrip } from '../lib/trip-queries.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/trip'

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const key = params.tripInstance
  if (!/^.+@\d{8}$/.test(key)) throw data(null, { status: 404 })
  const from = new URL(request.url).searchParams.get('from')
  const { fetcher, env } = loaderEnv(request, context)
  let unknown = false
  const trip = await settle(async (signal) => {
    try {
      return await fetchTrip(fetcher, key, { signal, validate: validateTrip })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) unknown = true
      throw error
    }
  })
  if (unknown) throw data(null, { status: 404 })
  // The trip endpoint names stops from the stop index. Only if it left some unnamed (an older API, or a stop the index
  // lacks) take the names from this route's stop file, where one is published. Only this trip's stops go in the page.
  const route = needsStopNames(trip)
    ? await settle((signal) => fetchRoute(fetcher, trip.route.short, { signal, validate: validateRoute }))
    : null
  const stopNames = stopNamesFor(trip, route)
  return {
    key,
    from: from && /^[\w-]{1,32}$/.test(from) ? from : null,
    trip,
    stopNames,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const t = loaderData?.trip
  const title = t ? `Route ${t.route.short} to ${t.headsign} | BrisbaneBus` : 'Bus trip | BrisbaneBus'
  // Trip pages are ephemeral: never indexed.
  return pageMeta({
    title,
    description: 'Live position and stops for this bus.',
    url: `${loaderData?.siteUrl ?? SITE_URL}/`,
    noindex: true,
    siteUrl: loaderData?.siteUrl,
  })
}

export default function TripPage({ loaderData }: Route.ComponentProps) {
  const { key, from } = loaderData
  const { mode, fetcher } = useApi()
  const q = useTrip(fetcher, mode, key, loaderData.trip)
  const now = useNow(loaderData.renderedAt)
  const navigate = useNavigate()
  const online = useOnline()
  // Offline, or data too old to call live: the timetable only (no LIVE/GPS badge, estimates or position).
  const page = usePageCheck()
  const state = liveState(q.data, { offline: !online, nowMs: now, ...page })
  const trip = q.data && state != null ? tripAsTimetable(q.data) : q.data
  const pending = !q.data && !q.isError
  // No data is never live (a first request that failed with an HTTP error leaves the state null).
  const live = state == null && q.data != null
  const fromName = from ? trip?.stops.find((s) => s.stopId === from)?.name : undefined
  const back = from && fromName ? { href: stopHref(from), label: fromName } : undefined
  return (
    <>
      <SiteHeader live={live} pending={pending} back={back} />
      <UpdatedStrip
        updatedAt={trip?.generatedAt ?? null}
        source={trip}
        nowMs={now}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
        live={live}
        pending={pending}
      />
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-3.5 pb-28">
        {from ? (
          <Link
            to={stopHref(from)}
            className="text-sm font-semibold text-aqua-text underline dark:text-ferry-aqua-light"
          >
            ‹ Back to the stop
          </Link>
        ) : null}
        <DataBanner
          rtState={state != null && state !== 'offline' ? state : trip?.rtState}
          hasData={!!trip}
          generation={trip?.staticGeneration}
        />
        {!trip ? (
          q.isError ? (
            <ErrorState title="Couldn't load this bus" onRetry={() => q.refetch()}>
              The trip may have finished, or live data is unavailable.
            </ErrorState>
          ) : (
            <SkeletonRows count={3} label="Getting this bus…" />
          )
        ) : (
          <TripBody
            trip={trip}
            from={from}
            now={now}
            stopNames={loaderData.stopNames}
            onTrack={() => navigate(`${routeHref(trip.route.short)}?trip=${encodeURIComponent(key)}`)}
          />
        )}
      </main>
      <Footer />
      <BusNav active="" />
    </>
  )
}

function TripBody({
  trip,
  from,
  now,
  stopNames,
  onTrack,
}: {
  trip: TripResponse
  from: string | null
  now: number
  stopNames: Record<string, string>
  onTrack: () => void
}) {
  const fromStop = trip.stops.find((s) => s.stopId === from) ?? trip.stops[0]
  const last = trip.stops[trip.stops.length - 1]
  const dep = fromStop ? at(fromStop) : 0
  const sched = fromStop ? schedAt(fromStop) : 0
  const live = trip.status === 'live' || fromStop?.status === 'live'
  const delay = fromStop?.status === 'live' ? delayText(sched, fromStop.estDep ?? fromStop.estArr) : null
  const arrive = last ? (last.estArr ?? last.schedArr) : null
  const journeyMin = arrive && dep ? Math.max(0, minutesBetween(dep, arrive)) : null
  const v = trip.vehicle
  return (
    <>
      <section className="bg-hot flex flex-col gap-3 rounded-[14px] border-2 border-ferry-orange p-3.5 shadow-[0_0_20px_rgb(255_107_53/0.35)]">
        <div className="flex items-center gap-3">
          <RouteTile
            route={trip.route.short}
            variant={routeTileVariant(trip.route.short, trip.route.long)}
            size="xl"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-[22px] leading-tight font-extrabold">{trip.headsign}</h1>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge kind={trip.status === 'cancelled' ? 'cancelled' : live ? 'live' : 'scheduled'} />
              {v ? <StatusBadge kind="gps" /> : null}
              {live && trip.status !== 'cancelled' ? (
                <span
                  className={
                    delay
                      ? 'text-xs font-bold text-ferry-orange-aa'
                      : 'text-xs font-bold text-chip-later-text'
                  }
                >
                  {delay ?? 'On time'}
                </span>
              ) : null}
            </span>
          </div>
          {dep ? (
            <BigCountdown
              minutes={minutesUntil(dep, now)}
              time={formatClock(dep)}
              dayMarker={dayMarker(dep, now)}
              cancelled={trip.status === 'cancelled'}
              size="lg"
            />
          ) : null}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1 rounded-[10px] bg-white/90 px-2.5 py-2 dark:bg-night-2">
            <span className="text-[11px] font-semibold text-sched-text">Occupancy</span>
            <OccupancyMeter occupancy={v?.occupancy} />
          </div>
          <div className="flex flex-col gap-1 rounded-[10px] bg-white/90 px-2.5 py-2 dark:bg-night-2">
            <span className="text-[11px] font-semibold text-sched-text">Bus</span>
            <span className="text-[13px] font-bold">{v?.label ? `#${v.label}` : 'Not reporting'}</span>
            {v?.status ? (
              <span className="text-xs text-sched-text">
                {v.status === 'STOPPED_AT'
                  ? 'Stopped at stop'
                  : v.status === 'INCOMING_AT'
                    ? 'Arriving'
                    : 'In transit'}
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 rounded-[10px] bg-white/90 px-2.5 py-2 dark:bg-night-2">
            <span className="text-[11px] font-semibold text-sched-text">Journey</span>
            <span className="text-[13px] font-bold">
              {journeyMin != null ? formatDuration(journeyMin) : '–'}
            </span>
            {arrive ? <span className="text-xs text-sched-text">Arrive {formatClock(arrive)}</span> : null}
          </div>
        </div>
      </section>
      <section
        aria-labelledby="trip-stops"
        className="rounded-card bg-white/90 px-3.5 py-3 shadow-card dark:bg-night-card"
      >
        <h2
          id="trip-stops"
          className="mb-1.5 text-[15px] font-bold text-aqua-text dark:text-ferry-aqua-light"
        >
          Stops on this trip
        </h2>
        <TripTimeline stops={timeline(trip, from, now, stopNames)} />
      </section>
      <div
        data-bft-dock=""
        className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+var(--bft-bottom-bar,64px))] z-20 border-t border-ferry-orange/20 bg-white/95 px-4 py-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 dark:bg-night-2/95"
      >
        <div className="mx-auto flex max-w-3xl gap-2.5">
          <PrimaryButton className="flex-1" onClick={onTrack}>
            Track on map
          </PrimaryButton>
          {from && fromStop ? (
            <BusStar id={from} name={fromStop.name ?? from} className="min-h-12 flex-1" />
          ) : null}
        </div>
      </div>
    </>
  )
}
