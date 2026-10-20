/** The route stop picker on /route/<short> (P2): directions, the nearest stop, and each stop's filtered board link. */
import type { RouteFile } from './data-contract.ts'
import { haversine } from './geo.ts'
import { stopHref } from './stops.ts'

type Pattern = RouteFile['patterns'][number]

/** The main pattern per direction (the busiest, which the route file lists first), in direction order. */
export function directions(route: RouteFile): Pattern[] {
  const seen = new Set<number>()
  return route.patterns
    .filter((p) => {
      if (seen.has(p.directionId)) return false
      seen.add(p.directionId)
      return true
    })
    .sort((a, b) => a.directionId - b.directionId)
}

/** Position in `stops` of the stop nearest to a point, or -1 for no stops or one more than `maxM` away. */
export function nearestStop(
  stops: readonly { lat: number; lon: number }[],
  at: { lat: number; lon: number },
  maxM = 5_000,
): number {
  let best = -1
  let bestM = maxM
  stops.forEach((s, i) => {
    const m = haversine(at.lat, at.lon, s.lat, s.lon)
    if (m <= bestM) {
      bestM = m
      best = i
    }
  })
  return best
}

/** A stop's board filtered to one route: /stop/<id>?route=<short>. */
export const stopForRouteHref = (stopId: string, short: string) =>
  `${stopHref(stopId)}?route=${encodeURIComponent(short)}`
