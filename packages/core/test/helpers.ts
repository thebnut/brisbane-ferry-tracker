/** Build tiny synthetic static files for adversarial tests. */
import type { RouteRef, StaticStopDay, StopEventTuple, TripIndexDay } from '../src/contract/index.ts'
import { gtfsTimeToSeconds } from '../src/time/index.ts'

export interface SynthTrip {
  id: string
  route: string
  dir?: 0 | 1
  headsign?: string
  /** [stopId, "HH:MM:SS"] or [stopId, arr, dep], sequence = index + 1 unless seqs given */
  stops: Array<[string, string] | [string, string, string]>
  seqs?: number[]
  pickup?: Record<number, 0 | 1>
  dropOff?: Record<number, 0 | 1>
}

const routeRef = (id: string): RouteRef => ({ id, short: id.split('-')[0] as string })

export function tripIndex(serviceDate: string, trips: SynthTrip[], generation = 'g1'): TripIndexDay {
  const routes: RouteRef[] = []
  const stops: string[] = []
  const ri = (id: string) => {
    let i = routes.findIndex((r) => r.id === id)
    if (i < 0) i = routes.push(routeRef(id)) - 1
    return i
  }
  const si = (id: string) => {
    let i = stops.indexOf(id)
    if (i < 0) i = stops.push(id) - 1
    return i
  }
  return {
    schemaVersion: 1,
    mode: 'ferry',
    serviceDate,
    generation,
    routes: trips
      .map((t) => t.route)
      .filter((v, i, a) => a.indexOf(v) === i)
      .map(routeRef),
    stops,
    trips: trips.map((t) => {
      ri(t.route)
      const st: number[] = []
      t.stops.forEach((s, i) => {
        const arr = gtfsTimeToSeconds(s[1]) as number
        const dep = gtfsTimeToSeconds(s[2] ?? s[1]) as number
        st.push(si(s[0]), t.seqs?.[i] ?? i + 1, arr, dep, t.pickup?.[i] ?? 0, t.dropOff?.[i] ?? 0)
      })
      return {
        id: t.id,
        r: routes.findIndex((r) => r.id === t.route),
        d: t.dir ?? 0,
        h: t.headsign ?? '',
        st,
      }
    }),
  }
}

/** The stop-day file for `stopId` built the same way the pipeline does. */
export function stopDay(serviceDate: string, stopId: string, trips: SynthTrip[]): StaticStopDay {
  const day: StaticStopDay = {
    schemaVersion: 1,
    mode: 'ferry',
    stopKey: stopId,
    serviceDate,
    trips: [],
    routes: [],
    headsigns: [],
    stops: [],
    downstreams: [],
    events: [],
  }
  const idx = <T>(arr: T[], v: T, eq: (a: T) => boolean) => {
    let i = arr.findIndex(eq)
    if (i < 0) i = arr.push(v) - 1
    return i
  }
  for (const t of trips) {
    t.stops.forEach((s, i) => {
      if (s[0] !== stopId) return
      if ((t.pickup?.[i] ?? 0) === 1) return
      const seq = t.seqs?.[i] ?? i + 1
      const arr = gtfsTimeToSeconds(s[1]) as number
      const dep = gtfsTimeToSeconds(s[2] ?? s[1]) as number
      const ds: number[] = []
      for (let j = i + 1; j < t.stops.length; j++) {
        if ((t.dropOff?.[j] ?? 0) === 1) continue
        const d = t.stops[j] as [string, string]
        const darr = gtfsTimeToSeconds(d[1]) as number
        ds.push(
          idx(day.stops, { id: d[0] }, (x) => x.id === d[0]),
          darr - dep,
          0,
          (t.seqs?.[j] ?? j + 1) - seq,
        )
      }
      const ev: StopEventTuple = [
        idx(day.trips, t.id, (x) => x === t.id),
        seq,
        arr,
        dep,
        idx(day.routes, routeRef(t.route), (x) => x.id === t.route),
        idx(day.headsigns, t.headsign ?? '', (x) => x === (t.headsign ?? '')),
        idx(day.stops, { id: stopId, name: stopId }, (x) => x.id === stopId),
        0,
        t.dir ?? 0,
        idx(day.downstreams, ds, (x) => x.join() === ds.join()),
      ]
      day.events.push(ev)
    })
  }
  day.events.sort((a, b) => a[3] - b[3] || a[0] - b[0])
  return day
}
