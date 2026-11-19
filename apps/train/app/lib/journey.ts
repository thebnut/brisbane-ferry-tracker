/**
 * The train home's journey planner ("Where are you going?", @bft/ui/planner): From first, then To. Worked out from the
 * stations and stopping patterns bundled with the app (network.ts), so a position never leaves the phone and nothing
 * is fetched to plan. A pair no train runs between directly gets one change at most ("Change at Roma Street").
 */
import { LINES, STATIONS, type Station, stationByKey } from './network.ts'

let index: Map<string, Set<string>> | null = null
/** Every station's directly reachable stations (network.ts isReachable, worked out once for all of them). */
function reach(key: string): Set<string> {
  if (!index) {
    index = new Map()
    for (const l of LINES)
      for (const p of l.patterns)
        p.stations.forEach((k, i) => {
          const set = index?.get(k) ?? new Set<string>()
          index?.set(k, set)
          for (const later of p.stations.slice(i + 1)) if (later !== k) set.add(later)
        })
  }
  return index.get(key) ?? new Set()
}

/** A train runs from one station to the other without a change. */
export const isDirect = (fromKey: string, toKey: string) => fromKey !== toKey && reach(fromKey).has(toKey)

/** Popular destinations (the To chips), in order. */
export const POPULAR_TO = [
  'central',
  'roma-street',
  'fortitude-valley',
  'south-brisbane',
  'domestic-airport',
] as const

/** Distance in metres (haversine). */
function metres(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

export type Plan =
  | { kind: 'same' }
  | { kind: 'direct' }
  /** One change: ride to `via`, then on to the destination. */
  | { kind: 'change'; via: Station }
  | { kind: 'none' }

/**
 * How to get from one station to another: a direct train, or one change at the station both legs reach directly (the
 * shortest by distance, from → via → to).
 */
export function planTrip(fromKey: string, toKey: string): Plan {
  if (fromKey === toKey) return { kind: 'same' }
  const from = stationByKey(fromKey)
  const to = stationByKey(toKey)
  if (!from || !to) return { kind: 'none' }
  if (isDirect(fromKey, toKey)) return { kind: 'direct' }
  let best: { via: Station; m: number } | null = null
  for (const key of reach(fromKey)) {
    const via = stationByKey(key)
    if (!via || key === toKey || !isDirect(key, toKey)) continue
    const m = metres(from, via) + metres(via, to)
    if (!best || m < best.m) best = { via, m }
  }
  return best ? { kind: 'change', via: best.via } : { kind: 'none' }
}

/** The stations nearest a position, closest first. */
export function closestStations(lat: number, lon: number, limit = 3) {
  return STATIONS.map((s) => ({ station: s, metres: metres({ lat, lon }, s) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, limit)
}

/** Where a trip starts by default once the position is known: of the three nearest, the closest with a direct train. */
export function nearestStart(lat: number, lon: number, toKey: string | null): Station | null {
  const near = closestStations(lat, lon).filter((c) => c.station.key !== toKey)
  const direct = toKey ? near.find((c) => isDirect(c.station.key, toKey)) : undefined
  return (direct ?? near[0])?.station ?? null
}

/** The planner's last destination on this device (a station key): localStorage only, as Saved. */
export const LAST_TO_KEY = 'bft-train-last-to'

export function readLastTo(): Station | null {
  try {
    return stationByKey(localStorage.getItem(LAST_TO_KEY))
  } catch {
    return null
  }
}

export function writeLastTo(key: string | null): void {
  try {
    if (key) localStorage.setItem(LAST_TO_KEY, key)
    else localStorage.removeItem(LAST_TO_KEY)
  } catch {
    // Storage off (private mode): the planner just starts blank next time.
  }
}
