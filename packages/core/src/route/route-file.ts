import {
  type Line,
  type Mode,
  ROUTE_SHORT_RE,
  type RouteFile,
  type RouteStop,
  SCHEMA_VERSION,
} from '../contract/index.ts'

/** The fields routeFileFor reads from a stop index entry. */
type IndexedStop = Pick<RouteStop, 'key' | 'name' | 'code' | 'lat' | 'lon'>

/**
 * The route file of a line (data/{mode}/routes/{short}.json): its two busiest patterns per direction, in the line's
 * order (lines.json sorts patterns busiest first), with each stop's name and position from the stop index. A stop
 * missing from the index is dropped, and so is a pattern left with no stops. Null when the line gets no file: a short
 * name outside ROUTE_SHORT_RE, or no pattern with a known stop (a route page with nothing to list is a 404).
 */
export function routeFileFor(
  line: Line,
  stops: ReadonlyMap<string, IndexedStop>,
  generation: string,
  mode: Mode = 'bus',
): RouteFile | null {
  if (!ROUTE_SHORT_RE.test(line.short)) return null
  const perDir = new Map<number, number>()
  const patterns: RouteFile['patterns'] = []
  for (const p of line.patterns) {
    const n = perDir.get(p.directionId) ?? 0
    if (n >= 2) continue
    const named: RouteStop[] = []
    for (const k of p.stops) {
      const s = stops.get(k)
      if (!s) continue
      named.push(
        s.code
          ? { key: s.key, name: s.name, code: s.code, lat: s.lat, lon: s.lon }
          : { key: s.key, name: s.name, lat: s.lat, lon: s.lon },
      )
    }
    if (named.length === 0) continue
    perDir.set(p.directionId, n + 1)
    patterns.push({ directionId: p.directionId, headsign: p.headsign, trips: p.trips, stops: named })
  }
  if (patterns.length === 0) return null
  const rf: RouteFile = { schemaVersion: SCHEMA_VERSION, mode, generation, short: line.short, patterns }
  if (line.long) rf.long = line.long
  if (line.color) rf.color = line.color
  if (line.textColor) rf.textColor = line.textColor
  return rf
}
