/**
 * /trip/:tripInstance (?from=<terminal>&to=<terminal>): one ferry (THE-118 PR 6), replacing the board's details sheet.
 * The shared trip layout: the summary (service tile, "Express CityCat", "To {headsign}", the countdown at your
 * terminal, the status line with GPS and the vessel), the facts, "Your trip" from your terminal, a live map when GPS
 * is known, and the dock ("Track on map", the star). Server-rendered from /v1/ferry/trips, then polled. A trip that
 * has run (or never was) shows a friendly note that links back to the board.
 */

import type { TripResponse, TripStop } from '@bft/core/contract'
import {
  dayMarker,
  delayText,
  formatClock,
  formatDuration,
  Icon,
  liveState,
  minutesBetween,
  minutesUntil,
  OfflineBanner,
  statusLine,
  tripAsTimetable,
  vesselName,
} from '@bft/ui'
import { usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import {
  backClick,
  occupancyFact,
  positionFromVehicle,
  type TimelineStop,
  type TripLinkRenderer,
  TripBackLink,
  TripDock,
  TripNotFound,
  TripSummary,
  trackClass,
  YourTrip,
} from '@bft/ui/trip'
import { lazy, Suspense, useEffect, useState } from 'react'
import { data, Link } from 'react-router'
import { Footer } from '../components/Chrome.tsx'
import { ServiceTile } from '../components/DepartureList.tsx'
import FerryStar from '../components/FerryStar.tsx'
import { SiteHeader } from '../components/header.tsx'
import { at, BASE } from '../lib/base.ts'
import { validateTrip } from '../lib/contract.server.ts'
import { cleanStopName } from '../lib/names.ts'
import { useFetcher } from '../lib/queries.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { boardHref, destinationParam, terminalById, terminalByParam, tripStopName } from '../lib/terminals.ts'
import { fetchTrip, isGone, useTrip } from '../lib/trip-queries.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/trip'

// SafeMap is MapView behind a WebGL check and an error boundary, and loads MapLibre itself. If its own chunk can't
// load, the page goes on without the map.
const NoMap = (() => null) as never // renders nothing, whatever the props
const SafeMap = lazy(() => import('@bft/ui/safe-map').catch(() => ({ default: NoMap })))

const TRIP_RE = /^.+@\d{8}$/

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const key = params.tripInstance
  const url = new URL(request.url)
  const origin = terminalByParam(url.searchParams.get('from'))
  const to = origin ? destinationParam(origin, url.searchParams.get('to')) : null
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
  let gone = !TRIP_RE.test(key)
  const trip = gone
    ? null
    : await settle(async (signal) => {
        try {
          return await fetchTrip(fetcher, key, { signal, validate: validateTrip })
        } catch (error) {
          if (isGone(error)) gone = true
          throw error
        }
      })
  const body = {
    key,
    trip,
    from: origin?.id ?? null,
    to: to?.id ?? null,
    gone,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    mode: { fixtures, rt },
    siteUrl: env?.SITE_URL ?? null,
  }
  // An expired or unknown trip is a 404 for crawlers, but the page itself says so and links back to the board. An API
  // that is down still renders the page, which retries on the client.
  return gone ? data(body, { status: 404 }) : body
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const t = loaderData?.trip
  const title = t ? `${t.route.short} to ${cleanStopName(t.headsign)} | Brisbane Ferry` : 'Ferry trip | Brisbane Ferry'
  // Trip pages are per-day and change every few seconds: never indexed.
  return [{ title }, { name: 'robots', content: 'noindex' }]
}

const linkRenderer: TripLinkRenderer = ({ href, className, children, onClick }) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
)

const kickerOf = (route: string) =>
  route === 'F11' ? 'Express CityCat' : /^F2\d$/.test(route) ? 'Cross-river ferry' : 'All-stops CityCat'

const timeOf = (s: TripStop) => s.estDep ?? s.schedDep ?? s.estArr ?? s.schedArr
const arrivalOf = (s: TripStop) => s.estArr ?? s.schedArr ?? s.estDep ?? s.schedDep

export default function TripPage({ loaderData }: Route.ComponentProps) {
  const { key, mode, renderedAt } = loaderData
  const fetcher = useFetcher(mode)
  const q = useTrip(fetcher, mode, key, loaderData.trip)
  const now = useNow(renderedAt, 5_000)
  const online = useOnline()
  const page = usePageCheck()
  const gone = loaderData.gone || isGone(q.error)
  // Offline, or data too old to call live: the timetable only (no live words, GPS, vessel or position).
  const raw = gone ? null : q.data
  const state = liveState(raw ?? undefined, { offline: !online, nowMs: now, ...page })
  const trip = raw && state != null ? tripAsTimetable(raw) : raw
  const fromId = loaderData.from ?? trip?.stops[0]?.stopId ?? null
  const fromT = fromId ? terminalById(fromId) : null
  const back = fromT
    ? { href: boardHref(fromT.id, loaderData.to), label: cleanStopName(fromT.name), onClick: backClick }
    : { href: at('/'), label: 'Ferry', onClick: backClick }
  return (
    <>
      <SiteHeader
        // No answer yet is never live; a trip that has gone claims nothing.
        live={gone ? undefined : state == null && raw != null}
        pending={!gone && !raw && !q.isError}
        back={back}
      />
      <main className="mx-auto flex max-w-2xl flex-col gap-3 px-3 pt-2 pb-28 md:px-4 md:pt-4 md:pb-8">
        <TripBackLink href={back.href} label={back.label} renderLink={linkRenderer} barHasIt={!!BASE} />
        {!online ? (
          <OfflineBanner kind="offline" detail="Showing the last update. Live times resume when you're back online." />
        ) : null}
        {online && state != null && state !== 'offline' ? <OfflineBanner kind={state} /> : null}
        {gone ? (
          <TripNotFound place={fromT ? back.label : null} href={back.href} renderLink={linkRenderer} />
        ) : !trip ? (
          <p className="py-8 text-center text-sm text-sched-text" role="status">
            {q.isError ? "Couldn't load this ferry. Retrying…" : 'Loading this ferry…'}
          </p>
        ) : (
          <TripBody trip={trip} from={fromId} to={loaderData.to} now={now} />
        )}
      </main>
      <Footer />
    </>
  )
}

function TripBody({
  trip,
  from,
  to,
  now,
}: {
  trip: TripResponse
  from: string | null
  to: string | null
  now: number
}) {
  const stops = trip.stops
  const b = Math.max(
    0,
    stops.findIndex((s) => s.stopId === from),
  )
  const a = to ? stops.findIndex((s, i) => i > b && s.stopId === to) : -1
  const board = stops[b] as TripStop
  const alight = a >= 0 ? (stops[a] as TripStop) : null
  const last = stops[stops.length - 1] as TripStop
  const dep = timeOf(board)
  const sched = board.schedDep ?? board.schedArr
  const arr = alight ? arrivalOf(alight) : null
  const end = b < stops.length - 1 ? arrivalOf(last) : null
  const cancelled = trip.status === 'cancelled'
  const status = statusLine({
    status: cancelled ? 'cancelled' : board.status,
    schedDep: sched ?? undefined,
    estDep: board.estDep,
  })
  const minutes = dep != null && !cancelled ? minutesUntil(dep, now) : null
  // Null once the trip is live-matched to a vessel and fresh (tripAsTimetable drops it otherwise).
  const v = trip.vehicle
  const vessel = v ? (vesselName(v.id) ?? v.label ?? null) : null
  const late = board.status === 'live' && sched != null ? delayText(sched, board.estDep) : null
  const nameOf = (s: TripStop) => cleanStopName(tripStopName(s.stopId, s.name))

  const nowS = now / 1000
  const rows: TimelineStop[] = stops.map((s, i) => {
    const t = timeOf(s)
    const passes = s.status === 'skipped' || (s.pickup === 1 && s.dropOff === 1)
    const past = t != null && t < nowS - 30
    return {
      id: `${s.stopId}:${s.stopSequence}`,
      name: nameOf(s),
      kind: passes ? 'skip' : past ? 'passed' : i === stops.length - 1 ? 'terminus' : 'stop',
      note:
        i === b ? 'You board' : i === a ? 'You get off' : passes ? 'Not stopping' : undefined,
      arr: !passes && i > 0 && s.schedArr != null ? formatClock(s.estArr ?? s.schedArr) : null,
      dep: !passes && s.schedDep != null ? formatClock(s.estDep ?? s.schedDep) : null,
      delay: s.status === 'live' ? delayText(s.schedDep ?? s.schedArr ?? 0, s.estDep ?? s.estArr) : null,
      cancelled: s.status === 'cancelled',
    }
  })
  const position = positionFromVehicle(
    stops.map((s) => s.stopId),
    v,
  )
  const posStop = position == null ? null : stops[Math.ceil(position)]
  const positionLabel =
    v && posStop
      ? `${vessel ?? 'The ferry'} is ${v.status === 'STOPPED_AT' ? 'at' : 'heading to'} ${nameOf(posStop)}`
      : null

  const fromT = terminalById(board.stopId)
  const toT = alight ? terminalById(alight.stopId) : null

  return (
    <>
      <TripSummary
        tile={<ServiceTile code={trip.route.short} express={trip.route.short === 'F11'} />}
        kicker={kickerOf(trip.route.short)}
        headsign={cleanStopName(trip.headsign)}
        minutes={minutes != null && minutes >= 0 ? minutes : null}
        time={dep != null ? formatClock(dep) : ''}
        dayMarker={dep != null ? dayMarker(dep, now) : null}
        status={status}
        gps={!!v}
        vehicle={vessel}
        hot={trip.route.short === 'F11'}
        facts={[
          dep != null && {
            label: 'Departs',
            value: formatClock(dep),
            sub: late && sched != null ? `Timetabled ${formatClock(sched)}` : fromT ? cleanStopName(fromT.name) : null,
          },
          arr != null && dep != null
            ? {
                label: 'Arrives',
                value: formatClock(arr),
                sub: `${formatDuration(Math.max(0, minutesBetween(dep, arr)))} journey`,
              }
            : !to && end != null && dep != null
              ? {
                  label: 'Journey',
                  value: formatDuration(Math.max(0, minutesBetween(dep, end))),
                  sub: `to ${nameOf(last)}`,
                }
              : null,
          occupancyFact(v?.occupancy),
        ]}
      />
      <YourTrip
        stops={rows}
        board={b}
        alight={a >= 0 ? a : null}
        color={trip.route.color}
        position={cancelled ? null : position}
        positionLabel={positionLabel}
      />
      {v ? (
        <LiveMap
          markers={[
            {
              id: 'vehicle',
              lat: v.lat,
              lon: v.lon,
              pulse: true,
              tone: trip.route.short === 'F11' ? ('express' as const) : ('allstops' as const),
              label: `${vessel ?? 'Ferry'} live position`,
            },
            ...[fromT, toT]
              .filter((t) => t != null)
              .map((t) => ({ id: t.id, lat: t.lat, lon: t.lng, tone: 'stop' as const, label: `${t.name} terminal` })),
          ]}
          label={`Map showing ${vessel ?? 'the ferry'} on its way to ${cleanStopName(trip.headsign)}`}
        />
      ) : null}
      <TripDock>
        <Link to={`${boardHref(board.stopId, to)}${to ? '&' : '?'}map=1`} className={trackClass}>
          <Icon name="map" size={20} />
          Track on map
        </Link>
        <FerryStar from={board.stopId} to={alight ? alight.stopId : null} />
      </TripDock>
    </>
  )
}

/** The live position, inline and only when GPS is known (never an empty map). After hydration: MapLibre is client-only. */
function LiveMap({ markers, label }: { markers: MapMarker[]; label: string }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const box = 'h-64 w-full overflow-hidden rounded-card bg-map-ground md:h-72'
  return (
    <section aria-label="Live position" data-trip-map="">
      {mounted ? (
        <Suspense fallback={<div className={box} />}>
          <SafeMap markers={markers} label={label} className={box} />
        </Suspense>
      ) : (
        <div className={box} />
      )}
    </section>
  )
}
