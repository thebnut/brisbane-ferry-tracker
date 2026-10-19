/**
 * Isolate cache for the route index (data/bus/routes.json), shared by the route page loader and the routes sitemap.
 * The API reads R2 on every call and its max-age does nothing for a service-binding fetch, so without this every
 * route page render cost two R2 reads (R2).
 *  - Only a parsed, contract-valid index is kept, for ROUTE_INDEX_TTL_MS from when its fetch began: a new publish
 *    shows within 5 minutes.
 *  - Nothing else is cached: a failure, a 404 or an invalid index is fetched again by the next request, so a site
 *    whose first publish lands after it starts recovers at once.
 *  - No in-flight fetch is shared. Concurrent misses each fetch under their own caller's signal and budget, so a hung
 *    fetch can only ever hold up the request that started it (#77/#79).
 *  - Fixtures and demo data bypass it (cache: false), so a fixture index never answers a live render or the reverse.
 */
import type { RouteIndexFile } from './data-contract.ts'

export const ROUTE_INDEX_TTL_MS = 300_000

/** `started` is when the fetch behind it began: a slow fetch that began earlier never replaces a newer answer. */
let hit: { index: RouteIndexFile; started: number; until: number } | null = null

export async function cachedRouteIndex(
  load: () => Promise<RouteIndexFile>,
  opts: { cache?: boolean } = {},
): Promise<RouteIndexFile> {
  if (opts.cache === false) return load()
  if (hit && Date.now() < hit.until) return hit.index
  const started = Date.now()
  const index = await load()
  if (!hit || started >= hit.started) hit = { index, started, until: started + ROUTE_INDEX_TTL_MS }
  return index
}

/** Tests only: forget the cached index. */
export function resetRouteIndexCache() {
  hit = null
}
