/**
 * Build one StaticStopDay per stop key per service day, and one TripIndexDay per mode per service day, in the exact
 * tuple layout of the core contract (transit-architecture.md §3.2).
 */
import type { Mode, RouteRef, StaticStopDay, StopEventTuple, StopRef, TripIndexDay } from '@bft/core'
import { SCHEMA_VERSION } from '@bft/core'
import type { Feed, RouteRow, StopRow, TripRow } from '../feed/load.ts'
import type { StopKeys } from './keys.ts'

/** Trips of one mode active on one service date, by index into feed.trips, sorted by trip_id. */
export function activeTrips(feed: Feed, mode: Mode, activeServices: Set<string>): number[] {
  const out: number[] = []
  feed.trips.forEach((t, i) => {
    if (t.count > 0 && activeServices.has(t.serviceId) && feed.routes.get(t.routeId)?.mode === mode) out.push(i)
  })
  return out.sort((a, b) => cmp((feed.trips[a] as TripRow).id, (feed.trips[b] as TripRow).id))
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

const HEX6 = /^[0-9A-Fa-f]{6}$/

export function routeRef(r: RouteRow): RouteRef {
  const ref: RouteRef = { id: r.id, short: r.short }
  if (r.long) ref.long = r.long
  if (HEX6.test(r.color)) ref.color = r.color.toUpperCase()
  if (HEX6.test(r.textColor)) ref.textColor = r.textColor.toUpperCase()
  return ref
}

export function headsignOf(feed: Feed, t: TripRow): string {
  if (t.headsign) return t.headsign
  const last = feed.stopTimes.stop[t.start + t.count - 1] as number
  return (feed.stops[last] as StopRow).name
}

/** Ordered interning table: index by first insertion. */
class Interner<T> {
  readonly items: T[] = []
  private readonly idx = new Map<string, number>()
  get(id: string, make: () => T): number {
    let i = this.idx.get(id)
    if (i === undefined) {
      i = this.items.push(make()) - 1
      this.idx.set(id, i)
    }
    return i
  }
}

export interface ModeDay {
  mode: Mode
  serviceDate: string
  trips: number[]
  /** stopKey → flat [tripIdx, row, tripIdx, row, …] boarding events (pickup_type != 1). */
  buckets: Map<string, number[]>
  /** Stop keys in sorted order. */
  keys: string[]
  events: number
}

/** Collect boarding events per stop key for one mode and service day. */
export function collectModeDay(
  feed: Feed,
  keys: StopKeys,
  mode: Mode,
  serviceDate: string,
  activeServices: Set<string>,
): ModeDay {
  const trips = activeTrips(feed, mode, activeServices)
  const st = feed.stopTimes
  const buckets = new Map<string, number[]>()
  let events = 0
  for (const ti of trips) {
    const t = feed.trips[ti] as TripRow
    // The last stop of a trip is never a boarding (nothing downstream), whatever its pickup_type says.
    for (let r = t.start; r < t.start + t.count - 1; r++) {
      if (st.pickup[r] === 1) continue
      const key = keys.keyOf(mode, st.stop[r] as number)
      let b = buckets.get(key)
      if (!b) {
        b = []
        buckets.set(key, b)
      }
      b.push(ti, r)
      events++
    }
  }
  return { mode, serviceDate, trips, buckets, keys: [...buckets.keys()].sort(cmp), events }
}

/** Assemble the StaticStopDay for one stop key from its bucket. */
export function stopDayFile(feed: Feed, keys: StopKeys, day: ModeDay, stopKey: string): StaticStopDay {
  const st = feed.stopTimes
  const bucket = day.buckets.get(stopKey) ?? []
  const evs: Array<[number, number]> = []
  for (let i = 0; i < bucket.length; i += 2) evs.push([bucket[i] as number, bucket[i + 1] as number])
  evs.sort(
    ([ta, ra], [tb, rb]) =>
      (st.dep[ra] as number) - (st.dep[rb] as number) ||
      cmp((feed.trips[ta] as TripRow).id, (feed.trips[tb] as TripRow).id) ||
      (st.seq[ra] as number) - (st.seq[rb] as number),
  )

  const trips = new Interner<string>()
  const routes = new Interner<RouteRef>()
  const headsigns = new Interner<string>()
  const stops = new Interner<StopRef>()
  const downstreams = new Interner<number[]>()
  // Only boarding stops carry a name; downstream-only stops are named by data/{mode}/stops.json.
  const boarding = new Set(evs.map(([, r]) => st.stop[r] as number))
  const stopRef = (si: number): number => {
    const s = feed.stops[si] as StopRow
    return stops.get(s.id, () => {
      const ref: StopRef = { id: s.id }
      if (boarding.has(si)) ref.name = s.name
      if (s.platformCode) ref.platform = s.platformCode
      const k = keys.keyOf(day.mode, si)
      if (k !== s.id) ref.key = k
      return ref
    })
  }

  const events: StopEventTuple[] = []
  for (const [ti, r] of evs) {
    const t = feed.trips[ti] as TripRow
    const route = feed.routes.get(t.routeId) as RouteRow
    const tripIdx = trips.get(t.id, () => t.id)
    const routeIdx = routes.get(route.id, () => routeRef(route))
    const hs = headsignOf(feed, t)
    const headsignIdx = headsigns.get(hs, () => hs)
    const platformIdx = stopRef(st.stop[r] as number)
    const dep = st.dep[r] as number
    const seq = st.seq[r] as number
    const downstream: number[] = []
    for (let j = r + 1; j < t.start + t.count; j++) {
      const drop = st.dropOff[j] as number
      if (drop === 1) continue
      downstream.push(stopRef(st.stop[j] as number), (st.arr[j] as number) - dep, drop, (st.seq[j] as number) - seq)
    }
    events.push([
      tripIdx,
      seq,
      st.arr[r] as number,
      dep,
      routeIdx,
      headsignIdx,
      platformIdx,
      st.pickup[r] as 0 | 2 | 3,
      t.directionId,
      downstreams.get(downstream.join(','), () => downstream),
    ])
  }

  const table = orderDownstreams(downstreams.items, events)
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: day.mode,
    stopKey,
    serviceDate: day.serviceDate,
    trips: trips.items,
    routes: routes.items,
    headsigns: headsigns.items,
    stops: stops.items,
    downstreams: table,
    events,
  }
}

/** TripIndexDay: every active trip of the mode with its full stop list (including no-pickup rows). */
export function tripIndexFile(feed: Feed, day: ModeDay, generation: string): TripIndexDay {
  const st = feed.stopTimes
  const routes = new Interner<RouteRef>()
  const stops = new Interner<string>()
  const trips = day.trips.map((ti) => {
    const t = feed.trips[ti] as TripRow
    const route = feed.routes.get(t.routeId) as RouteRow
    const flat: number[] = []
    for (let r = t.start; r < t.start + t.count; r++) {
      const s = feed.stops[st.stop[r] as number] as StopRow
      flat.push(
        stops.get(s.id, () => s.id),
        st.seq[r] as number,
        st.arr[r] as number,
        st.dep[r] as number,
        st.pickup[r] as number,
        st.dropOff[r] as number,
      )
    }
    return {
      id: t.id,
      r: routes.get(route.id, () => routeRef(route)),
      d: t.directionId,
      h: headsignOf(feed, t),
      st: flat,
    }
  })
  return {
    schemaVersion: SCHEMA_VERSION,
    mode: day.mode,
    serviceDate: day.serviceDate,
    generation,
    routes: routes.items,
    stops: stops.items,
    trips,
  }
}

/**
 * Order the downstream table by stop pattern, then by content, and remap the events' indexes. Similar vectors end up
 * adjacent, which gzip compresses better (Cultural Centre platform 2: 32.3 KB → 29.9 KB). Deterministic.
 */
function orderDownstreams(table: number[][], events: StopEventTuple[]): number[][] {
  const pattern = (d: number[]) => d.filter((_, i) => i % 4 === 0)
  const lex = (x: number[], y: number[]) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number)
    return x.length - y.length
  }
  const order = table.map((_, i) => i)
  order.sort((a, b) => {
    const x = table[a] as number[]
    const y = table[b] as number[]
    return lex(pattern(x), pattern(y)) || lex(x, y)
  })
  const newIdx = new Array<number>(table.length)
  order.forEach((old, i) => {
    newIdx[old] = i
  })
  for (const ev of events) ev[9] = newIdx[ev[9]] as number
  return order.map((i) => table[i] as number[])
}
