/**
 * The search box's Routes group (P2), a lazy chunk the SearchPanel imports on the first keystroke, so nothing here is
 * on any first load. The route index (data/bus/routes.json, ~1 KB) loads with it; the long names (lines.json, ~65 KB
 * gz, kept by the service worker) only once a query matches a route number or has three letters. Failing soft:
 * without the index there is no group, without the long names the routes show by number only, and the stop results
 * are unchanged either way.
 *
 * A route-like query ("333", "M1") shows the group above the stops, any other below them (`slot`). Each route opens
 * its stop picker (/route/<short>?pick=1).
 */

import { buildRouteSearchIndex, searchRoutes } from '@bft/core/route-search'
import { RouteTile, routeTileVariant } from '@bft/ui'
import { useQuery } from '@tanstack/react-query'
import { useId, useMemo } from 'react'
import { Link } from 'react-router'
import type { LinesFile, RouteIndexFile } from '../lib/data-contract.ts'
import { useApi } from '../lib/mode.ts'
import { routeHref } from '../lib/stops.ts'

export const pickHref = (short: string) => `${routeHref(short)}?pick=1`

/**
 * A plain fetch, not the app's tracked fetcher: these files are optional, so a failure must not mark the whole app
 * offline (that would take LIVE off every board). Same fixture routing as browserFetcher.
 */
async function optionalJson<T>(path: string, fixtures: boolean, signal: AbortSignal): Promise<T> {
  const res = await fetch(fixtures ? `/__fixtures${path}` : path, {
    signal,
    headers: { accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return (await res.json()) as T
}

export default function RouteResults({ query, slot }: { query: string; slot: 'above' | 'below' }) {
  const { mode } = useApi()
  const headingId = useId()
  const q = query.trim()
  const idx = useQuery({
    queryKey: ['bus', 'route-index', mode.fixtures],
    queryFn: ({ signal }) => optionalJson<RouteIndexFile>('/data/bus/routes.json', mode.fixtures, signal),
    staleTime: 300_000,
    retry: 1,
  })
  const shortOnly = useMemo(() => (idx.data ? buildRouteSearchIndex(idx.data.routes) : null), [idx.data])
  const lines = useQuery({
    queryKey: ['bus', 'lines', mode.fixtures],
    queryFn: ({ signal }) => optionalJson<LinesFile>('/data/bus/lines.json', mode.fixtures, signal),
    enabled:
      !!shortOnly && (q.replace(/[^a-z]/gi, '').length >= 3 || searchRoutes(shortOnly, q, 1).hits.length > 0),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  })
  const index = useMemo(
    () => (idx.data && lines.data ? buildRouteSearchIndex(idx.data.routes, lines.data.lines) : shortOnly),
    [idx.data, lines.data, shortOnly],
  )
  const result = index && q ? searchRoutes(index, q, 5) : null
  if (!result?.hits.length || (result.routeLike ? 'above' : 'below') !== slot) return null
  const hits = result.routeLike ? result.hits : result.hits.slice(0, 3)
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-route-results>
      <h2
        id={headingId}
        className="px-1 text-xs font-bold tracking-wide text-sched-text uppercase dark:text-night-text/70"
      >
        Routes
      </h2>
      <p className="sr-only" role="status">
        {hits.length === 1 ? '1 route matches' : `${hits.length} routes match`}
      </p>
      <ul aria-label="Matching routes" className="flex flex-col gap-2">
        {hits.map((r) => (
          <li key={r.short}>
            <Link
              to={pickHref(r.short)}
              className="flex min-h-14 items-center gap-3 rounded-card border-2 border-transparent bg-white/90 px-3.5 py-2.5 no-underline shadow-card dark:bg-night-card"
            >
              <span aria-hidden="true">
                <RouteTile route={r.short} variant={routeTileVariant(r.short, r.long)} size="md" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-bold text-charcoal dark:text-night-text">
                  Route {r.short}
                </span>
                {r.long ? (
                  <span className="text-xs text-sched-text dark:text-night-text/70">{r.long}</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
