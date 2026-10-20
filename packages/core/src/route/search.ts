/**
 * Route search for the stop search boxes (P2): match a query against route short names ("66", "333", "M1") and the
 * words of their long names ("Chermside", "UQ Lakes"). Built from the short names of data/{mode}/routes.json (the
 * routes with a page) plus, when loaded, the long names from lines.json; no zod, so it stays out of the contract's
 * weight in the browser (import it as `@bft/core/route-search`).
 */

export interface RouteName {
  short: string
  long?: string
}

export interface RouteSearchIndex {
  routes: RouteName[]
  /** Upper-cased short name → position in `routes`. */
  byShort: Map<string, number>
  /** Lower-cased words of each long name, by position. */
  words: string[][]
}

export interface RouteSearchResult {
  hits: RouteName[]
  /** The query looks like a route number: the search box shows Routes above Stops. */
  routeLike: boolean
}

/** "66", "333", "M1", "N199", "TX7", "R348", optionally after "route" or "#". */
const ROUTE_LIKE = /^(?:route\s*)?#?([a-z]{0,2}\d{1,4}[a-z]?)$/i

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Route short names in timetable order: letters prefix, then number ("29" < "61" < "100" < "M1" < "N100"). */
export function compareShort(a: string, b: string): number {
  const pa = /^([A-Za-z]*)(\d*)(.*)$/.exec(a) as RegExpExecArray
  const pb = /^([A-Za-z]*)(\d*)(.*)$/.exec(b) as RegExpExecArray
  return (
    (pa[1] as string).localeCompare(pb[1] as string) ||
    Number(pa[2] || 0) - Number(pb[2] || 0) ||
    a.localeCompare(b)
  )
}

/**
 * The index over the current routes (`shorts`, from the route index). `lines` adds long names; a line whose short
 * name is not in `shorts` has no page and is left out.
 */
export function buildRouteSearchIndex(
  shorts: readonly string[],
  lines: readonly RouteName[] = [],
): RouteSearchIndex {
  const longs = new Map<string, string>()
  for (const l of lines) if (l.long && !longs.has(l.short)) longs.set(l.short, l.long)
  const routes = [...new Set(shorts)].sort(compareShort).map((short) => {
    const long = longs.get(short)
    return long ? { short, long } : { short }
  })
  return {
    routes,
    byShort: new Map(routes.map((r, i) => [r.short.toUpperCase(), i])),
    words: routes.map((r) => (r.long ? words(r.long) : [])),
  }
}

/**
 * Routes matching `query`, best first:
 *  1. the exact short name ("333", "m1", "route 61");
 *  2. for a route-like query, short names that start with it ("33" → 330, 333…), in timetable order;
 *  3. for a query with three or more letters, routes whose long name has a word starting with every query word
 *     ("cherm" → Chermside, "uq lakes" → RBWH - UQ Lakes via City), in timetable order.
 */
export function searchRoutes(index: RouteSearchIndex, query: string, limit = 5): RouteSearchResult {
  const q = query.trim()
  const m = ROUTE_LIKE.exec(q)
  const short = (m ? (m[1] as string) : q).toUpperCase()
  const exact = index.byShort.get(short)
  const routeLike = m != null || exact != null
  const out: number[] = exact != null ? [exact] : []
  const add = (i: number) => {
    if (out.length < limit && !out.includes(i)) out.push(i)
  }
  if (m) {
    index.routes.forEach((r, i) => {
      if (r.short.toUpperCase().startsWith(short)) add(i)
    })
  }
  const qw = words(q)
  if (!routeLike && q.replace(/[^a-z]/gi, '').length >= 3 && qw.length) {
    index.words.forEach((ws, i) => {
      if (qw.every((w) => ws.some((x) => x.startsWith(w)))) add(i)
    })
  }
  return { hits: out.map((i) => index.routes[i] as RouteName), routeLike }
}
