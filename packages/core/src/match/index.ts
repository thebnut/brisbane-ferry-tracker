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
 *
 * Storage is compact so two days of bus (≈22k trips, ≈1M stop times) fit a 128 MB Durable Object: each day keeps
 * its stop times in flat typed arrays, the indexes map keys to integer trip numbers (no per-trip objects, no
 * composite string keys), and an IndexedTrip is materialised lazily only for trips that are asked for.
 */
import { type Mode, type TripIndexDay, tripInstanceKey } from '../contract/index.ts'
import { addDays, gtfsTimeToSeconds, serviceDayStartEpoch } from '../time/index.ts'

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

/** A trip instance in object form, materialised on demand from the compact tables. */
export interface IndexedTrip {
  id: string
  serviceDate: string
  routeKey: string
  routeId: string
  dir: number
  startS: number
  /** seq -> {stopId, depEpoch, arrEpoch}, in stop_sequence order */
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
/**
 * (routeKey, dir, startS) packs into one safe integer: startS from any parseable GTFS time (HHH:MM:SS) is below
 * 2^32, and (rk * 3 + dir + 1) stays below 2^21, so the product stays below 2^53 with no collisions.
 */
const START_SPAN = 2 ** 32
const MATERIALISED_CACHE = 512

type Ints = Uint16Array | Int32Array
const ints = (n: number, max: number): Ints => (max < 65536 ? new Uint16Array(n) : new Int32Array(n))

/** One service day in columnar form. Trip numbers are global: `base + local index`. */
interface CompactDay {
  serviceDate: string
  dayStart: number
  base: number
  n: number
  tripIds: string[]
  /** trip_id -> local index */
  byId: Map<string, number>
  routeIds: string[]
  headsigns: string[]
  stopIdList: string[]
  route: Ints
  rk: Int32Array
  dir: Int8Array
  head: Ints
  startS: Int32Array
  endS: Int32Array
  /** stop-time offsets: trip i owns [off[i], off[i+1]) */
  off: Int32Array
  stopIdx: Ints
  seq: Ints
  arrS: Int32Array
  depS: Int32Array
}

export class TripMatcher {
  private readonly days: CompactDay[] = []
  private readonly routeKeys = new Map<string, number>()
  /** (routeKey, dir, startS) -> trip numbers, per service date */
  private readonly byStart = new Map<string, Map<number, number | number[]>>()
  /** (routeKey, dir) -> trip numbers */
  private readonly byRouteDir = new Map<number, number[]>()
  /** rail only: (tripPrefix|routeKey) -> trip numbers */
  private readonly byPrefix = new Map<string, number[]>()
  private readonly cache = new Map<number, IndexedTrip>()
  private count = 0
  readonly serviceDates: string[] = []

  constructor(
    readonly mode: Mode,
    days: TripIndexDay[],
  ) {
    for (const day of days) this.addDay(day)
  }

  /**
   * Index one more service day: copies it into typed arrays, so the caller can drop the parsed JSON. Lets the RT
   * hub spread a reload across alarm cycles (one day per cycle) to stay inside the CPU budget.
   */
  addDay(day: TripIndexDay): void {
    this.serviceDates.push(day.serviceDate)
    const n = day.trips.length
    let total = 0
    let maxSeq = 0
    for (const t of day.trips) {
      total += t.st.length / 6
      for (let i = 1; i < t.st.length; i += 6) if ((t.st[i] as number) > maxSeq) maxSeq = t.st[i] as number
    }
    const headsigns: string[] = []
    const headIdx = new Map<string, number>()
    const d: CompactDay = {
      serviceDate: day.serviceDate,
      dayStart: serviceDayStartEpoch(day.serviceDate),
      base: this.count,
      n,
      tripIds: new Array<string>(n),
      byId: new Map(),
      routeIds: day.routes.map((r) => r.id),
      headsigns,
      stopIdList: day.stops,
      route: ints(n, day.routes.length),
      rk: new Int32Array(n),
      dir: new Int8Array(n),
      head: new Int32Array(n),
      startS: new Int32Array(n),
      endS: new Int32Array(n),
      off: new Int32Array(n + 1),
      stopIdx: ints(total, day.stops.length),
      seq: ints(total, maxSeq + 1),
      arrS: new Int32Array(total),
      depS: new Int32Array(total),
    }
    // Extend rather than replace: a second addDay for the same date keeps the earlier entries (as before).
    let starts = this.byStart.get(day.serviceDate)
    if (!starts) {
      starts = new Map()
      this.byStart.set(day.serviceDate, starts)
    }
    let k = 0
    for (let i = 0; i < n; i++) {
      const t = day.trips[i] as TripIndexDay['trips'][number]
      const g = this.count + i
      d.tripIds[i] = t.id
      d.byId.set(t.id, i)
      d.route[i] = t.r
      const rk = this.routeKeyIndex(routeKey(d.routeIds[t.r] ?? ''))
      d.rk[i] = rk
      d.dir[i] = t.d
      let h = headIdx.get(t.h)
      if (h == null) {
        h = headsigns.push(t.h) - 1
        headIdx.set(t.h, h)
      }
      d.head[i] = h
      d.off[i] = k
      let startS = Number.POSITIVE_INFINITY
      let endS = 0
      for (let j = 0; j + 5 < t.st.length; j += 6, k++) {
        d.stopIdx[k] = t.st[j] as number
        d.seq[k] = t.st[j + 1] as number
        const arr = t.st[j + 2] as number
        const dep = t.st[j + 3] as number
        d.arrS[k] = arr
        d.depS[k] = dep
        if (dep < startS) startS = dep
        if (arr > endS) endS = arr
      }
      d.startS[i] = Number.isFinite(startS) ? startS : 0
      d.endS[i] = endS
      // A trip with no stop times is never a tier-2 candidate (its start was Infinity in the object matcher).
      if (Number.isFinite(startS)) addTo(starts, startKey(rk, t.d, startS), g)
      pushTo(this.byRouteDir, rk * 3 + t.d + 1, g)
      if (this.mode === 'train') pushTo(this.byPrefix, `${tripPrefix(t.id)}|${rk}`, g)
    }
    d.off[n] = k
    this.days.push(d)
    this.count += n
  }

  get size(): number {
    return this.count
  }

  trip(key: string): IndexedTrip | undefined {
    const g = this.lookup(key)
    return g == null ? undefined : this.materialise(g)
  }

  /** Is this trip instance in the index? (Cheaper than trip(): nothing is materialised.) */
  has(key: string): boolean {
    return this.lookup(key) != null
  }

  /** Route, headsign and direction of a trip instance, without materialising its stop times. */
  info(key: string): { routeId: string; headsign: string; dir: number } | undefined {
    const g = this.lookup(key)
    if (g == null) return undefined
    const [d, i] = this.locate(g)
    return {
      routeId: d.routeIds[d.route[i] as number] ?? '',
      headsign: d.headsigns[d.head[i] as number] ?? '',
      dir: d.dir[i] as number,
    }
  }

  match(desc: RtDescriptor, obs: RtStopObservation[]): MatchResult {
    // Tier 1
    if (desc.tripId) {
      if (desc.startDate) {
        const g = this.lookupId(desc.tripId, desc.startDate)
        if (g != null) return this.matched(g, 1)
        // TransLink sends an after-midnight trip's start_date as the calendar date (start_time 00:18) while GTFS
        // files it under the previous service date (24:18). Accept that instance only when the start times agree.
        const prev = this.lookupId(desc.tripId, addDays(desc.startDate, -1))
        const rtStart = gtfsTimeToSeconds(desc.startTime)
        if (prev != null && rtStart != null && rtStart < DAY_S) {
          const [d, i] = this.locate(prev)
          if (startOf(d, i) === rtStart + DAY_S) return this.matched(prev, 1)
        }
      } else {
        const compatible: number[] = []
        for (const d of this.days) {
          const i = d.byId.get(desc.tripId)
          if (i != null && this.compatible(d.base + i, obs)) compatible.push(d.base + i)
        }
        if (compatible.length === 1) return this.matched(compatible[0] as number, 1)
      }
    }
    const rKey = desc.routeId ? routeKey(desc.routeId) : undefined
    const rk = rKey != null ? this.routeKeys.get(rKey) : undefined
    // Tier 2
    const startS = gtfsTimeToSeconds(desc.startTime)
    // Direction ids outside -1..1 index nothing (as with the old string keys); never let them alias another route.
    const dirOk =
      desc.directionId == null || desc.directionId === 0 || desc.directionId === 1 || desc.directionId === -1
    if (rk != null && dirOk && desc.directionId != null && startS != null && desc.startDate) {
      const list: number[] = []
      collect(this.byStart.get(desc.startDate)?.get(startKey(rk, desc.directionId, startS)), list)
      // Same calendar-date convention as tier 1: 00:18 on D may be 24:18 on D-1.
      if (startS < DAY_S) {
        const prevDate = addDays(desc.startDate, -1)
        collect(this.byStart.get(prevDate)?.get(startKey(rk, desc.directionId, startS + DAY_S)), list)
      }
      const ok = list.filter((g) => this.compatible(g, obs))
      if (ok.length === 1) return this.matched(ok[0] as number, 2)
      if (ok.length > 1) return { kind: 'ambiguous', tier: 2, candidates: ok.length }
    }
    // Tier 3 (rail)
    if (this.mode === 'train' && desc.tripId && rk != null) {
      const list = (this.byPrefix.get(`${tripPrefix(desc.tripId)}|${rk}`) ?? []).filter(
        (g) =>
          (!desc.startDate || this.locate(g)[0].serviceDate === desc.startDate) && this.compatible(g, obs),
      )
      if (list.length === 1) return this.matched(list[0] as number, 3)
      if (list.length > 1) return { kind: 'ambiguous', tier: 3, candidates: list.length }
    }
    // Tier 4
    if (rk != null && dirOk) {
      const timed = obs.filter((o) => o.seq != null && (o.arr != null || o.dep != null))
      if (timed.length > 0) {
        const dirs = desc.directionId != null ? [desc.directionId] : [0, 1, -1]
        const cands: number[] = []
        for (const dir of dirs) {
          for (const g of this.byRouteDir.get(rk * 3 + dir + 1) ?? []) {
            const [d, i] = this.locate(g)
            if (desc.startDate && d.serviceDate !== desc.startDate) continue
            if (!this.compatible(g, obs)) continue
            const ok = timed.some((o) => {
              const k = findSeq(d, i, o.seq as number)
              if (k < 0 || (o.stopId && d.stopIdList[d.stopIdx[k] as number] !== o.stopId)) return false
              // Compare like with like: a predicted arrival against the scheduled arrival, a departure against the
              // scheduled departure. Either within the window qualifies; uniqueness is checked across candidates.
              if (o.dep != null && Math.abs(o.dep - (d.dayStart + (d.depS[k] as number))) <= TIER4_WINDOW_S)
                return true
              return o.arr != null && Math.abs(o.arr - (d.dayStart + (d.arrS[k] as number))) <= TIER4_WINDOW_S
            })
            if (ok) cands.push(g)
          }
        }
        if (cands.length === 1) return this.matched(cands[0] as number, 4)
        if (cands.length > 1) return { kind: 'ambiguous', tier: 4, candidates: cands.length }
      }
    }
    return { kind: 'unmatched' }
  }

  // ------------------------------------------------------------------ internals

  private routeKeyIndex(k: string): number {
    let i = this.routeKeys.get(k)
    if (i == null) {
      i = this.routeKeys.size
      this.routeKeys.set(k, i)
    }
    return i
  }

  private lookupId(tripId: string, serviceDate: string): number | undefined {
    for (const d of this.days) {
      if (d.serviceDate !== serviceDate) continue
      const i = d.byId.get(tripId)
      if (i != null) return d.base + i
    }
    return undefined
  }

  private lookup(key: string): number | undefined {
    const at = key.lastIndexOf('@')
    if (at < 0) return undefined
    return this.lookupId(key.slice(0, at), key.slice(at + 1))
  }

  private locate(g: number): [CompactDay, number] {
    for (const d of this.days) if (g >= d.base && g < d.base + d.n) return [d, g - d.base]
    throw new RangeError(`trip ${g} not indexed`)
  }

  private matched(g: number, tier: 1 | 2 | 3 | 4): MatchResult {
    const [d, i] = this.locate(g)
    const tripId = d.tripIds[i] as string
    return {
      kind: 'matched',
      key: tripInstanceKey(tripId, d.serviceDate),
      tier,
      serviceDate: d.serviceDate,
      tripId,
    }
  }

  /** Every observed (seq, stopId) must exist in the static trip; stopId-only observations must be on the trip. */
  private compatible(g: number, obs: RtStopObservation[]): boolean {
    if (obs.length === 0) return true
    const [d, i] = this.locate(g)
    for (const o of obs) {
      if (o.seq != null) {
        const k = findSeq(d, i, o.seq)
        if (k < 0) return false
        if (o.stopId && d.stopIdList[d.stopIdx[k] as number] !== o.stopId) return false
      } else if (o.stopId && !tripHasStop(d, i, o.stopId)) {
        return false
      }
    }
    return true
  }

  private materialise(g: number): IndexedTrip {
    const hit = this.cache.get(g)
    if (hit) return hit
    const [d, i] = this.locate(g)
    const stops = new Map<number, { stopId: string; depEpoch: number; arrEpoch: number }>()
    const stopIds = new Set<string>()
    for (let k = d.off[i] as number; k < (d.off[i + 1] as number); k++) {
      const stopId = d.stopIdList[d.stopIdx[k] as number] as string
      stops.set(d.seq[k] as number, {
        stopId,
        depEpoch: d.dayStart + (d.depS[k] as number),
        arrEpoch: d.dayStart + (d.arrS[k] as number),
      })
      stopIds.add(stopId)
    }
    const routeId = d.routeIds[d.route[i] as number] ?? ''
    const t: IndexedTrip = {
      id: d.tripIds[i] as string,
      serviceDate: d.serviceDate,
      routeId,
      routeKey: routeKey(routeId),
      dir: d.dir[i] as number,
      startS: startOf(d, i),
      stops,
      stopIds,
      // Empty trips keep the object matcher's sentinels: start Infinity, end 0.
      endEpoch: isEmpty(d, i) ? 0 : d.dayStart + (d.endS[i] as number),
    }
    if (this.cache.size >= MATERIALISED_CACHE) this.cache.delete(this.cache.keys().next().value as number)
    this.cache.set(g, t)
    return t
  }
}

const startKey = (rk: number, dir: number, startS: number): number => (rk * 3 + dir + 1) * START_SPAN + startS
const isEmpty = (d: CompactDay, i: number): boolean => d.off[i] === d.off[i + 1]
const startOf = (d: CompactDay, i: number): number =>
  isEmpty(d, i) ? Number.POSITIVE_INFINITY : (d.startS[i] as number)

function findSeq(d: CompactDay, i: number, seq: number): number {
  for (let k = d.off[i] as number; k < (d.off[i + 1] as number); k++) if (d.seq[k] === seq) return k
  return -1
}

function tripHasStop(d: CompactDay, i: number, stopId: string): boolean {
  for (let k = d.off[i] as number; k < (d.off[i + 1] as number); k++)
    if (d.stopIdList[d.stopIdx[k] as number] === stopId) return true
  return false
}

function addTo(m: Map<number, number | number[]>, k: number, g: number): void {
  const v = m.get(k)
  if (v == null) m.set(k, g)
  else if (typeof v === 'number') m.set(k, [v, g])
  else v.push(g)
}

function pushTo<K>(m: Map<K, number[]>, k: K, g: number): void {
  const l = m.get(k)
  if (l) l.push(g)
  else m.set(k, [g])
}

function collect(v: number | number[] | undefined, out: number[]): void {
  if (v == null) return
  if (typeof v === 'number') out.push(v)
  else out.push(...v)
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
