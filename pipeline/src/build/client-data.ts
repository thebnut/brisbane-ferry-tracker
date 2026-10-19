/**
 * Static client data (transit-architecture.md §3.2, ADR-0004): search index, geohash5 nearby tiles, lines with
 * colours and stopping patterns, and (bus) one route file per line. Built from the trips active anywhere in the build
 * window.
 */
import type {
  GeoTileFile,
  Line,
  LinesFile,
  Mode,
  RouteFile,
  RouteIndexFile,
  StopIndexEntry,
  StopIndexFile,
  StopPattern,
} from '@bft/core'
import { routeFileFor, SCHEMA_VERSION } from '@bft/core'
import type { Feed, RouteRow, StopRow, TripRow } from '../feed/load.ts'
import { geohashEncode } from './geohash.ts'
import type { StopKeys } from './keys.ts'
import { headsignOf, routeRef } from './stop-days.ts'

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const natural = new Intl.Collator('en', { numeric: true }).compare
const round6 = (x: number) => Math.round(x * 1e6) / 1e6

export interface ClientData {
  stops: StopIndexFile
  geo: GeoTileFile[]
  lines: LinesFile
  /** Bus only (the route pages, /route/{short}): one per line that gets a file (routeFileFor). Empty otherwise. */
  routes: RouteFile[]
  /** Bus only: the short names in `routes` (data/bus/routes.json). Null otherwise. */
  routeIndex: RouteIndexFile | null
}

/** `tripIdxs` = every trip of the mode active on at least one date in the window. */
export function buildClientData(
  feed: Feed,
  keys: StopKeys,
  mode: Mode,
  tripIdxs: Iterable<number>,
  generation: string,
): ClientData {
  const st = feed.stopTimes
  const stopRoutes = new Map<string, Set<string>>()
  const platforms = new Map<string, Map<string, string>>()
  /** Keys with at least one boarding (pickup_type != 1, not the trip's last stop), as in stop-days.ts. */
  const boarding = new Set<string>()
  const lines = new Map<string, { routes: Map<string, RouteRow>; patterns: Map<string, StopPattern> }>()

  for (const ti of tripIdxs) {
    const t = feed.trips[ti] as TripRow
    const route = feed.routes.get(t.routeId) as RouteRow
    const seqKeys: string[] = []
    for (let r = t.start; r < t.start + t.count; r++) {
      const si = st.stop[r] as number
      const key = keys.keyOf(mode, si)
      seqKeys.push(key)
      let rs = stopRoutes.get(key)
      if (!rs) {
        rs = new Set()
        stopRoutes.set(key, rs)
      }
      rs.add(route.short)
      if (st.pickup[r] !== 1 && r < t.start + t.count - 1) boarding.add(key)
      if (mode === 'train') {
        const s = feed.stops[si] as StopRow
        let p = platforms.get(key)
        if (!p) {
          p = new Map()
          platforms.set(key, p)
        }
        p.set(s.id, s.platformCode)
      }
    }
    let line = lines.get(route.short)
    if (!line) {
      line = { routes: new Map(), patterns: new Map() }
      lines.set(route.short, line)
    }
    line.routes.set(route.id, route)
    const headsign = headsignOf(feed, t)
    const pk = `${t.directionId}|${headsign}|${seqKeys.join('>')}`
    const pat = line.patterns.get(pk)
    if (pat) pat.trips++
    else line.patterns.set(pk, { directionId: t.directionId, headsign, stops: seqKeys, trips: 1 })
  }

  // Set-down-only bus stops (ADDENDUM 2: UQ Lakes station): the boarding stops sharing their parent station.
  const boardingByParent = new Map<string, Array<{ key: string; name: string }>>()
  if (mode === 'bus')
    for (const key of boarding) {
      const row = feed.stops[feed.stopIndex.get(key) as number] as StopRow
      if (!row.parent) continue
      const list = boardingByParent.get(row.parent) ?? []
      list.push({ key, name: row.name })
      boardingByParent.set(row.parent, list)
    }

  const entries: StopIndexEntry[] = [...stopRoutes.keys()].sort(cmp).map((key) => {
    const row =
      mode === 'train'
        ? (keys.stationOf(key) as StopRow)
        : (feed.stops[feed.stopIndex.get(key) as number] as StopRow)
    const e: StopIndexEntry = {
      key,
      name: row.name,
      lat: round6(row.lat),
      lon: round6(row.lon),
      routes: [...(stopRoutes.get(key) as Set<string>)].sort(natural),
    }
    if (row.code) e.code = row.code
    if (mode === 'bus' && !boarding.has(key))
      e.boardAt = [...(boardingByParent.get(row.parent) ?? [])].sort(
        (a, b) => natural(a.name, b.name) || cmp(a.key, b.key),
      )
    const p = platforms.get(key)
    if (p)
      e.platforms = [...p.entries()]
        .sort((a, b) => natural(a[1], b[1]) || cmp(a[0], b[0]))
        .map(([id, code]) => (code ? { id, code } : { id }))
    return e
  })

  const tiles = new Map<string, GeoTileFile['stops']>()
  for (const e of entries) {
    const gh = geohashEncode(e.lat, e.lon, 5)
    const list = tiles.get(gh) ?? []
    const s: GeoTileFile['stops'][number] = { key: e.key, name: e.name, lat: e.lat, lon: e.lon }
    if (e.code) s.code = e.code
    list.push(s)
    tiles.set(gh, list)
  }

  const lineList: Line[] = [...lines.entries()]
    .sort((a, b) => natural(a[0], b[0]))
    .map(([short, l]) => {
      const routes = [...l.routes.values()].sort((a, b) => cmp(a.id, b.id))
      const first = routeRef(routes[0] as RouteRow)
      const line: Line = {
        short,
        routeIds: routes.map((r) => r.id),
        patterns: [...l.patterns.values()].sort(
          (a, b) => b.trips - a.trips || a.directionId - b.directionId || cmp(a.stops.join('>'), b.stops.join('>')),
        ),
      }
      if (first.long) line.long = first.long
      if (first.color) line.color = first.color
      if (first.textColor) line.textColor = first.textColor
      return line
    })

  const byKey = new Map(entries.map((e) => [e.key, e]))
  const routes =
    mode === 'bus'
      ? lineList.map((l) => routeFileFor(l, byKey, generation, mode)).filter((r): r is RouteFile => r !== null)
      : []

  return {
    stops: { schemaVersion: SCHEMA_VERSION, mode, generation, stops: entries },
    geo: [...tiles.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([geohash, stops]) => ({ schemaVersion: SCHEMA_VERSION, mode, generation, geohash, stops })),
    lines: { schemaVersion: SCHEMA_VERSION, mode, generation, lines: lineList },
    routes,
    routeIndex:
      mode === 'bus' ? { schemaVersion: SCHEMA_VERSION, mode, generation, routes: routes.map((r) => r.short) } : null,
  }
}
