/**
 * /route/:route: route detail and per-route map (B-Map). The route's main stopping pattern per direction comes from
 * data/bus/routes/{route}.json (server-rendered stop list); the map (lazy) draws the line, the stops as bus diamonds
 * and the live buses; the sheet lists the buses with where they are. `?trip=` highlights one bus ("Track on map").
 */
import { occupancyText, RouteTile, routeTileVariant, SegmentedControl } from '@bft/ui'
import { lazy, Suspense, useMemo, useState } from 'react'
import { data, Link, useSearchParams } from 'react-router'
import { BusNav, DataBanner, DesktopNav, Footer, SiteHeader, UpdatedStrip } from '../components/Shell.tsx'
import { ApiError, fetchRoute } from '../lib/api.ts'
import { validateRoute } from '../lib/contract.server.ts'
import type { RouteFile } from '../lib/data-contract.ts'
import { haversine } from '../lib/geo.ts'
import { useApi } from '../lib/mode.ts'
import { useVehicles } from '../lib/queries.ts'
import { pageMeta, routeMetaTags, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { stopCode, stopPath, tripPath } from '../lib/stops.ts'
import { useNow } from '../lib/useNow.ts'
import type { Route } from './+types/route'

const RouteMap = lazy(() => import('../components/RouteMap.tsx'))

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const short = params.route
  if (!/^[\w-]{1,12}$/.test(short)) throw data(null, { status: 404 })
  const { fetcher, env } = loaderEnv(request, context)
  let unknown = false
  const route = await settle(async (signal) => {
    try {
      return await fetchRoute(fetcher, short, { signal, validate: validateRoute })
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) unknown = true
      throw error
    }
  })
  if (unknown || (route && route.patterns.length === 0)) throw data(null, { status: 404 })
  if (!route) throw data(null, { status: 503 })
  return { route, renderedAt: Date.now(), siteUrl: env?.SITE_URL ?? SITE_URL }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [{ title: 'Route not found | BrisbaneBus' }, { name: 'robots', content: 'noindex' }]
  const m = routeMetaTags(loaderData.route.short, loaderData.route.long, loaderData.siteUrl)
  return pageMeta({ ...m, siteUrl: loaderData.siteUrl })
}

/** The main pattern per direction (the busiest), in direction order. */
export function directions(route: RouteFile) {
  const seen = new Set<number>()
  return route.patterns.filter((p) => {
    if (seen.has(p.directionId)) return false
    seen.add(p.directionId)
    return true
  })
}

export default function RoutePage({ loaderData }: Route.ComponentProps) {
  const { route } = loaderData
  const [params] = useSearchParams()
  const trip = params.get('trip')
  const dirs = directions(route)
  const [dir, setDir] = useState(String(dirs[0]?.directionId ?? 0))
  const pattern = dirs.find((p) => String(p.directionId) === dir) ?? dirs[0]
  const { mode, fetcher } = useApi()
  const vehiclesQ = useVehicles(fetcher, mode, route.short)
  const now = useNow(loaderData.renderedAt)
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
  if (!pattern) return null
  return (
    <>
      <SiteHeader live={vehiclesQ.data?.rtState === 'live'} />
      <UpdatedStrip
        updatedAt={vehiclesQ.data?.generatedAt ?? null}
        sourceS={vehiclesQ.data?.rtSourceTimestamp ?? null}
        nowMs={now}
      >
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
        <DataBanner rtState={vehiclesQ.data?.rtState} hasData />
        <Suspense fallback={<div className="h-80 animate-pulse rounded-card bg-map-ground" />}>
          <RouteMap
            pattern={pattern}
            vehicles={buses.map((b) => b.v)}
            selectedTrip={trip}
            color={route.color}
            variant={variant}
          />
        </Suspense>
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
                  to={v.tripKey ? tripPath(v.tripKey) : stopPath(near?.key ?? '')}
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
          <h2 id="stops" className="mb-1 text-[15px] font-bold text-aqua-text dark:text-ferry-aqua-light">
            Stops towards {pattern.headsign}
          </h2>
          <ol className="flex flex-col">
            {pattern.stops.map((s, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: loop routes visit a stop twice; position is the identity.
                key={`${s.key}:${i}`}
                className="border-b border-charcoal/5 last:border-0"
              >
                <Link
                  to={stopPath(s.key)}
                  className="flex min-h-11 items-center justify-between gap-2 py-1.5"
                >
                  <span className="text-[15px] font-semibold">{s.name}</span>
                  <span className="text-xs whitespace-nowrap text-sched-text">
                    {s.code ? `Stop ${s.code}` : stopCode(s.key) ? `Stop ${stopCode(s.key)}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
      <BusNav active="" />
    </>
  )
}
