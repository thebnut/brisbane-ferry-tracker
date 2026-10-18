import type { Line, RouteFile, RouteStop, StopIndexEntry } from './data-contract.ts'

/** The two busiest patterns per direction of a line, with stop names and positions (data/bus/routes/{short}.json). */
export function routeFileFor(line: Line, stops: Map<string, StopIndexEntry>, generation: string): RouteFile {
  const perDir = new Map<number, number>()
  const patterns: RouteFile['patterns'] = []
  for (const p of line.patterns) {
    const n = perDir.get(p.directionId) ?? 0
    if (n >= 2) continue
    perDir.set(p.directionId, n + 1)
    patterns.push({
      directionId: p.directionId,
      headsign: p.headsign,
      trips: p.trips,
      stops: p.stops
        .map((k) => stops.get(k))
        .filter((s): s is StopIndexEntry => !!s)
        .map(
          ({ key, name, code, lat, lon }): RouteStop =>
            code ? { key, name, code, lat, lon } : { key, name, lat, lon },
        ),
    })
  }
  const rf: RouteFile = { schemaVersion: 1, mode: 'bus', generation, short: line.short, patterns }
  if (line.long) rf.long = line.long
  if (line.color) rf.color = line.color
  if (line.textColor) rf.textColor = line.textColor
  return rf
}
