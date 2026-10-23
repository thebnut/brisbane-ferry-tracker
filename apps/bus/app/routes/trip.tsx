/**
 * /trip/:tripInstance?from=stopId: one bus (B-Detail, THE-118 PR 6). The shared trip layout: the summary (route tile,
 * "Metro", "To {headsign}", the countdown at your stop, the status line with GPS and the bus), the facts (never a
 * "Not reported" tile), "Your trip" from your stop with the bus riding the line, and the dock ("Track on map", the
 * star). Server-rendered from /v1/bus/trips, then polled. A trip that has run (or never was) shows a friendly note that
 * links back to the stop.
 */

import type { TripResponse } from '@bft/core/contract'
import {
  dayMarker,
  delayText,
  formatClock,
  formatDuration,
  Icon,
  liveState,
  minutesBetween,
  minutesUntil,
  RouteTile,
  routeTileVariant,
  statusLine,
  tripAsTimetable,
} from '@bft/ui'
import { SkeletonRows } from '@bft/ui/bus'
import { usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import {
  backClick,
  occupancyFact,
  type TripLinkRenderer,
  TripBackLink,
  TripDock,
  TripMap,
  TripNotFound,
  TripSummary,
  trackClass,
  YourTrip,
} from '@bft/ui/trip'
import { data, Link } from 'react-router'
import { BusStar } from '../components/BusStar.tsx'
import { BusNav, DataBanner, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { ApiError, fetchRoute } from '../lib/api.ts'
import { at as appAt, BASE } from '../lib/base.ts'
import { validateRoute, validateTrip } from '../lib/contract.server.ts'
import { useApi } from '../lib/mode.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { routeHref, stopHref } from '../lib/stops.ts'
import { at, needsStopNames, schedAt, stopNamesFor, timeline, unnamedStop } from '../lib/trip.ts'
import { fetchTrip, isGone, useTrip } from '../lib/trip-queries.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/trip'

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const key = params.tripInstance
  const from = new URL(request.url).searchParams.get('from')
  const { fetcher, env } = loaderEnv(request, context)
  let gone = !/^.+@\d{8}$/.test(key)
  const trip = gone
    ? null
    : await settle(async (signal) => {
        try {
          return await fetchTrip(fetcher, key, { signal, validate: validateTrip })
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) gone = true
          throw error
        }
      })
  // The trip endpoint names stops from the stop index. Only if it left some unnamed (an older API, or a stop the index
  // lacks) take the names from this route's stop file, where one is published. Only this trip's stops go in the page.
  const route = needsStopNames(trip)
    ? await settle((signal) => fetchRoute(fetcher, trip.route.short, { signal, validate: validateRoute }))
    : null
  const stopNames = stopNamesFor(trip, route)
  const body = {
    key,
    from: from && /^[\w-]{1,32}$/.test(from) ? from : null,
    trip,
    gone,
    stopNames,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
  // A 404 for crawlers, but the page itself says the trip has run and links back to the stop.
  return gone ? data(body, { status: 404 }) : body
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

const linkRenderer: TripLinkRenderer = ({ href, className, children, onClick }) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
)

/** The mode kicker: Metro, CityGlider, BUZ (the orange tiles), else Bus. */
function kickerOf(short: string, long?: string) {
  if (/^M\d+$/.test(short) || /metro/i.test(long ?? '')) return 'Metro'
  if (/glider/i.test(long ?? '')) return 'CityGlider'
  return routeTileVariant(short, long) === 'premium' ? 'BUZ' : 'Bus'
}

export default function TripPage({ loaderData }: Route.ComponentProps) {
  const { key, from } = loaderData
  const { mode, fetcher } = useApi()
  const q = useTrip(fetcher, mode, key, loaderData.trip)
  const now = useNow(loaderData.renderedAt)
  const online = useOnline()
  const gone = loaderData.gone || isGone(q.error)
  const shown = gone ? undefined : q.data
  // Offline, or data too old to call live: the timetable only (no live words, GPS, estimates or position).
  const page = usePageCheck()
  const state = liveState(shown, { offline: !online, nowMs: now, ...page })
  const trip = shown && state != null ? tripAsTimetable(shown) : shown
  const pending = !gone && !shown && !q.isError
  // No data is never live (a first request that failed with an HTTP error leaves the state null).
  const live = state == null && shown != null
  const fromName = from
    ? (trip?.stops.find((s) => s.stopId === from)?.name ?? loaderData.trip?.stops.find((s) => s.stopId === from)?.name)
    : undefined
  // A trip the page can't name the stop for (it has gone) still goes back to that stop, by its number.
  const back = from
    ? { href: stopHref(from), label: fromName ?? unnamedStop(from), onClick: backClick }
    : { href: appAt('/'), label: 'Bus', onClick: backClick }
  return (
    <>
      <SiteHeader live={gone ? undefined : live} pending={pending} back={back} />
      <UpdatedStrip
        updatedAt={trip?.generatedAt ?? null}
        source={trip}
        nowMs={now}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
        live={gone ? undefined : live}
        pending={pending}
      />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-4 pt-3.5 pb-28 md:pb-8">
        <TripBackLink href={back.href} label={back.label} renderLink={linkRenderer} barHasIt={!!BASE} />
        <DataBanner
          rtState={state != null && state !== 'offline' ? state : trip?.rtState}
          hasData={!!trip}
          generation={trip?.staticGeneration}
        />
        {gone ? (
          <TripNotFound place={from ? back.label : null} href={back.href} renderLink={linkRenderer} />
        ) : !trip ? (
          q.isError ? (
            <p className="py-8 text-center text-sm text-sched-text" role="status">
              Couldn't load this bus. Retrying…
            </p>
          ) : (
            <SkeletonRows count={3} label="Getting this bus…" />
          )
        ) : (
          <TripBody
            trip={trip}
            tripKey={key}
            from={from}
            now={now}
            stopNames={loaderData.stopNames}
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
  tripKey,
  from,
  now,
  stopNames,
}: {
  trip: TripResponse
  tripKey: string
  from: string | null
  now: number
  stopNames: Record<string, string>
}) {
  const view = timeline(trip, from, now, stopNames)
  const fromStop = trip.stops[view.board]
  const last = trip.stops[trip.stops.length - 1]
  const dep = fromStop ? at(fromStop) : 0
  const sched = fromStop ? schedAt(fromStop) : 0
  const cancelled = trip.status === 'cancelled'
  const late = fromStop?.status === 'live' ? delayText(sched, fromStop.estDep ?? fromStop.estArr) : null
  const end = last && last !== fromStop ? (last.estArr ?? last.schedArr) : null
  const v = trip.vehicle
  const minutes = dep && !cancelled ? minutesUntil(dep, now) : null
  const lastName = last ? (view.rows[view.rows.length - 1]?.name ?? null) : null
  return (
    <>
      <TripSummary
        tile={
          <RouteTile
            route={trip.route.short}
            variant={routeTileVariant(trip.route.short, trip.route.long)}
            size="lg"
          />
        }
        kicker={kickerOf(trip.route.short, trip.route.long)}
        headsign={trip.headsign}
        minutes={minutes != null && minutes >= 0 ? minutes : null}
        time={dep ? formatClock(dep) : ''}
        dayMarker={dep ? dayMarker(dep, now) : null}
        status={statusLine({
          status: cancelled ? 'cancelled' : (fromStop?.status ?? trip.status),
          schedDep: sched || undefined,
          estDep: fromStop?.estDep ?? fromStop?.estArr,
        })}
        gps={!!v}
        vehicle={v?.label ? `Bus ${v.label}` : null}
        facts={[
          dep > 0 && {
            label: 'Departs',
            value: formatClock(dep),
            sub: late && sched ? `Timetabled ${formatClock(sched)}` : null,
          },
          dep > 0 && end != null && lastName
            ? {
                label: 'Journey',
                value: formatDuration(Math.max(0, minutesBetween(dep, end))),
                sub: `Arrive ${formatClock(end)}`,
              }
            : null,
          occupancyFact(v?.occupancy),
        ]}
      />
      <YourTrip
        stops={view.rows}
        board={view.board}
        color="1E7C80"
        position={cancelled ? null : view.position}
        positionLabel={view.positionLabel}
        positionLive
      />
      {v ? (
        <TripMap
          markers={[
            {
              id: 'vehicle',
              lat: v.lat,
              lon: v.lon,
              shape: 'diamond',
              tone: 'allstops',
              pulse: true,
              label: `${v.label ? `Bus ${v.label}` : 'Bus'} live position`,
            },
          ]}
          label={`Map showing the bus on its way to ${trip.headsign}`}
        />
      ) : null}
      <TripDock>
        <Link to={`${routeHref(trip.route.short)}?trip=${encodeURIComponent(tripKey)}`} className={trackClass}>
          <Icon name="map" size={20} />
          Track on map
        </Link>
        {/* The stop you board at; a trip opened without one (from the route map) has no place to save. */}
        {fromStop && fromStop.stopId === from ? (
          <BusStar id={from} name={view.rows[view.board]?.name ?? from} />
        ) : null}
      </TripDock>
    </>
  )
}
