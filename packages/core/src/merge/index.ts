/**
 * Merge static stop-day files with the RT snapshot into /v1 departures (transit-architecture.md §3.3 edge read path).
 * Pure function: the Worker, the shadow diff and the tests all call this.
 */
import {
  type Departure,
  downstreamOf,
  type RtSnapshot,
  type RtState,
  type StaticStopDay,
  tripInstanceKey,
  type Vehicle,
} from '../contract/index.ts'
import { predictStop } from '../rt/state.ts'
import { gtfsToEpoch } from '../time/index.ts'

export interface MergeOptions {
  nowS: number
  /** Destination stop ids (all platforms of a station for train). Empty or undefined = any. */
  toStopIds?: ReadonlySet<string>
  limit?: number
  rtState: RtState
  /** Rows whose effective departure is older than this many seconds are dropped. */
  graceS?: number
  /** Include the downstream stop list on each row (stopping patterns). */
  withStopsAfter?: boolean
  /** Only rows whose route short name is in this set. */
  routes?: ReadonlySet<string>
  /** Stop ids you can board at for this stop key. Defaults to the platforms referenced by the stop-day files. */
  boardingStopIds?: ReadonlySet<string>
}

export function vehiclesByTrip(vehicles: Vehicle[]): Map<string, Vehicle> {
  const m = new Map<string, Vehicle>()
  for (const v of vehicles) if (v.tripKey) m.set(v.tripKey, v)
  return m
}

export function mergeDepartures(
  days: StaticStopDay[],
  rt: RtSnapshot | null,
  opts: MergeOptions,
  vehicles: Map<string, Vehicle> = rt ? vehiclesByTrip(rt.vehicles) : new Map(),
): Departure[] {
  const grace = opts.graceS ?? 30
  const to = opts.toStopIds && opts.toStopIds.size > 0 ? opts.toStopIds : null
  const rows: Departure[] = []
  // For a `to` query on a loop that repeats the boarding stop, keep only the last boarding before the destination.
  const bestByTrip = new Map<string, number>()

  for (const day of days) {
    for (const ev of day.events) {
      const [tripIdx, seq, arrS, depS, routeIdx, headsignIdx, platformIdx, , dir] = ev
      const ds = downstreamOf(day, ev)
      const route = day.routes[routeIdx]
      if (!route) continue
      if (opts.routes && !opts.routes.has(route.short)) continue

      let toArrOffset: number | null = null
      let toSeq: number | null = null
      if (to) {
        for (let i = 0; i + 3 < ds.length; i += 4) {
          const stop = day.stops[ds[i] as number]
          if (stop && to.has(stop.id)) {
            toArrOffset = ds[i + 1] as number
            toSeq = seq + (ds[i + 3] as number)
            break
          }
        }
        if (toArrOffset == null) continue
      }

      const tripId = day.trips[tripIdx] as string
      const key = tripInstanceKey(tripId, day.serviceDate)
      const rtTrip = rt?.trips[key]
      const schedDep = gtfsToEpoch(day.serviceDate, depS)
      const schedArr = gtfsToEpoch(day.serviceDate, arrS)
      const p = predictStop(rtTrip, seq, schedArr, schedDep, opts.rtState)
      const effective = p.estDep ?? schedDep
      if (effective < opts.nowS - grace) continue

      let schedArrTo: number | null = null
      let estArrTo: number | null = null
      if (toArrOffset != null && toSeq != null) {
        schedArrTo = schedDep + toArrOffset
        const pTo = predictStop(rtTrip, toSeq, schedArrTo, schedArrTo, opts.rtState)
        estArrTo = pTo.status === 'live' ? pTo.estArr : null
        // A service that skips the destination doesn't get you there.
        if (pTo.status === 'skipped') continue
      }

      const platformStop = day.stops[platformIdx]
      const vehicle = vehicles.get(key)
      const row: Departure = {
        tripInstance: key,
        stopSequence: seq,
        route,
        headsign: day.headsigns[headsignIdx] ?? '',
        directionId: dir,
        stopId: platformStop?.id ?? '',
        platform: platformStop?.platform ?? null,
        schedDep,
        estDep: p.estDep,
        schedArrTo,
        estArrTo,
        status: p.status,
        gps: vehicle != null && opts.rtState === 'live',
        vehicleId: vehicle?.id ?? rtTrip?.vehicleId ?? null,
      }
      if (opts.withStopsAfter) {
        const after: string[] = []
        for (let i = 0; i + 3 < ds.length; i += 4) {
          const s = day.stops[ds[i] as number]
          if (s) after.push(s.id)
        }
        row.stopsAfter = after
      }
      if (to) {
        const prev = bestByTrip.get(key)
        if (prev != null) {
          const existing = rows[prev] as Departure
          // A skipped visit never replaces a usable boarding (Codex PR38 #3); otherwise prefer the later boarding.
          const rowUsable = row.status !== 'skipped'
          const existingUsable = existing.status !== 'skipped'
          const better = rowUsable !== existingUsable ? rowUsable : schedDep > existing.schedDep
          if (better) rows[prev] = row
          continue
        }
        bestByTrip.set(key, rows.length)
      }
      rows.push(row)
    }
  }

  if (rt && opts.rtState === 'live') rows.push(...addedTripRows(days, rt, opts, to, grace, vehicles))

  rows.sort((a, b) => (a.estDep ?? a.schedDep) - (b.estDep ?? b.schedDep) || a.schedDep - b.schedDep)
  return opts.limit ? rows.slice(0, opts.limit) : rows
}

/**
 * Rows for ADDED / DUPLICATED trips that have no static events (Codex PR38 #2). The hub only publishes these when
 * their stop list resolved; times are RT predictions, so the rows are live by construction.
 */
function addedTripRows(
  days: StaticStopDay[],
  rt: RtSnapshot,
  opts: MergeOptions,
  to: ReadonlySet<string> | null,
  grace: number,
  vehicles: Map<string, Vehicle>,
): Departure[] {
  let boarding = opts.boardingStopIds
  if (!boarding) {
    const ids = new Set<string>()
    for (const day of days) {
      ids.add(day.stopKey)
      for (const ev of day.events) {
        const stop = day.stops[ev[6]]
        if (stop) ids.add(stop.id)
      }
    }
    boarding = ids
  }
  const out: Departure[] = []
  for (const trip of Object.values(rt.trips)) {
    const added = trip.added
    if (!added || (trip.rel !== 'ADDED' && trip.rel !== 'DUPLICATED')) continue
    if (opts.routes && !opts.routes.has(added.route.short)) continue
    let chosen: Departure | null = null
    for (let i = 0; i < added.stops.length; i++) {
      const s = added.stops[i] as (typeof added.stops)[number]
      if (!boarding.has(s.stopId) || s.dep < opts.nowS - grace) continue
      let arrTo: number | null = null
      if (to) {
        const dest = added.stops.slice(i + 1).find((d) => to.has(d.stopId))
        if (!dest) continue
        arrTo = dest.arr
      }
      const vehicle = vehicles.get(trip.key)
      const row: Departure = {
        tripInstance: trip.key,
        stopSequence: s.seq,
        route: added.route,
        headsign: added.headsign,
        directionId: added.directionId,
        stopId: s.stopId,
        platform: null,
        schedDep: s.dep,
        estDep: s.dep,
        schedArrTo: arrTo,
        estArrTo: arrTo,
        status: 'live',
        gps: vehicle != null,
        vehicleId: vehicle?.id ?? trip.vehicleId ?? null,
      }
      if (opts.withStopsAfter) row.stopsAfter = added.stops.slice(i + 1).map((d) => d.stopId)
      if (to) chosen = row
      else out.push(row)
    }
    if (chosen) out.push(chosen)
  }
  return out
}
