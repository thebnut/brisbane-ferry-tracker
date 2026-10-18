/**
 * /trip/:tripInstance (?from=&to=): service detail (T-Detail). Header card with the line, badges, the departure at your
 * station and its platform tile, then the vertical stopping pattern with the train as a moving capsule. Polls every
 * 15 s, or takes pushed updates from the hibernating-WebSocket prototype when TRIP_WS is on (ADR-0003).
 */
import {
  CountdownChip,
  formatClock,
  formatDuration,
  Icon,
  LineChip,
  minutesUntil,
  OfflineBanner,
  PlatformTile,
  ServiceTimeline,
  StatusBadge,
} from '@bft/ui'
import { useMemo } from 'react'
import { data, Link, useRouteLoaderData } from 'react-router'
import { Shell } from '../components/Chrome.tsx'
import { fetchTrip } from '../lib/api.ts'
import { validateTrip } from '../lib/contract.server.ts'
import { lineLabel } from '../lib/lineNames.ts'
import { cleanStopName } from '../lib/names.ts'
import { lineFor, stationByKey, stationPath } from '../lib/network.ts'
import { useFetcher, useTrip } from '../lib/queries.ts'
import { loaderEnv, settle, siteInfo } from '../lib/server.server.ts'
import { buildTimeline, occupancyOf, stopPlatform, vehicleStatusText } from '../lib/trip.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { useTripSocket } from '../lib/useTripSocket.ts'
import type { loader as rootLoader } from '../root.tsx'
import type { Route } from './+types/trip'

const TRIP_RE = /^.+@\d{8}$/

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const key = params.tripInstance
  if (!TRIP_RE.test(key)) throw data(null, { status: 404 })
  const url = new URL(request.url)
  const from = stationByKey(url.searchParams.get('from'))?.key ?? null
  const to = stationByKey(url.searchParams.get('to'))?.key ?? null
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
  const trip = await settle((signal) => fetchTrip(fetcher, key, { signal, validate: validateTrip }))
  if (!trip) {
    // Unknown trips are 404s; an API that is down still renders the page, which retries on the client.
    const probe = await settle((signal) => fetcher(`/v1/train/trips/${encodeURIComponent(key)}`, { signal }))
    if (probe?.status === 404) throw data(null, { status: 404 })
  }
  return { key, trip, from, to, renderedAt: Date.now(), mode: { fixtures, rt }, site: siteInfo(env) }
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

export default function TripPage({ loaderData }: Route.ComponentProps) {
  const { key, from, to, mode, renderedAt } = loaderData
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const fetcher = useFetcher(mode)
  const socket = useTripSocket(root?.tripWs ?? null, key, mode)
  const q = useTrip(fetcher, mode, key, loaderData.trip, !socket.connected)
  const trip = q.data ?? loaderData.trip
  const nowMs = useNow(renderedAt, 1000)
  const online = useOnline()
  const nowS = Math.floor(nowMs / 1000)
  const view = useMemo(() => (trip ? buildTimeline(trip, nowS, from, to) : null), [trip, nowS, from, to])

  if (!trip || !view) {
    return (
      <Shell active="stations">
        <p className="py-8 text-center text-sm text-sched-text" role="status">
          {q.isError ? "Couldn't load this service. Retrying…" : 'Loading service…'}
        </p>
      </Shell>
    )
  }

  const line = lineFor(trip.route, trip.headsign)
  const boardKey = from ?? view.rows.find((r) => r.stop)?.stationKey ?? null
  const board = view.rows.find((r) => r.stationKey === boardKey && r.stop)?.stop ?? trip.stops[0]
  const alight = to ? view.rows.find((r) => r.stationKey === to && r.stop)?.stop : null
  const dep = board ? (board.estDep ?? board.schedDep) : null
  const arr = alight ? (alight.estArr ?? alight.schedArr) : null
  const express = view.rows.some((r) => r.kind === 'skip' && !r.stop)
  const live = trip.status === 'live'
  const plat = board ? stopPlatform(board) : { platform: null, scheduled: null }
  const occupancy = occupancyOf(trip.vehicle?.occupancy)
  const status = vehicleStatusText(trip.vehicle?.status)
  const backTo = boardKey ? `${stationPath(boardKey)}${to ? `?to=${to}` : ''}` : '/stations'

  return (
    <Shell active="stations">
      <div className="mx-auto flex max-w-2xl flex-col gap-3.5">
        <Link
          to={backTo}
          className="flex items-center gap-1 self-start text-sm font-semibold text-ferry-orange-deep dark:text-ferry-sunset"
        >
          <Icon name="chevronRight" size={16} className="rotate-180" />
          Departures
        </Link>
        {!online ? (
          <OfflineBanner
            kind="offline"
            detail="Showing the last update. Live positions resume when you're back online."
          />
        ) : null}
        {online && trip.rtState !== 'live' ? <OfflineBanner kind={trip.rtState} /> : null}
        <section
          aria-labelledby="trip-title"
          className={
            express
              ? 'bg-hot flex flex-col gap-3 rounded-card border-2 border-ferry-orange p-4 shadow-hot'
              : 'flex flex-col gap-3 rounded-card bg-white/90 p-4 shadow-card dark:bg-night-card'
          }
        >
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <LineChip name={lineLabel(line.name)} color={line.color} />
                {live ? <StatusBadge kind="live" /> : null}
                {trip.vehicle ? <StatusBadge kind="gps" /> : null}
                {trip.status === 'scheduled' ? <StatusBadge kind="scheduled" /> : null}
                {trip.status === 'cancelled' ? <StatusBadge kind="cancelled" /> : null}
              </div>
              <h1 id="trip-title" className="text-xl leading-tight font-extrabold">
                {dep ? formatClock(dep) : ''} {express ? 'express ' : ''}to {cleanStopName(trip.headsign)}
              </h1>
              {trip.vehicle ? (
                <span className="text-sm text-gray-600 dark:text-night-text/70">
                  Train: {trip.vehicle.label ?? trip.vehicle.id}
                  {status ? ` · ${status}` : ''}
                </span>
              ) : null}
            </div>
            <PlatformTile platform={plat.platform} scheduledPlatform={plat.scheduled} />
          </div>
          <dl className="grid grid-cols-3 gap-2 border-t border-ferry-orange/20 pt-3 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-gray-600 dark:text-night-text/70">Departs</dt>
              <dd className="font-bold tabular">
                {dep && trip.status !== 'cancelled' ? (
                  minutesUntil(dep, nowMs) <= 60 && minutesUntil(dep, nowMs) >= 0 ? (
                    <CountdownChip minutes={minutesUntil(dep, nowMs)} className="px-2.5 py-0.5 text-sm" />
                  ) : (
                    formatClock(dep)
                  )
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-gray-600 dark:text-night-text/70">Journey</dt>
              <dd className="font-bold tabular">{dep && arr ? formatDuration((arr - dep) / 60) : '—'}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-gray-600 dark:text-night-text/70">Occupancy</dt>
              <dd className="flex items-center gap-1.5 font-bold">
                {occupancy ? (
                  <>
                    {occupancy.text}
                    <span role="img" aria-label={`Occupancy: ${occupancy.text}`} className="flex gap-0.5">
                      {[0, 1, 2, 3].map((i) => (
                        <span
                          key={i}
                          className={`h-3 w-1.5 rounded-sm ${i < occupancy.bars ? 'bg-ferry-orange-aa' : 'bg-sched-bg dark:bg-night-2'}`}
                        />
                      ))}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        </section>
        <section
          aria-labelledby="pattern-heading"
          className="rounded-card bg-white/90 px-4 py-3 shadow-card dark:bg-night-card"
        >
          <h2 id="pattern-heading" className="mb-2 text-base font-bold">
            Stopping pattern
          </h2>
          <ServiceTimeline
            stops={view.rows}
            color={line.color}
            position={trip.status === 'cancelled' ? null : view.position}
            positionLabel={view.positionLabel ?? undefined}
          />
          {socket.connected ? (
            <p className="mt-2 text-xs text-sched-text" data-transport="websocket">
              Live updates pushed over a WebSocket.
            </p>
          ) : null}
        </section>
      </div>
    </Shell>
  )
}
