/**
 * /stop/:stopId: server-rendered stop board (B-Departures). The loader fetches /v1 departures in-process so the
 * rows are in the HTML; the client then polls every 15 s. Route filter pills, the Save star (My Transit), alert strip and a
 * lazy per-stop map with the buses heading here.
 *
 * A layout over the board URL and the trip URL (THE-118 PR 7): at 1024 px and wider the board is a column beside a
 * panel, which shows the trip a row opened, else the stop's map. The board stays as it is (not fetched again) while
 * the trip opens and closes. On a trip URL the board is the stop it was opened from (`?from=`); below 1024, or with
 * `?full=1`, the trip is its own page.
 */

import type { Alert } from '@bft/core/contract'
import { boardState, type LinkRenderer } from '@bft/ui'
import { AlertCountLink, useCurrentAlerts } from '@bft/ui/alert-count'
import { BoardHeader, Chip, FilterRow, NowChip } from '@bft/ui/board-header'
import { FULL, isWide, notWide, onWide, type PanelState, samePlace, showBoard } from '@bft/ui/board-route'
import { NoticeStrip } from '@bft/ui/bus'
import { awaitingSeedAnswer, pagePending, usePageCheck, VIA_NETWORK } from '@bft/ui/connectivity'
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  data,
  Link,
  Outlet,
  redirect,
  type ShouldRevalidateFunctionArgs,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router'
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
// The trip as the board's panel (THE-118 PR 7): loaded with the trip, never on the board's first load.
const TripPanelHost = lazy(() => import('@bft/ui/panel'))
const StopMap = lazy(() => import('../components/StopMap.tsx').catch(() => ({ default: NoMap })))

/**
 * A stop board row's link: the board's URL as its state, so the trip's back link returns here (THE-118 PR 6). Bus home
 * keeps the plain one (StopBoard), off its first load.
 */
function DeskRowLink({ href, className, children, label }: Parameters<LinkRenderer>[0]) {
  const { pathname, search } = useLocation()
  // Desktop (THE-118 PR 7): the open trip's row is marked; a row picked beside it replaces it in history, keeping
  // what that entry knew of the board (a trip is never recorded as the board); and the board keeps its scroll (a trip's
  // own page starts at the top itself: TripBackLink).
  const open = useParams().tripInstance
  return (
    <Link
      to={href}
      className={className}
      aria-label={label}
      prefetch="intent"
      state={open ? history.state?.usr : boardState(pathname, search)}
      replace={!!open}
      preventScrollReset
      aria-current={(open && href.includes(`/${encodeURIComponent(open)}?`)) || undefined}
    >
      {children}
    </Link>
  )
}
const deskRowLink: LinkRenderer = (props) => <DeskRowLink {...props} />

const STOP_RE = /^[\w-]{1,32}$/

export async function loader({ request, context, params }: Route.LoaderArgs) {
  if (!params.stopId) {
    // The trip URL: the board beside it is fetched by the browser, and only on desktop (a phone shows the trip alone).
    const { env } = loaderEnv(request, context)
    const from = new URL(request.url).searchParams.get('from')
    return {
      stopId: from && STOP_RE.test(from) ? from : null,
      departures: null,
      alerts: null,
      board: false,
      route: undefined,
      renderedAt: Date.now(),
      via: VIA_NETWORK,
      siteUrl: env?.SITE_URL ?? SITE_URL,
    }
  }
  const stopId = params.stopId
  if (!STOP_RE.test(stopId)) throw data(null, { status: 404 })
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
    board: true,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    siteUrl: env?.SITE_URL ?? SITE_URL,
    ...(route ? { route } : {}),
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

/** Not again for a trip opening or closing beside the board, only for another stop or route filter (THE-118 PR 7). */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs) {
  return samePlace(args, 'stop') ? false : args.defaultShouldRevalidate
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData?.stopId)
    return [{ title: 'Stop not found | BrisbaneBus' }, { name: 'robots', content: 'noindex' }]
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

type Data = Route.ComponentProps['loaderData']

export default function StopPage({ loaderData }: Route.ComponentProps) {
  const { stopId } = loaderData
  const trip = useParams().tripInstance
  const wide = useSyncExternalStore(onWide, isWide, notWide)
  const [search] = useSearchParams()
  // Which board this layout shows, before a trip's full page returns (Codex r3): its own data, not a placeholder.
  showBoard(
    'stop',
    stopId && loaderData.board ? { from: stopId, to: null, filter: loaderData.route ?? null } : null,
  )
  // The trip alone: a phone or tablet, its full page, or a trip with no stop to show the board of.
  if (trip && (!wide || !stopId || search.has(FULL))) return <Outlet />
  if (!stopId) return null
  return <StopBoardPage loaderData={{ ...loaderData, stopId }} trip={trip} panel={trip ? <Outlet /> : null} />
}

function StopBoardPage({
  loaderData,
  trip: open,
  panel,
}: {
  loaderData: Data & { stopId: string }
  /** The trip open in the panel (the trip URL, desktop), and the trip page as the panel. */
  trip?: string
  panel: ReactNode
}) {
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

  const wide = useSyncExternalStore(onWide, isWide, notWide)
  const { pathname, search } = useLocation()
  const [panelState, setPanelState] = useState<PanelState | null>(null)
  // The header counts the open trip's own answer like a board's (R32-RT1).
  const live = state == null && res?.rtState === 'live'
  const panelOn = open ? panelState : null
  const head = panelOn
    ? { live: live && panelOn.live, pending: pagePending([{ q, state }, panelOn]) }
    : { live, pending }
  // At 1024 px and wider with no trip open, the panel has the stop's map: never a second one in the column.
  const panelMap = wide && !open

  return (
    <>
      <SiteHeader live={head.live} pending={head.pending}>
        <DesktopNav active="" />
      </SiteHeader>
      <main className="board-grid mx-auto max-w-6xl px-4 pt-3 pb-4">
        <div
          data-board-column=""
          className="mx-auto flex w-full max-w-[46rem] min-w-0 flex-col gap-2.5 lg:mx-0 lg:max-w-none"
        >
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
              <Chip icon="map" pressed={showMap || panelMap} onClick={() => setShowMap((s) => !s)}>
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
          {showMap && !panelMap ? (
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
            renderLink={deskRowLink}
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
        </div>
        {/* The panel (1024 px and wider): the open trip, else the stop's map. */}
        <div className="board-panel" data-panel="">
          {open ? (
            <Suspense fallback={null}>
              <TripPanelHost
                trip={open}
                board={`${stopHref(stopId)}${only ? `?route=${encodeURIComponent(only)}` : ''}`}
                here={`${pathname}${search}`}
                go={navigate}
                back={() => navigate(-1)}
                report={setPanelState}
              >
                {panel}
              </TripPanelHost>
            </Suspense>
          ) : wide ? (
            <Suspense fallback={<div className="h-80 rounded-card bg-map-ground" />}>
              <StopMap stopId={stopId} name={name} departures={res?.departures ?? []} />
            </Suspense>
          ) : null}
        </div>
      </main>
      <Footer />
      <BusNav active="" alertCount={here.length || undefined} />
    </>
  )
}
