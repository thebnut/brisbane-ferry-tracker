/**
 * /stop/:stopId: server-rendered stop board (B-Departures). The loader fetches /v1 departures in-process so the
 * rows are in the HTML; the client then polls every 15 s. Route filter pills, the Save star (My Transit), alert strip and a
 * lazy per-stop map with the buses heading here.
 */

import type { Alert } from '@bft/core/contract'
import { AlertCountLink, useCurrentAlerts } from '@bft/ui/alert-count'
import { BoardHeader, Chip, FilterRow, NowChip } from '@bft/ui/board-header'
import { NoticeStrip } from '@bft/ui/bus'
import { awaitingSeedAnswer, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { data, redirect, useNavigate } from 'react-router'
import { BusStar } from '../components/BusStar.tsx'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { DepartureList, linkRenderer } from '../components/StopBoard.tsx'
import { ApiError, fetchAlerts, fetchDepartures, fetchRouteIndex } from '../lib/api.ts'
import { at, BASE } from '../lib/base.ts'
import { validateAlerts, validateDepartures, validateRouteIndex } from '../lib/contract.server.ts'
import { isActive, leavingFrom, routesIn } from '../lib/departures.ts'
import { useApi } from '../lib/mode.ts'
import { liveView, refreshOfflineCopy, useAlerts, useDepartures } from '../lib/queries.ts'
import { cachedRouteIndex } from '../lib/route-index.server.ts'
import { pageMeta, SITE_URL, stopJsonLd, stopMetaTags } from '../lib/seo.ts'
import { fixtureFallbackOn, loaderEnv, settle } from '../lib/server.server.ts'
import { canonicalStopId, routeHref, routeShortOf, stopHref, stopMeta } from '../lib/stops.ts'
import { hasTimetableCopy, pushRecent, useSavedStops } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/stop'

// If this small chunk can't load, the page goes on without its map (SafeMap inside covers MapLibre itself).
const NoMap = (() => null) as never // renders nothing, whatever the props
const StopMap = lazy(() => import('../components/StopMap.tsx').catch(() => ({ default: NoMap })))

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const stopId = params.stopId
  if (!/^[\w-]{1,32}$/.test(stopId)) throw data(null, { status: 404 })
  // The page shows the public stop number ("Stop 010813"), so people type and share it: send it to the stop's page
  // instead of asking the API for an id that doesn't exist (two 404s per visit, R3-B10).
  const canonical = canonicalStopId(stopId)
  if (canonical !== stopId) throw redirect(`${stopHref(canonical)}${new URL(request.url).search}`, 301)
  const { fetcher, env, fixtures } = loaderEnv(request, context)
  // ?route=<short> (the route stop picker, P2): only that route's departures, filtered by the API before the row
  // limit so a busy stop still lists them. Only a current route counts (data/bus/routes.json, cached in the isolate
  // as for the route page); a malformed or unknown value, or no readable index, means the whole board.
  const only = new URL(request.url).searchParams.get('route')
  let route: string | undefined
  if (only && /^[\w-]{1,12}$/.test(only)) {
    const index = await settle(
      (signal) =>
        cachedRouteIndex(() => fetchRouteIndex(fetcher, { signal, validate: validateRouteIndex }), {
          cache: !fixtures && !fixtureFallbackOn(env),
        }),
      1200,
    )
    if (index?.routes.includes(only)) route = only
  }
  let unknown = false
  const [departures, alerts] = await Promise.all([
    settle(async (signal) => {
      try {
        return await fetchDepartures(fetcher, stopId, { signal, route, validate: validateDepartures })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) unknown = true
        throw error
      }
    }),
    settle((signal) => fetchAlerts(fetcher, { signal, validate: validateAlerts }), 1200),
  ])
  if (unknown) throw data(null, { status: 404 })
  // No `route` key at all without one: it would be in every stop page's inline data.
  return {
    stopId,
    departures,
    alerts,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    siteUrl: env?.SITE_URL ?? SITE_URL,
    ...(route ? { route } : {}),
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [{ title: 'Stop not found | BrisbaneBus' }, { name: 'robots', content: 'noindex' }]
  const name = loaderData.departures?.stop.name ?? `Stop ${loaderData.stopId}`
  const routes = loaderData.departures ? routesIn(loaderData.departures.departures) : []
  const m = stopMetaTags(loaderData.stopId, name, routes, loaderData.siteUrl)
  return [
    ...pageMeta({ ...m, siteUrl: loaderData.siteUrl }),
    { 'script:ld+json': stopJsonLd(loaderData.stopId, name, m.url, loaderData.siteUrl) },
  ]
}

/**
 * The board header's alert count in BrisbaneTransit (THE-118 PR 3): wider than the notices above the rows, so the count
 * says what affects this stop at all. Bus alerts that name this stop or a route serving it (any effect), or that name
 * no route or stop (a network-wide notice).
 */
export function boardAlerts(alerts: Alert[], stopId: string, routes: string[], nowS: number): Alert[] {
  return alerts.filter(
    (a) =>
      isActive(a, nowS) &&
      (a.modes.length === 0 || a.modes.includes('bus')) &&
      ((a.routes.length === 0 && a.stops.length === 0) ||
        a.stops.includes(stopId) ||
        a.routes.some((r) => routes.includes(routeShortOf(r)))),
  )
}

/** Alerts for this stop, or a detour on a route that serves it. */
export function stopAlerts(alerts: Alert[], stopId: string, routes: string[], nowS: number): Alert[] {
  return alerts.filter(
    (a) =>
      isActive(a, nowS) &&
      (a.stops.includes(stopId) ||
        (a.effect === 'DETOUR' && a.routes.some((r) => routes.includes(routeShortOf(r))))),
  )
}

export default function StopPage({ loaderData }: Route.ComponentProps) {
  const { stopId } = loaderData
  const { mode, fetcher } = useApi()
  // "Depart from" (the Now ▾ chip, THE-118 PR 5): null is now, which the loader's rows are for.
  const [departAt, setDepartAt] = useState<number | null>(null)
  const q = useDepartures(
    fetcher,
    mode,
    stopId,
    departAt ? null : loaderData.departures,
    loaderData.route,
    departAt,
  )
  const alertsQ = useAlerts(fetcher, mode, loaderData.alerts)
  const now = useNow(loaderData.renderedAt)
  const saved = useSavedStops()
  const [route, setRoute] = useState('all')
  const only = loaderData.route
  const pick = only ?? route
  const navigate = useNavigate()
  const [showMap, setShowMap] = useState(false)
  // Timetable only unless the data is live and fresh (offline, cached copy, stale).
  const online = useOnline()
  const page = usePageCheck()
  const view = liveView(stopId, q.data, now, online, page)
  const state = view.state
  // A later time's board: from that time on, whichever copy is shown (an offline copy runs from now).
  const res = view.data && leavingFrom(view.data, departAt)
  const name = res?.stop.name ?? `Stop ${stopId}`
  const routes = useMemo(() => (res ? routesIn(res.departures) : []), [res])
  const platform = res?.departures.find((d) => d.stopId === stopId)?.platform ?? null
  const alerts = alertsQ.data?.alerts ?? []
  const currentAlerts = useCurrentAlerts(alertsQ, loaderData.alerts)
  const here = stopAlerts(alerts, stopId, routes, Math.floor(now / 1000))
  const isSaved = saved.some((s) => s.id === stopId)
  // No answer yet (no data, no error), or a non-live seed whose own refetch is still out (R32-RT1): the header says
  // "Connecting…", not OFFLINE (THE-118), with no "delayed" banner.
  const pending = (!q.data && !q.isError) || awaitingSeedAnswer(q, state)

  // Keep this stop's longer timetable on the device at once, not only from the first poll (R6-B1).
  useEffect(() => {
    void refreshOfflineCopy(fetcher, stopId)
  }, [fetcher, stopId])

  useEffect(() => {
    if (res?.stop.name) pushRecent({ id: stopId, name: res.stop.name })
  }, [res?.stop.name, stopId])

  return (
    <>
      <SiteHeader live={state == null && res?.rtState === 'live'} pending={pending}>
        <DesktopNav active="" />
      </SiteHeader>
      <main className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 pt-3 pb-4">
        <BoardHeader
          kicker="Bus stop"
          name={name}
          facts={[
            stopMeta(stopId, platform),
            routes.length ? `${routes.length} route${routes.length === 1 ? '' : 's'}` : null,
            // BrisbaneTransit: Alerts left the section bar for the board header (THE-118 PR 3).
            BASE ? (
              <AlertCountLink
                key="alerts"
                count={
                  currentAlerts
                    ? boardAlerts(currentAlerts.alerts, stopId, routes, Math.floor(now / 1000)).length
                    : null
                }
                href={at('/alerts')}
                renderLink={linkRenderer}
              />
            ) : null,
          ]}
          star={<BusStar id={stopId} name={name} />}
        >
          <FilterRow label="Filter by route">
            {routes.length > 1 || only ? (
              <>
                <Chip
                  pressed={pick === 'all'}
                  // ?route= came from the API filtered: "All routes" loads the whole board.
                  onClick={() => (only ? navigate(stopHref(stopId)) : setRoute('all'))}
                >
                  All routes
                </Chip>
                {(only ? [only] : routes.slice(0, 12)).map((r) => (
                  <Chip key={r} pressed={pick === r} onClick={() => (only ? undefined : setRoute(r))}>
                    {r}
                  </Chip>
                ))}
              </>
            ) : null}
            <Chip icon="map" pressed={showMap} onClick={() => setShowMap((s) => !s)}>
              Map
            </Chip>
            <NowChip value={departAt} onChange={setDepartAt} nowMs={now} />
          </FilterRow>
        </BoardHeader>
        <UpdatedStrip
          board
          updatedAt={res?.generatedAt ?? null}
          source={res}
          nowMs={now}
          onRefresh={() => q.refetch()}
          refreshing={q.isFetching}
          live={state == null && res?.rtState === 'live'}
          pending={pending}
        />
        <DataBanner
          offline={state === 'offline'}
          rtState={pending ? undefined : res?.rtState}
          hasData={!!res?.departures.length}
          generation={res?.staticGeneration}
        />
        {here.slice(0, 2).map((a) => (
          <NoticeStrip key={a.id} href={at('/alerts')} renderLink={linkRenderer}>
            {a.header}
          </NoticeStrip>
        ))}
        {showMap ? (
          <Suspense fallback={<div className="h-72 animate-pulse rounded-card bg-map-ground" />}>
            <StopMap stopId={stopId} name={name} departures={res?.departures ?? []} />
          </Suspense>
        ) : null}
        <DepartureList
          stopId={stopId}
          data={res}
          isError={q.isError}
          onRetry={() => q.refetch()}
          nowMs={now}
          alerts={alerts}
          routes={pick === 'all' ? null : new Set([pick])}
          offline={state === 'offline'}
          saved={isSaved}
          copyRanOut={state === 'offline' && hasTimetableCopy(stopId)}
        />
        {routes.length ? (
          <section className="mt-4" aria-labelledby="routes-here">
            <h2 id="routes-here" className="text-sm font-semibold text-gray-700 dark:text-night-text/80">
              Routes from {name}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {routes.map((r) => (
                <li key={r}>
                  <a
                    href={routeHref(r)}
                    className="inline-block rounded-full border border-ferry-orange/20 bg-white/80 px-3 py-1 font-semibold text-aqua-text hover:border-ferry-orange/50 dark:bg-night-card dark:text-ferry-aqua-light"
                  >
                    Route {r}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <Footer />
      <BusNav active="" alertCount={here.length || undefined} />
    </>
  )
}
