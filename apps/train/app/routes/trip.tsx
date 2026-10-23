/**
 * /trip/:tripInstance (?from=&to=): one train (T-Detail, THE-118 PR 6). The shared trip layout: the summary (the
 * platform on the line colour, the line, "To {headsign}", the countdown at your station, the status line with GPS
 * and the train), the facts, "Your trip" from your station with the train as a moving capsule, and the dock ("Track on
 * map", the star). Polls every 15 s, or takes pushed updates from the hibernating-WebSocket prototype when TRIP_WS is
 * on (ADR-0003). A service that has run (or never was) shows a friendly note that links back to the board.
 */

import {
  dayMarker,
  formatClock,
  formatDuration,
  Icon,
  liveState,
  minutesBetween,
  minutesUntil,
  OfflineBanner,
  PlatformLineTile,
  statusLine,
  tripAsTimetable,
} from '@bft/ui'
import { awaitingSeedAnswer, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { StarButton } from '@bft/ui/star'
import {
  backClick,
  occupancyFact,
  TripBackLink,
  TripDock,
  type TripLinkRenderer,
  TripMap,
  TripNotFound,
  TripSummary,
  trackClass,
  YourTrip,
} from '@bft/ui/trip'
import { useMemo } from 'react'
import { data, Link, useRouteLoaderData } from 'react-router'
import { Shell } from '../components/Chrome.tsx'
import { useStar } from '../components/TrainStar.tsx'
import { ApiError, fetchTrip } from '../lib/api.ts'
import { at, BASE } from '../lib/base.ts'
import { validateTrip } from '../lib/contract.server.ts'
import { lineLabel } from '../lib/lineNames.ts'
import { cleanStopName } from '../lib/names.ts'
import { boardHref, lineFor, stationByKey } from '../lib/network.ts'
import { useFetcher, useTrip } from '../lib/queries.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
import { buildTimeline, stopPlatform, vehicleStatusText } from '../lib/trip.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { useTripSocket } from '../lib/useTripSocket.ts'
import type { loader as rootLoader } from '../root.tsx'
import type { Route } from './+types/trip'

const TRIP_RE = /^.+@\d{8}$/

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const key = params.tripInstance
  const url = new URL(request.url)
  const from = stationByKey(url.searchParams.get('from'))?.key ?? null
  const to = stationByKey(url.searchParams.get('to'))?.key ?? null
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
  let gone = !TRIP_RE.test(key)
  const trip = gone
    ? null
    : await settle((signal) => fetchTrip(fetcher, key, { signal, validate: validateTrip }))
  if (!trip && !gone) {
    // Unknown trips say so; an API that is down still renders the page, which retries on the client.
    const probe = await settle((signal) => fetcher(`/v1/train/trips/${encodeURIComponent(key)}`, { signal }))
    if (probe?.status === 404) gone = true
  }
  const body = {
    key,
    trip,
    from,
    to,
    gone,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    mode: { fixtures, rt },
    site: siteInfo(env),
  }
  // A 404 for crawlers, but the page itself says the service has run and links back to the board.
  return gone ? data(body, { status: 404 }) : body
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const t = loaderData?.trip
  const title = t
    ? `${formatClock(t.stops[0]?.schedDep ?? 0)} to ${cleanStopName(t.headsign)} | BrisbaneTrain`
    : 'Service | BrisbaneTrain'
  // Service pages are per-day and change every few seconds: never indexed.
  return [{ title }, { name: 'robots', content: 'noindex' }]
}

const linkRenderer: TripLinkRenderer = ({ href, className, children, onClick }) => (
  <Link to={href} className={className} onClick={onClick}>
    {children}
  </Link>
)

export default function TripPage({ loaderData }: Route.ComponentProps) {
  const { key, from, to, mode, renderedAt } = loaderData
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const fetcher = useFetcher(mode)
  const socket = useTripSocket(root?.tripWs ?? null, key, mode)
  const q = useTrip(fetcher, mode, key, loaderData.trip, !socket.connected)
  const nowMs = useNow(renderedAt, 1000)
  const online = useOnline()
  const gone = loaderData.gone || (q.error instanceof ApiError && q.error.status === 404)
  // Offline, or data too old to call live: the timetable only (no live words, GPS, estimates or position).
  const raw = gone ? null : (q.data ?? loaderData.trip)
  const page = usePageCheck()
  const state = liveState(raw ?? undefined, { offline: !online, nowMs, ...page })
  const trip = raw && state != null ? tripAsTimetable(raw) : raw
  // A non-live seed whose own refetch is still out: "Connecting…", no banner (R32-RT1).
  const waiting = !gone && raw === q.data && awaitingSeedAnswer(q, state)
  const nowS = Math.floor(nowMs / 1000)
  const view = useMemo(() => (trip ? buildTimeline(trip, nowS, from, to) : null), [trip, nowS, from, to])

  const boardKey = from ?? view?.rows.find((r) => r.stop)?.stationKey ?? null
  const toName = to ? stationByKey(to)?.name : null
  const fromName = boardKey
    ? (view?.rows.find((r) => r.stationKey === boardKey)?.name ?? stationByKey(boardKey)?.name)
    : null
  const back =
    boardKey && fromName
      ? { href: boardHref(boardKey, to), label: cleanStopName(fromName), onClick: backClick }
      : { href: at('/stations'), label: 'Stations', onClick: backClick }
  // The star saves the station you board at, with your destination when the page knows it (§2).
  const starName = `${fromName ? cleanStopName(fromName) : ''}${toName ? ` → ${cleanStopName(toName)}` : ''}`
  const star = useStar({ from: boardKey ?? '', to }, starName)

  const head = (
    <>
      <TripBackLink href={back.href} label={back.label} renderLink={linkRenderer} barHasIt={!!BASE} />
      {!online ? (
        <OfflineBanner
          kind="offline"
          detail="Showing the last update. Live positions resume when you're back online."
        />
      ) : null}
      {online && state != null && state !== 'offline' && !waiting ? <OfflineBanner kind={state} /> : null}
    </>
  )

  if (gone || !trip || !view) {
    return (
      // Loading: "Connecting…". Failed: not live (no answer is never LIVE), as a failed board says. Gone: no claim.
      <Shell
        active="stations"
        live={gone ? undefined : q.isError ? false : undefined}
        pending={!gone && !q.isError}
        back={back}
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          {head}
          {gone ? (
            <TripNotFound place={fromName ? back.label : null} href={back.href} renderLink={linkRenderer} />
          ) : (
            <p className="py-8 text-center text-sm text-sched-text" role="status">
              {q.isError ? "Couldn't load this service. Retrying…" : 'Loading service…'}
            </p>
          )}
        </div>
      </Shell>
    )
  }

  const line = lineFor(trip.route, trip.headsign)
  const b = Math.max(
    0,
    view.rows.findIndex((r) => r.stationKey === boardKey && r.stop),
  )
  const a = to ? view.rows.findIndex((r, i) => i > b && r.stationKey === to && r.stop) : -1
  const board = view.rows[b]?.stop ?? trip.stops[0]
  const alight = a >= 0 ? view.rows[a]?.stop : null
  const dep = board ? (board.estDep ?? board.schedDep) : null
  const sched = board ? (board.schedDep ?? board.schedArr) : null
  const arr = alight ? (alight.estArr ?? alight.schedArr) : null
  const last = trip.stops[trip.stops.length - 1]
  const end = last && last !== board ? (last.estArr ?? last.schedArr) : null
  const express = view.rows.some((r) => r.kind === 'skip' && !r.stop)
  const cancelled = trip.status === 'cancelled'
  const plat = board ? stopPlatform(board) : { platform: null, scheduled: null }
  const changed = plat.scheduled && plat.scheduled !== plat.platform ? plat.scheduled : null
  const status = statusLine({
    status: cancelled ? 'cancelled' : (board?.status ?? trip.status),
    schedDep: sched ?? undefined,
    estDep: board?.estDep,
    platformFrom: changed,
  })
  const minutes = dep != null && !cancelled ? minutesUntil(dep, nowMs) : null
  const v = trip.vehicle
  const vStatus = vehicleStatusText(v?.status)
  const train = v ? `Train ${v.label ?? v.id}${vStatus ? `, ${vStatus.toLowerCase()}` : ''}` : null

  return (
    <Shell active="stations" live={state == null} pending={waiting} back={back}>
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        {head}
        <TripSummary
          tile={<PlatformLineTile platform={plat.platform} color={line.color} changedFrom={changed} />}
          kicker={`${express ? 'Express · ' : ''}${lineLabel(line.name)}`}
          headsign={cleanStopName(trip.headsign)}
          minutes={minutes != null && minutes >= 0 ? minutes : null}
          time={dep != null ? formatClock(dep) : ''}
          dayMarker={dep != null ? dayMarker(dep, nowMs) : null}
          status={status}
          gps={!!v}
          vehicle={train}
          hot={express}
          facts={[
            dep != null && {
              label: 'Departs',
              value: formatClock(dep),
              sub: plat.platform ? `Platform ${plat.platform}` : null,
            },
            dep != null && arr != null
              ? {
                  label: 'Arrives',
                  value: formatClock(arr),
                  sub: `${formatDuration(Math.max(0, minutesBetween(dep, arr)))} journey`,
                }
              : !to && dep != null && end != null && last
                ? {
                    label: 'Journey',
                    value: formatDuration(Math.max(0, minutesBetween(dep, end))),
                    sub: `to ${cleanStopName(stationByKey(last.stationKey ?? '')?.name ?? last.name ?? trip.headsign)}`,
                  }
                : null,
            occupancyFact(v?.occupancy),
          ]}
        />
        <YourTrip
          stops={view.rows}
          board={b}
          alight={a >= 0 ? a : null}
          color={line.color}
          position={cancelled ? null : view.position}
          positionLabel={view.positionLabel}
          footer={
            socket.connected ? (
              <p className="mt-2 text-xs text-sched-text" data-transport="websocket">
                Live updates pushed over a WebSocket.
              </p>
            ) : null
          }
        />
        {v ? (
          <TripMap
            markers={[
              {
                id: 'vehicle',
                lat: v.lat,
                lon: v.lon,
                shape: 'square',
                tone: 'allstops',
                pulse: true,
                label: `${train ?? 'Train'} live position`,
              },
              ...[boardKey, to]
                .map((k) => (k ? stationByKey(k) : null))
                .filter((s) => s != null)
                .map((s) => ({
                  id: s.key,
                  lat: s.lat,
                  lon: s.lon,
                  shape: 'square' as const,
                  tone: 'stop' as const,
                  label: `${s.name} station`,
                })),
            ]}
            label={`Map showing the train on its way to ${cleanStopName(trip.headsign)}`}
          />
        ) : null}
        <TripDock>
          <Link
            to={`${at('/map')}?${new URLSearchParams({ ...(boardKey ? { station: boardKey } : {}), trip: key })}`}
            className={trackClass}
          >
            <Icon name="map" size={20} />
            Track on map
          </Link>
          {boardKey ? <StarButton saved={star.saved} onToggle={star.toggle} name={starName} /> : null}
        </TripDock>
        {/* Room for the phone's dock above the tab bar. */}
        <div aria-hidden="true" className="h-20 md:hidden" />
      </div>
      {star.toast}
    </Shell>
  )
}
