/**
 * /map (?terminal=, ?trip=): the live ferry map (THE-118 PR 9), which replaced the board's map sheet. Every terminal is
 * a white circle and every ferry with GPS a pulsing circle (express red-orange, all stops aqua), from
 * /v1/ferry/vehicles, polled every 15 s. A board's Map chip opens it on that terminal, showing only the ferries on its
 * departures ("All ferries" shows the rest); a trip's "Track on map" follows that trip's ferry. MapLibre stays lazy
 * (SafeMap), never on a first load.
 *
 * Positions are live claims: shown only while their own answer is live and fresh, and the header's LIVE follows that
 * answer (R32-RT1: "Connecting…" until it arrives).
 */
import { vesselName } from '@bft/ui'
import { Chip } from '@bft/ui/board-header'
import { liveState, pagePending, usePageCheck } from '@bft/ui/connectivity'
import type { MapMarker } from '@bft/ui/map'
import { MAP_BOX, MapCard, MapLegend, MapPageShell } from '@bft/ui/map-page'
import SafeMap from '@bft/ui/safe-map'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { SiteHeader } from '../components/header.tsx'
import { at, BASE } from '../lib/base.ts'
import { cleanStopName } from '../lib/names.ts'
import { useDepartures, useFetcher } from '../lib/queries.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv } from '../lib/server.server.ts'
import { boardHref, TERMINALS, terminalById, terminalByParam, tripHref } from '../lib/terminals.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import { useVehicles } from '../lib/vehicles.ts'
import type { Route } from './+types/map'

export function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url)
  const { fixtures, rt, env } = loaderEnv(request, context)
  const trip = url.searchParams.get('trip')
  return {
    terminal: terminalByParam(url.searchParams.get('terminal'))?.id ?? null,
    // A trip page's "Track on map": that trip's ferry, followed once its position is in.
    trip: trip && /^.{1,200}$/.test(trip) ? trip : null,
    mode: { fixtures, rt, forced: env?.FIXTURES === '1', allowed: env?.ALLOW_FIXTURES === '1' },
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: 'Live ferry map | BrisbaneFerry',
    description: 'Where every Brisbane ferry is right now, updated every 15 seconds.',
    url: `${loaderData?.siteUrl ?? SITE_URL}/map`,
    siteUrl: loaderData?.siteUrl,
    noindex: true,
  })

/** The express (F11) route, from a vehicle's route id ("F11-4055"). */
const isExpress = (routeId: string | null | undefined) => routeId?.split('-')[0] === 'F11'

/** A new terminal or trip starts the page afresh (its filter and selection). */
export default function FerryMapPage({ loaderData }: Route.ComponentProps) {
  return <FerryMap key={`${loaderData.terminal ?? ''}:${loaderData.trip ?? ''}`} loaderData={loaderData} />
}

function FerryMap({ loaderData }: Pick<Route.ComponentProps, 'loaderData'>) {
  const { mode, trip } = loaderData
  const terminal = loaderData.terminal ? terminalById(loaderData.terminal) : null
  const navigate = useNavigate()
  const fetcher = useFetcher(mode)
  const vehicles = useVehicles(fetcher, mode, true)
  // The terminal's departures, to show only the ferries on them (none: every ferry).
  const departures = useDepartures(fetcher, mode, terminal?.id ?? '', '', null, null, !!terminal)
  const nowMs = useNow(Date.now(), 5_000)
  const page = usePageCheck()
  const state = liveState(vehicles.data, { offline: !useOnline(), nowMs, ...page })
  const [all, setAll] = useState(!terminal)
  const [selected, setSelected] = useState<string | null>(null)
  // "From <terminal>" picks its ferries by the terminal's departures: while that request has failed the page can't
  // tell which ferries those are, which is never "none" and never LIVE.
  const filtering = !!terminal && !all
  const filterFailed = filtering && departures.isError
  const fresh = vehicles.data != null && state == null
  const live = fresh && !filterFailed
  const pending = pagePending([
    { q: vehicles, state },
    ...(filtering ? [{ q: departures, state: null }] : []),
  ])

  const data = vehicles.data
  const positions = useMemo(() => (fresh ? (data?.vehicles ?? []) : []), [fresh, data])
  const onTerminal = useMemo(() => {
    const trips = new Set((departures.data?.departures ?? []).map((d) => d.tripInstance))
    return positions.filter((v) => v.tripKey && trips.has(v.tripKey))
  }, [positions, departures.data])
  const followed = trip ? (positions.find((v) => v.tripKey === trip) ?? null) : null
  const shown = all ? positions : filterFailed ? [] : onTerminal
  const ferries = followed && !shown.includes(followed) ? [...shown, followed] : shown
  const name = terminal ? cleanStopName(terminal.name) : ''

  const markers: MapMarker[] = useMemo(
    () => [
      ...TERMINALS.map((t) => ({
        id: t.id,
        lat: t.lat,
        lon: t.lng,
        tone: t.id === terminal?.id ? ('selected' as const) : ('stop' as const),
        label: `${cleanStopName(t.name)} terminal`,
        onClick: () => navigate(boardHref(t.id)),
      })),
      ...ferries.map((v) => {
        const express = isExpress(v.routeId)
        return {
          id: `v:${v.id}`,
          lat: v.lat,
          lon: v.lon,
          pulse: true,
          tone:
            v === followed ? ('selected' as const) : express ? ('express' as const) : ('allstops' as const),
          label: `${vesselName(v.id) ?? 'Ferry'}${express ? ' (express)' : ''}${v === followed ? ', your trip' : ''}`,
          onClick: () => setSelected(v.id),
        }
      }),
    ],
    [ferries, followed, terminal, navigate],
  )
  // A terminal: it and its nearest terminals in view; else the whole river. The followed ferry joins once it's in.
  const fitTo = useMemo(() => {
    const near = terminal
      ? [...TERMINALS]
          .sort(
            (a, b) =>
              (a.lat - terminal.lat) ** 2 +
              (a.lng - terminal.lng) ** 2 -
              ((b.lat - terminal.lat) ** 2 + (b.lng - terminal.lng) ** 2),
          )
          .slice(0, 4)
      : TERMINALS
    return [...near.map((t) => t.id), ...(followed ? [`v:${followed.id}`] : [])]
  }, [terminal, followed])
  const sel = positions.find((v) => v.id === selected) ?? (selected == null ? followed : null)
  const next = sel?.stopId ? terminalById(sel.stopId) : null

  const status = !vehicles.data ? (
    vehicles.isError ? (
      'Live positions are unavailable right now.'
    ) : null
  ) : state != null ? (
    'Live positions are unavailable right now.'
  ) : filterFailed ? (
    <>
      Can't tell which ferries serve {name} right now.
      <button
        type="button"
        onClick={() => setAll(true)}
        className="min-h-11 text-ferry-orange-deep underline dark:text-ferry-sunset"
      >
        All ferries
      </button>
    </>
  ) : trip && !followed ? (
    "Your ferry isn't sending its position right now."
  ) : !all && onTerminal.length === 0 && departures.data ? (
    `No ferries from ${name} have GPS right now.`
  ) : null

  return (
    <>
      <SiteHeader
        live={live}
        pending={pending}
        back={terminal ? { href: boardHref(terminal.id), label: name } : undefined}
      />
      <MapPageShell
        mode="ferry"
        title={terminal ? `Live ferry map: ${name}` : 'Live ferry map'}
        // The Mode Tabs below the page inside BrisbaneTransit; the standalone site has no bottom bar.
        bottomBar={!!BASE}
        controls={
          terminal ? (
            <fieldset className="flex min-w-0 flex-wrap gap-2">
              <legend className="sr-only">Ferries shown</legend>
              <Chip pressed={!all} onClick={() => setAll(false)}>
                From {name}
              </Chip>
              <Chip pressed={all} onClick={() => setAll(true)}>
                All ferries
              </Chip>
            </fieldset>
          ) : null
        }
        status={status}
        card={
          sel ? (
            <MapCard>
              <p className="text-base font-bold">
                {vesselName(sel.id) ?? 'Ferry'}
                {sel === followed ? (
                  <span className="font-semibold text-sched-text"> · your trip</span>
                ) : null}
              </p>
              <p className="text-[13px] text-gray-600 dark:text-night-text/70">
                {[
                  isExpress(sel.routeId) ? 'Express (F11)' : sel.routeId ? sel.routeId.split('-')[0] : null,
                  next ? `next ${cleanStopName(next.name)}` : null,
                  sel.speed ? `${Math.round(sel.speed * 3.6)} km/h` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {sel.tripKey && next ? (
                <Link
                  to={tripHref(sel.tripKey, next.id)}
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
            shape="circle"
            items={[
              { label: 'Express', tone: 'express' },
              { label: 'All stops', tone: 'vehicle' },
              { label: 'Terminal', tone: 'stop' },
            ]}
          >
            {filterFailed ? null : (
              <span data-map-count="" className="font-normal text-sched-text dark:text-night-text/70">
                {ferries.length === 1 ? '1 ferry' : `${ferries.length} ferries`} with GPS
              </span>
            )}
          </MapLegend>
        }
      >
        <SafeMap
          markers={markers}
          fitTo={fitTo}
          // The followed ferry's position can arrive after the first fit: fit again once it does.
          fitKey={followed?.id ?? ''}
          // And keep it in view as it moves.
          follow={followed ? [followed.lon, followed.lat] : null}
          label={`Map of ${ferries.length} live ferries${terminal ? ` near ${name}` : ''}`}
          className={MAP_BOX}
          unavailable={
            <Link
              to={terminal ? boardHref(terminal.id) : at('/')}
              className="mt-2 text-sm font-semibold text-ferry-orange-deep underline dark:text-ferry-sunset"
            >
              {terminal ? `${name} departures` : 'Ferry departures'}
            </Link>
          }
        />
      </MapPageShell>
    </>
  )
}
