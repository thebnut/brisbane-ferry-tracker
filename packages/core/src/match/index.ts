/**
 * Tiered RT-to-static trip-instance matching (transit-architecture.md §3.3, ADR-0007, Codex finding 2).
 *
 * Tiers, in order:
 *  1. Exact trip_id + start_date (or, without start_date, a unique trip_id across the indexed days).
 *  2. (route, direction, start_time, start_date) identifying exactly one instance.
 *  3. Rail only: stable trip-ID prefix + route + compatible stop pattern, exactly one candidate.
 *  4. Same route and direction, compatible stop pattern, departure within ±5 min at a matched stop_sequence,
 *     exactly one candidate.
 * Ambiguous matches stay unmatched: a scheduled row is safer than another trip's delay.
 */
import { type Mode, type TripIndexDay, tripInstanceKey } from '../contract/index.ts'
import { addDays, gtfsTimeToSeconds, gtfsToEpoch } from '../time/index.ts'

export interface RtDescriptor {
  tripId?: string
  startDate?: string
  startTime?: string
  routeId?: string
  directionId?: number
}

export interface RtStopObservation {
  seq?: number
  stopId?: string
  /** Absolute predicted arrival / departure epoch seconds, if the feed gave them. Kept separate (Codex PR38 #1). */
  arr?: number
  dep?: number
}

export type MatchResult =
  | { kind: 'matched'; key: string; tier: 1 | 2 | 3 | 4; serviceDate: string; tripId: string }
  | { kind: 'ambiguous'; tier: 2 | 3 | 4; candidates: number }
  | { kind: 'unmatched' }

interface IndexedTrip {
  id: string
  serviceDate: string
  routeKey: string
  routeId: string
  dir: number
  startS: number
  /** seq -> {stopId, depEpoch} */
  stops: Map<number, { stopId: string; depEpoch: number; arrEpoch: number }>
  stopIds: Set<string>
  endEpoch: number
}

/** route_id without TransLink's version suffix: "F11-4055" -> "F11". */
export const routeKey = (routeId: string): string => routeId.split('-')[0] ?? routeId
/** trip_id stable prefix: "39390611-ATS_KBL 26-44445" -> "39390611". */
export const tripPrefix = (tripId: string): string => tripId.split('-')[0] ?? tripId

const TIER4_WINDOW_S = 5 * 60
const DAY_S = 24 * 3600

export class TripMatcher {
  private readonly byTripDate = new Map<string, IndexedTrip>()
  private readonly byTripId = new Map<string, IndexedTrip[]>()
  private readonly byStart = new Map<string, IndexedTrip[]>()
  private readonly byPrefix = new Map<string, IndexedTrip[]>()
  private readonly byRouteDir = new Map<string, IndexedTrip[]>()
  readonly serviceDates: string[]

  constructor(
    readonly mode: Mode,
    days: TripIndexDay[],
  ) {
    this.serviceDates = days.map((d) => d.serviceDate)
    for (const day of days) {
      for (const t of day.trips) {
        const route = day.routes[t.r]
        const stops = new Map<number, { stopId: string; depEpoch: number; arrEpoch: number }>()
        const stopIds = new Set<string>()
        let startS = Number.POSITIVE_INFINITY
        let endEpoch = 0
        for (let i = 0; i + 5 < t.st.length; i += 6) {
          const stopId = day.stops[t.st[i] as number] as string
          const seq = t.st[i + 1] as number
          const arrS = t.st[i + 2] as number
          const depS = t.st[i + 3] as number
          startS = Math.min(startS, depS)
          const arrEpoch = gtfsToEpoch(day.serviceDate, arrS)
          const depEpoch = gtfsToEpoch(day.serviceDate, depS)
          endEpoch = Math.max(endEpoch, arrEpoch)
          stops.set(seq, { stopId, depEpoch, arrEpoch })
          stopIds.add(stopId)
        }
        const it: IndexedTrip = {
          id: t.id,
          serviceDate: day.serviceDate,
          routeId: route?.id ?? '',
          routeKey: routeKey(route?.id ?? ''),
          dir: t.d,
          startS,
          stops,
          stopIds,
          endEpoch,
        }
        this.byTripDate.set(tripInstanceKey(t.id, day.serviceDate), it)
        push(this.byTripId, t.id, it)
        push(this.byStart, `${it.routeKey}|${it.dir}|${startS}|${day.serviceDate}`, it)
        push(this.byPrefix, `${tripPrefix(t.id)}|${it.routeKey}`, it)
        push(this.byRouteDir, `${it.routeKey}|${it.dir}`, it)
      }
    }
  }

  get size(): number {
    return this.byTripDate.size
  }

  trip(key: string): IndexedTrip | undefined {
    return this.byTripDate.get(key)
  }

  match(desc: RtDescriptor, obs: RtStopObservation[]): MatchResult {
    // Tier 1
    if (desc.tripId) {
      if (desc.startDate) {
        const t = this.byTripDate.get(tripInstanceKey(desc.tripId, desc.startDate))
        if (t) return matched(t, 1)
        // TransLink sends an after-midnight trip's start_date as the calendar date (start_time 00:18) while GTFS
        // files it under the previous service date (24:18). Accept that instance only when the start times agree.
        const prev = this.byTripDate.get(tripInstanceKey(desc.tripId, addDays(desc.startDate, -1)))
        const rtStart = gtfsTimeToSeconds(desc.startTime)
        if (prev && rtStart != null && rtStart < DAY_S && prev.startS === rtStart + DAY_S)
          return matched(prev, 1)
      } else {
        const list = this.byTripId.get(desc.tripId) ?? []
        const compatible = list.filter((t) => compatiblePattern(t, obs))
        if (compatible.length === 1) return matched(compatible[0] as IndexedTrip, 1)
      }
    }
    const rKey = desc.routeId ? routeKey(desc.routeId) : undefined
    // Tier 2
    const startS = gtfsTimeToSeconds(desc.startTime)
    if (rKey && desc.directionId != null && startS != null && desc.startDate) {
      const keys = [`${rKey}|${desc.directionId}|${startS}|${desc.startDate}`]
      // Same calendar-date convention as tier 1: 00:18 on D may be 24:18 on D-1.
      if (startS < DAY_S)
        keys.push(`${rKey}|${desc.directionId}|${startS + DAY_S}|${addDays(desc.startDate, -1)}`)
      const list = keys.flatMap((k) => this.byStart.get(k) ?? []).filter((t) => compatiblePattern(t, obs))
      if (list.length === 1) return matched(list[0] as IndexedTrip, 2)
      if (list.length > 1) return { kind: 'ambiguous', tier: 2, candidates: list.length }
    }
    // Tier 3 (rail)
    if (this.mode === 'train' && desc.tripId && rKey) {
      const list = (this.byPrefix.get(`${tripPrefix(desc.tripId)}|${rKey}`) ?? []).filter(
        (t) => (!desc.startDate || t.serviceDate === desc.startDate) && compatiblePattern(t, obs),
      )
      if (list.length === 1) return matched(list[0] as IndexedTrip, 3)
      if (list.length > 1) return { kind: 'ambiguous', tier: 3, candidates: list.length }
    }
    // Tier 4
    if (rKey) {
      const timed = obs.filter((o) => o.seq != null && (o.arr != null || o.dep != null))
      if (timed.length > 0) {
        const keys =
          desc.directionId != null
            ? [`${rKey}|${desc.directionId}`]
            : [`${rKey}|0`, `${rKey}|1`, `${rKey}|-1`]
        const cands: IndexedTrip[] = []
        for (const k of keys) {
          for (const t of this.byRouteDir.get(k) ?? []) {
            if (desc.startDate && t.serviceDate !== desc.startDate) continue
            if (!compatiblePattern(t, obs)) continue
            const ok = timed.some((o) => {
              const st = t.stops.get(o.seq as number)
              if (!st || (o.stopId && st.stopId !== o.stopId)) return false
              // Compare like with like: a predicted arrival against the scheduled arrival, a departure against the
              // scheduled departure. Either within the window qualifies; uniqueness is checked across candidates.
              if (o.dep != null && Math.abs(o.dep - st.depEpoch) <= TIER4_WINDOW_S) return true
              return o.arr != null && Math.abs(o.arr - st.arrEpoch) <= TIER4_WINDOW_S
            })
            if (ok) cands.push(t)
          }
        }
        if (cands.length === 1) return matched(cands[0] as IndexedTrip, 4)
        if (cands.length > 1) return { kind: 'ambiguous', tier: 4, candidates: cands.length }
      }
    }
    return { kind: 'unmatched' }
  }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k)
  if (l) l.push(v)
  else m.set(k, [v])
}

function matched(t: IndexedTrip, tier: 1 | 2 | 3 | 4): MatchResult {
  return {
    kind: 'matched',
    key: tripInstanceKey(t.id, t.serviceDate),
    tier,
    serviceDate: t.serviceDate,
    tripId: t.id,
  }
}

/** Every observed (seq, stopId) must exist in the static trip; stopId-only observations must be on the trip. */
export function compatiblePattern(t: IndexedTrip, obs: RtStopObservation[]): boolean {
  for (const o of obs) {
    if (o.seq != null) {
      const st = t.stops.get(o.seq)
      if (!st) return false
      if (o.stopId && st.stopId !== o.stopId) return false
    } else if (o.stopId && !t.stopIds.has(o.stopId)) {
      return false
    }
  }
  return true
}
