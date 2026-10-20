/**
 * /stop/:stopId: server-rendered stop board (B-Departures). The loader fetches /v1 departures in-process so the
 * rows are in the HTML; the client then polls every 15 s. Route filter pills, save to My stops, alert strip and a
 * lazy per-stop map with the buses heading here.
 */

import type { Alert } from '@bft/core/contract'
import { FilterPills, PillButton } from '@bft/ui'
import { NoticeStrip, SaveButton } from '@bft/ui/bus'
import { useUnconfirmedBefore } from '@bft/ui/connectivity'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { data, redirect, useNavigate } from 'react-router'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { DepartureList, linkRenderer } from '../components/StopBoard.tsx'
import { ApiError, fetchAlerts, fetchDepartures, fetchRouteIndex } from '../lib/api.ts'
import { at } from '../lib/base.ts'
import { validateAlerts, validateDepartures, validateRouteIndex } from '../lib/contract.server.ts'
import { isActive, routesIn } from '../lib/departures.ts'
import { useApi } from '../lib/mode.ts'
import { liveView, refreshOfflineCopy, useAlerts, useDepartures } from '../lib/queries.ts'
import { cachedRouteIndex } from '../lib/route-index.server.ts'
import { pageMeta, SITE_URL, stopJsonLd, stopMetaTags } from '../lib/seo.ts'
import { fixtureFallbackOn, loaderEnv, settle } from '../lib/server.server.ts'
import { canonicalStopId, routeHref, routeShortOf, stopHref, stopMeta } from '../lib/stops.ts'
import { hasTimetableCopy, pushRecent, toggleSaved, useSavedStops } from '../lib/storage.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/stop'

const StopMap = lazy(() => import('../components/StopMap.tsx'))

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
  const q = useDepartures(fetcher, mode, stopId, loaderData.departures, loaderData.route)
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
  const unconfirmedBefore = useUnconfirmedBefore()
  const { data: res, state } = liveView(stopId, q.data, now, online, unconfirmedBefore)
  const name = res?.stop.name ?? `Stop ${stopId}`
  const routes = useMemo(() => (res ? routesIn(res.departures) : []), [res])
  const platform = res?.departures.find((d) => d.stopId === stopId)?.platform ?? null
  const alerts = alertsQ.data?.alerts ?? []
  const here = stopAlerts(alerts, stopId, routes, Math.floor(now / 1000))
  const isSaved = saved.some((s) => s.id === stopId)

  // Keep this stop's longer timetable on the device at once, not only from the first poll (R6-B1).
  useEffect(() => {
    void refreshOfflineCopy(fetcher, stopId)
  }, [fetcher, stopId])

  useEffect(() => {
    if (res?.stop.name) pushRecent({ id: stopId, name: res.stop.name })
  }, [res?.stop.name, stopId])

  return (
    <>
      <SiteHeader live={state == null && res?.rtState === 'live'} />
      <UpdatedStrip
        updatedAt={res?.generatedAt ?? null}
        sourceS={res?.rtSourceTimestamp ?? null}
        nowMs={now}
        onRefresh={() => q.refetch()}
        refreshing={q.isFetching}
      >
        <DesktopNav active="" />
      </UpdatedStrip>
      {routes.length > 1 || res ? (
        <div className="bg-strip border-b border-ferry-orange/20">
          <div className="mx-auto flex max-w-3xl items-center gap-1.5 overflow-x-auto px-4 py-2">
            {routes.length > 1 || only ? (
              <FilterPills
                label="Filter by route"
                value={pick}
                // ?route= came from the API filtered: "All routes" loads the whole board.
                onChange={
                  only
                    ? (v) => {
                        if (v === 'all') navigate(stopHref(stopId))
                      }
                    : setRoute
                }
                options={[
                  { value: 'all', label: 'All routes' },
                  ...(only ? [only] : routes.slice(0, 12)).map((r) => ({ value: r, label: r })),
                ]}
              />
            ) : null}
            <PillButton icon="map" pressed={showMap} onClick={() => setShowMap((s) => !s)}>
              Map
            </PillButton>
          </div>
        </div>
      ) : null}
      <main className="mx-auto flex max-w-3xl flex-col gap-2.5 px-4 pt-3 pb-4">
        <div className="bg-board-header flex items-center justify-between gap-2 rounded-card border border-ferry-orange/10 px-3.5 py-2.5">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-base font-bold text-aqua-text md:text-lg dark:text-ferry-aqua-light">
              {name}
            </h1>
            <span className="text-xs text-sched-text dark:text-night-text/70">
              {stopMeta(stopId, platform)}
            </span>
          </div>
          <SaveButton saved={isSaved} name={name} onToggle={() => toggleSaved({ id: stopId, name })} />
        </div>
        <DataBanner
          offline={state === 'offline'}
          rtState={res?.rtState}
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
