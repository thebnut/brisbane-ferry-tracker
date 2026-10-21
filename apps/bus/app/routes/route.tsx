/**
 * /route/:route: route detail and per-route map (B-Map). The route's main stopping pattern per direction comes from
 * data/bus/routes/{route}.json (server-rendered stop list), for a route data/bus/routes.json lists as current; the map (lazy) draws the line, the stops as bus diamonds
 * and the live buses; the sheet lists the buses with where they are. `?trip=` highlights one bus ("Track on map").
 */

import { ErrorState, RouteTile, routeTileVariant, useGeolocation } from '@bft/ui'
import { occupancyText, SaveButton, SegmentedControl } from '@bft/ui/bus'
import { VIA_NETWORK } from '@bft/ui/connectivity'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { data, Link, useRevalidator, useSearchParams } from 'react-router'
import { ClientOnly } from '../components/ClientOnly.tsx'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { ApiError, fetchRoute, fetchRouteIndex } from '../lib/api.ts'
import { validateRoute, validateRouteIndex } from '../lib/contract.server.ts'
import type { RouteFile } from '../lib/data-contract.ts'
import { haversine } from '../lib/geo.ts'
import { useApi } from '../lib/mode.ts'
import { cachedRouteIndex } from '../lib/route-index.server.ts'
import { directions, nearestStop, stopForRouteHref } from '../lib/route-picker.ts'
import { pageMeta, routeMetaTags, SITE_URL } from '../lib/seo.ts'
import { fixtureFallbackOn, loaderEnv, settle } from '../lib/server.server.ts'
import { stopCode, stopHref, tripHref } from '../lib/stops.ts'
import { toggleSaved, useSavedStops } from '../lib/storage.ts'
import { useNow } from '../lib/useNow.ts'
import { useVehicles } from '../lib/vehicles.ts'
import type { Route } from './+types/route'

// If this small chunk can't load, the page goes on without its map (SafeMap inside covers MapLibre itself).
const NoMap = (() => null) as never // renders nothing, whatever the props
const RouteMap = lazy(() => import('../components/RouteMap.tsx').catch(() => ({ default: NoMap })))

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const short = params.route
  if (!/^[\w-]{1,12}$/.test(short)) throw data(null, { status: 404 })
  const { fetcher, env, fixtures } = loaderEnv(request, context)
  let unknown = false
  // Route files are never deleted, so the index says which are current. Without it (unreadable right now), the file
  // alone decides: a page from the last feed beats a 503. The index is cached in the isolate (route-index.server.ts).
  const [route, index] = await Promise.all([
    settle(async (signal) => {
      try {
        return await fetchRoute(fetcher, short, { signal, validate: validateRoute })
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) unknown = true
        throw error
      }
    }),
    settle((signal) =>
      cachedRouteIndex(() => fetchRouteIndex(fetcher, { signal, validate: validateRouteIndex }), {
        cache: !fixtures && !fixtureFallbackOn(env),
      }),
    ),
  ])
  if (index && !index.routes.includes(short)) unknown = true
  if (unknown || (route && route.patterns.length === 0)) throw data(null, { status: 404 })
  // The file couldn't be read (R2 slow, or the API down): the page says so with a Try again (RouteUnavailable), never
  // the app's "Something went wrong". 503, so it isn't indexed or cached as the route's page.
  if (!route)
    return data(
      { route: null, renderedAt: Date.now(), via: VIA_NETWORK, siteUrl: env?.SITE_URL ?? SITE_URL },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  return { route, renderedAt: Date.now(), via: VIA_NETWORK, siteUrl: env?.SITE_URL ?? SITE_URL }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [{ title: 'Route not found | BrisbaneBus' }, { name: 'robots', content: 'noindex' }]
  if (!loaderData.route)
    return [{ title: 'Route unavailable | BrisbaneBus' }, { name: 'robots', content: 'noindex' }]
  const m = routeMetaTags(loaderData.route.short, loaderData.route.long, loaderData.siteUrl)
  return pageMeta({ ...m, siteUrl: loaderData.siteUrl })
}

export default function RoutePage({ loaderData }: Route.ComponentProps) {
  return loaderData.route ? (
    <RouteDetail route={loaderData.route} renderedAt={loaderData.renderedAt} />
  ) : (
    <RouteUnavailable />
  )
}

function RouteUnavailable() {
  const revalidator = useRevalidator()
  return (
    <>
      <SiteHeader live={false} />
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-3.5 pb-28">
        <ErrorState title="Couldn't load this route" onRetry={() => revalidator.revalidate()}>
          Route details are slow to load right now. Check your connection and try again.
        </ErrorState>
      </main>
      <Footer />
      <BusNav active="" />
    </>
  )
}

function RouteDetail({ route, renderedAt }: { route: RouteFile; renderedAt: number }) {
  const [params] = useSearchParams()
  const trip = params.get('trip')
  const pick = params.get('pick') === '1'
  const dirs = directions(route)
  const [dir, setDir] = useState(String(dirs[0]?.directionId ?? 0))
  const pattern = dirs.find((p) => String(p.directionId) === dir) ?? dirs[0]
  const { mode, fetcher } = useApi()
  const vehiclesQ = useVehicles(fetcher, mode, route.short)
  const now = useNow(renderedAt)
  const variant = routeTileVariant(route.short, route.long)
  const vehicles = vehiclesQ.data?.vehicles ?? []
  const buses = useMemo(() => {
    if (!pattern) return []
    return vehicles
      .map((v) => {
        let best = pattern.stops[0]
        let bestM = Number.POSITIVE_INFINITY
        for (const s of pattern.stops) {
          const m = haversine(v.lat, v.lon, s.lat, s.lon)
          if (m < bestM) {
            bestM = m
            best = s
          }
        }
        return { v, near: best, metres: bestM }
      })
      .filter((b) => b.metres < 1500)
  }, [vehicles, pattern])
  // The stop picker (P2): the nearest stop only if location is already allowed (never prompts), Save per stop, and
  // from search (?pick=1) the stop list in view.
  const geolocation = useGeolocation()
  const { geo } = geolocation
  const nearest = pattern && geo.state === 'ok' ? nearestStop(pattern.stops, geo) : -1
  const saved = useSavedStops()
  const stopsHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (!pick) return
    stopsHeading.current?.scrollIntoView({ block: 'start' })
    stopsHeading.current?.focus({ preventScroll: true })
  }, [pick])
  if (!pattern) return null
  return (
    <>
      <SiteHeader live={vehiclesQ.data?.rtState === 'live'} />
      <UpdatedStrip updatedAt={vehiclesQ.data?.generatedAt ?? null} source={vehiclesQ.data} nowMs={now}>
        <DesktopNav active="" />
      </UpdatedStrip>
      <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 pt-3.5 pb-28">
        <div className="flex items-center gap-3">
          <RouteTile route={route.short} variant={variant} size="lg" />
          <div className="min-w-0">
            <h1 className="text-xl leading-tight font-extrabold">Route {route.short}</h1>
            {route.long ? <p className="text-sm text-sched-text">{route.long}</p> : null}
          </div>
        </div>
        {dirs.length > 1 ? (
          <SegmentedControl
            label="Direction"
            value={dir}
            onChange={setDir}
            options={dirs.map((p) => ({ value: String(p.directionId), label: `To ${p.headsign}` }))}
          />
        ) : null}
        <DataBanner rtState={vehiclesQ.data?.rtState} hasData generation={vehiclesQ.data?.staticGeneration} />
        <ClientOnly fallback={<div className="h-80 animate-pulse rounded-card bg-map-ground md:h-[28rem]" />}>
          {() => (
            <Suspense
              fallback={<div className="h-80 animate-pulse rounded-card bg-map-ground md:h-[28rem]" />}
            >
              <RouteMap
                pattern={pattern}
                vehicles={buses.map((b) => b.v)}
                selectedTrip={trip}
                color={route.color}
                variant={variant}
                geolocation={geolocation}
              />
            </Suspense>
          )}
        </ClientOnly>
        <section
          aria-labelledby="buses"
          className="rounded-t-[22px] border-t border-ferry-orange/20 bg-white/97 px-4 pt-3 pb-2 shadow-[0_-8px_24px_rgb(0_0_0/0.08)] dark:bg-night-2"
        >
          <div className="flex items-center gap-2.5">
            <RouteTile route={route.short} variant={variant} size="md" />
            <div className="flex flex-col">
              <h2 id="buses" className="text-base font-bold">
                {buses.length === 1 ? '1 bus' : `${buses.length} buses`} on route {route.short}
              </h2>
              <span className="text-xs text-sched-text">Positions refresh every 15 s</span>
            </div>
          </div>
          <ul className="mt-1">
            {buses.map(({ v, near }) => (
              <li key={v.id} className="border-t border-charcoal/5">
                <Link
                  to={v.tripKey ? tripHref(v.tripKey) : stopHref(near?.key ?? '')}
                  className="flex min-h-11 items-center gap-2.5 py-2"
                  data-selected={v.tripKey === trip || undefined}
                >
                  <span
                    aria-hidden="true"
                    className={`size-3.5 shrink-0 rounded-full border-[3px] border-white shadow-[0_0_0_2px_rgb(0_168_204/0.35)] ${v.tripKey === trip ? 'bg-ferry-orange' : 'bg-ferry-aqua'}`}
                  />
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-bold">
                      {v.status === 'STOPPED_AT' ? 'At' : 'Near'} {near?.name}
                    </span>
                    <span className="text-xs text-sched-text">
                      {[v.label ? `Bus #${v.label}` : null, occupancyText(v.occupancy)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
            {buses.length === 0 ? (
              <li className="border-t border-charcoal/5 py-3 text-sm text-sched-text">
                No buses on this route are reporting a position right now.
              </li>
            ) : null}
          </ul>
        </section>
        <section
          aria-labelledby="stops"
          className="rounded-card bg-white/90 px-3.5 py-3 shadow-card dark:bg-night-card"
        >
          <h2
            id="stops"
            ref={stopsHeading}
            tabIndex={-1}
            className="mb-1 scroll-mt-20 text-[15px] font-bold text-aqua-text outline-none dark:text-ferry-aqua-light"
          >
            {pick ? 'Choose your stop towards' : 'Stops towards'} {pattern.headsign}
          </h2>
          <ol className="flex flex-col">
            {pattern.stops.map((s, i) => {
              const isSaved = saved.some((x) => x.id === s.key)
              const code = s.code ?? stopCode(s.key)
              return (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: loop routes visit a stop twice; position is the identity.
                  key={`${s.key}:${i}`}
                  className={`flex items-center gap-2 border-b border-charcoal/5 last:border-0 ${i === nearest ? '-mx-2 rounded-card bg-ferry-light-blue px-2 dark:bg-night-2' : ''}`}
                  data-nearest={i === nearest || undefined}
                >
                  <Link
                    to={stopForRouteHref(s.key, route.short)}
                    className="flex min-h-11 flex-1 items-center justify-between gap-2 py-1.5"
                  >
                    <span className="flex flex-col">
                      <span className="text-[15px] font-semibold">{s.name}</span>
                      {i === nearest ? (
                        <span className="text-xs font-bold text-ferry-orange-aa dark:text-ferry-sunset">
                          Nearest to you
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs whitespace-nowrap text-sched-text">
                      {code ? `Stop ${code}` : ''}
                    </span>
                  </Link>
                  <SaveButton
                    saved={isSaved}
                    name={s.name}
                    onToggle={() => toggleSaved({ id: s.key, name: s.name })}
                  />
                </li>
              )
            })}
          </ol>
        </section>
      </main>
      <Footer />
      <BusNav active="" />
    </>
  )
}
