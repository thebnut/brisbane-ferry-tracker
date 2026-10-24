/**
 * Merge static stop-day files with the RT snapshot into /v1 departures (transit-architecture.md §3.3 edge read path).
 * Pure function: the Worker, the shadow diff and the tests all call this.
 */
import {
  type Departure,
  downstreamOf,
  type RtSnapshot,
  type RtState,
  type RtTrip,
  type StaticStopDay,
  type StopRef,
  type TripStop,
  tripInstanceKey,
  type Vehicle,
} from '../contract/index.ts'
import { predictStop } from '../rt/state.ts'
import { gtfsToEpoch } from '../time/index.ts'

export interface MergeOptions {
  nowS: number
  /** Destination stop ids (all platforms of a station for train). Empty or undefined = any. */
  toStopIds?: ReadonlySet<string>
  /** Rows that call at any of these stops later are dropped ("away from the city", /v1/ask THE-117). */
  avoidStopIds?: ReadonlySet<string>
  /**
   * `toStopIds` is a set of destinations, any of which will do ("towards the city"): a row stays while one of them is
   * still served, and its arrival is the first served one. Without it, only the first match counts (one destination).
   */
  toAnyServed?: boolean
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
  /**
   * Every platform of the boarding station (stop id → platform code), for platform changes to a platform that no
   * timetabled event uses that day. Without it, only platforms that appear in the stop-day files are recognised.
   */
  stationPlatforms?: ReadonlyMap<string, string | undefined>
  /** A stop id's display name, for an ADDED trip without a headsign (addedTripHeadsign). */
  stopName?: (stopId: string) => string | undefined
}

type AddedTrip = NonNullable<RtTrip['added']>

/**
 * Where an ADDED / DUPLICATED trip is going: the feed's headsign, else the name of its last stop. TransLink's
 * unplanned trains carry no trip_headsign, which left the board row and the trip page reading "To" with nothing after
 * it (smoke round 35).
 */
export function addedTripHeadsign(
  added: AddedTrip,
  stopName?: (stopId: string) => string | undefined,
): string {
  if (added.headsign) return added.headsign
  const last = added.stops[added.stops.length - 1]
  return (last && stopName?.(last.stopId)) || ''
}

/**
 * The trip stops of an ADDED / DUPLICATED trip (/v1/{mode}/trips/rt:…): live estimates and no timetable, so no
 * client can measure a delay against it.
 */
export function addedTripStops(added: AddedTrip): TripStop[] {
  return added.stops.map((s) => ({
    stopId: s.stopId,
    stopSequence: s.seq,
    schedArr: null,
    schedDep: null,
    estArr: s.arr,
    // Same rule as predictStop: a vehicle can't leave a stop before it arrives there.
    estDep: Math.max(s.dep, s.arr),
    status: 'live',
    pickup: 0,
    dropOff: 0,
  }))
}

/**
 * Live platform change (train): the RT update for this stop occurrence names a different stop id that is another
 * platform of the same parent station. Returns the new stop id and platform code, or null when there is no change.
 * A stop id from another station (a feed error, or a different stop) is never treated as a platform change.
 */
export function platformChange(
  rtTrip: RtTrip | undefined,
  seq: number,
  scheduled: StopRef | undefined,
  day: Pick<StaticStopDay, 'stops' | 'stopKey'>,
  stationPlatforms?: ReadonlyMap<string, string | undefined>,
): { stopId: string; platform: string | null } | null {
  const rtStopId = rtTrip?.updates.find((u) => u.seq === seq)?.stopId
  if (!scheduled || !rtStopId || rtStopId === scheduled.id) return null
  if (stationPlatforms?.has(rtStopId))
    return { stopId: rtStopId, platform: stationPlatforms.get(rtStopId) ?? null }
  const station = scheduled.key ?? day.stopKey
  const other = day.stops.find((s) => s.id === rtStopId && (s.key ?? s.id) === station)
  if (!other || (scheduled.key == null && other.key == null)) return null
  return { stopId: other.id, platform: other.platform ?? null }
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
  const avoid = opts.avoidStopIds && opts.avoidStopIds.size > 0 ? opts.avoidStopIds : null
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

      if (avoid) {
        let via = false
        for (let i = 0; i + 3 < ds.length && !via; i += 4)
          via = avoid.has(day.stops[ds[i] as number]?.id ?? '')
        if (via) continue
      }

      // Downstream matches as [arrOffsetS, stop sequence]: the first only, unless any destination will do.
      const dests: Array<[number, number]> = []
      if (to) {
        for (let i = 0; i + 3 < ds.length; i += 4) {
          const stop = day.stops[ds[i] as number]
          if (stop && to.has(stop.id)) {
            dests.push([ds[i + 1] as number, seq + (ds[i + 3] as number)])
            if (!opts.toAnyServed) break
          }
        }
        if (dests.length === 0) continue
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
      if (dests.length > 0) {
        // A service that skips the destination doesn't get you there (every destination, when any will do).
        let served = false
        for (const [offset, toSeq] of dests) {
          const arr = schedDep + offset
          const pTo = predictStop(rtTrip, toSeq, arr, arr, opts.rtState, 'arr')
          if (pTo.status === 'skipped') continue
          schedArrTo = arr
          estArrTo = pTo.status === 'live' ? pTo.estArr : null
          served = true
          break
        }
        if (!served) continue
      }

      const platformStop = day.stops[platformIdx]
      const vehicle = vehicles.get(key)
      const change =
        p.status === 'live' ? platformChange(rtTrip, seq, platformStop, day, opts.stationPlatforms) : null
      const row: Departure = {
        tripInstance: key,
        stopSequence: seq,
        route,
        headsign: day.headsigns[headsignIdx] ?? '',
        directionId: dir,
        stopId: change?.stopId ?? platformStop?.id ?? '',
        platform: change ? change.platform : (platformStop?.platform ?? null),
        schedDep,
        estDep: p.estDep,
        schedArrTo,
        estArrTo,
        status: p.status,
        gps: vehicle != null && opts.rtState === 'live',
        vehicleId: vehicle?.id ?? rtTrip?.vehicleId ?? null,
      }
      if (change && platformStop?.platform && platformStop.platform !== change.platform)
        row.scheduledPlatform = platformStop.platform
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
  // A boarding stop id's platform, the way scheduled rows get theirs (the station's platforms, else the stop-day's).
  const platforms = new Map<string, string | undefined>()
  for (const day of days) for (const s of day.stops) if (s.platform) platforms.set(s.id, s.platform)
  for (const [id, code] of opts.stationPlatforms ?? []) if (code) platforms.set(id, code)
  const out: Departure[] = []
  for (const trip of Object.values(rt.trips)) {
    const added = trip.added
    if (!added || (trip.rel !== 'ADDED' && trip.rel !== 'DUPLICATED')) continue
    if (opts.routes && !opts.routes.has(added.route.short)) continue
    const avoid = opts.avoidStopIds
    const headsign = addedTripHeadsign(added, opts.stopName)
    let chosen: Departure | null = null
    for (let i = 0; i < added.stops.length; i++) {
      const s = added.stops[i] as (typeof added.stops)[number]
      if (!boarding.has(s.stopId) || s.dep < opts.nowS - grace) continue
      if (avoid?.size && added.stops.slice(i + 1).some((d) => avoid.has(d.stopId))) continue
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
        headsign,
        directionId: added.directionId,
        stopId: s.stopId,
        platform: platforms.get(s.stopId) ?? null,
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
