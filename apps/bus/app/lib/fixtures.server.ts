/**
 * Fixture mode: /v1 responses built from a recorded weekday of real bus stop-day files (fixtures/bus-day.json from
 * scripts/build-data.ts: Cultural Centre platforms 1 and 2, King George Square 1a and 2a, Mater Hill platform 1,
 * Adelaide Street stop 37) merged by @bft/core with a deterministic synthetic RT snapshot, rebased onto today so
 * countdowns stay meaningful. Lets dev, Playwright and the staging preview run without the live API.
 *
 * /__fixtures/data/bus/* serves the full static client data when the app was built with it (`pnpm data`), else the
 * fixture's subset (the stops and lines the fixture touches).
 *
 * Query `rt=unavailable|stale|reloading` forces an rtState to exercise the banners.
 */
import {
  type Alert,
  AlertsResponse,
  addDays,
  currentServiceDate,
  type DepartureStatus,
  DeparturesResponse,
  gtfsToEpoch,
  mergeDepartures,
  parseTripInstanceKey,
  predictStop,
  type RtSnapshot,
  type RtState,
  type RtTrip,
  SCHEMA_VERSION,
  type StaticStopDay,
  type TripIndexDay,
  TripResponse,
  type TripStop,
  tripInstanceKey,
  type Vehicle,
  VehiclesResponse,
} from '@bft/core'
import type { Line, StopIndexEntry } from './data-contract.ts'
import { geohashEncode } from './geo.ts'
import { routeFileFor } from './route-file.ts'
import { routeShortOf } from './stops.ts'

export interface FixtureDay {
  serviceDate: string
  generation: string
  stopDays: Record<string, StaticStopDay>
  tripIndex: TripIndexDay
  stops: StopIndexEntry[]
  lines: Line[]
}

let cache: Promise<FixtureDay> | null = null
export const loadFixture = () => {
  cache ??= import('../../fixtures/bus-day.json').then((m) => m.default as unknown as FixtureDay)
  return cache
}

/** Small stable hash so the same trip always gets the same synthetic behaviour. */
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const OCCUPANCY = [
  'MANY_SEATS_AVAILABLE',
  'FEW_SEATS_AVAILABLE',
  'MANY_SEATS_AVAILABLE',
  'STANDING_ROOM_ONLY',
]

/** Delay in seconds for a synthetic live trip, or null when it is cancelled (1 in 12). */
function synthDelay(key: string): number | null {
  const h = hash(key)
  if (h % 12 === 5) return null
  const bucket = h % 10
  return bucket === 7 || bucket === 8 ? 120 + (h % 3) * 60 : bucket === 9 ? -60 : 0
}

type St = { stopId: string; seq: number; arr: number; dep: number }
function tripStops(index: TripIndexDay, t: TripIndexDay['trips'][number], serviceDate: string): St[] {
  const out: St[] = []
  for (let i = 0; i + 5 < t.st.length; i += 6) {
    out.push({
      stopId: index.stops[t.st[i] as number] as string,
      seq: t.st[i + 1] as number,
      arr: gtfsToEpoch(serviceDate, t.st[i + 2] as number),
      dep: gtfsToEpoch(serviceDate, t.st[i + 3] as number),
    })
  }
  return out
}

/**
 * Synthetic RT: trips departing the given stop-days within 45 min (or running now) are live, 1 in 10 late, 1 in 10
 * early, 1 in 12 cancelled. Vehicles (interpolated between stops) for the trip index's routes (M1, M2, 60).
 */
export function synthRt(
  day: FixtureDay,
  dates: string[],
  nowS: number,
  stopDays: StaticStopDay[],
): RtSnapshot {
  const trips: Record<string, RtTrip> = {}
  const vehicles: Vehicle[] = []
  const coords = new Map(day.stops.map((s) => [s.key, s]))
  const add = (key: string, seq: number, stopId: string, until: number) => {
    if (trips[key]) return
    const delay = synthDelay(key)
    const h = hash(key)
    if (delay == null) {
      trips[key] = { key, rel: 'CANCELED', ts: nowS - 12, until, updates: [] }
      return
    }
    trips[key] = {
      key,
      rel: 'SCHEDULED',
      tier: 1,
      ts: nowS - 12,
      vehicleId: `fx${h % 9973}`,
      updates: [{ seq, stopId, rel: 'SCHEDULED', arrDelay: delay, depDelay: delay }],
    }
  }
  for (const date of dates) {
    for (const t of day.tripIndex.trips) {
      const stops = tripStops(day.tripIndex, t, date)
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) continue
      if (nowS < first.dep - 45 * 60 || nowS > last.arr + 120) continue
      const key = tripInstanceKey(t.id, date)
      add(key, first.seq, first.stopId, last.arr)
      const rt = trips[key] as RtTrip
      if (rt.rel === 'CANCELED') continue
      const delay = rt.updates[0]?.depDelay ?? 0
      if (nowS < first.dep + delay) continue
      let prev = first
      let next = first
      for (const s of stops) {
        if (s.dep + delay <= nowS) prev = s
        if (s.arr + delay >= nowS) {
          next = s
          break
        }
        next = s
      }
      const a = coords.get(prev.stopId)
      const b = coords.get(next.stopId)
      if (!a || !b) continue
      const span = next.arr - prev.dep
      const f = span > 0 ? Math.min(1, Math.max(0, (nowS - delay - prev.dep) / span)) : 1
      const h = hash(key)
      vehicles.push({
        id: rt.vehicleId as string,
        label: String(1000 + (h % 900)),
        tripKey: key,
        routeId: day.tripIndex.routes[t.r]?.id,
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        speed: f > 0 && f < 1 ? 9 : 0,
        occupancy: OCCUPANCY[h % OCCUPANCY.length],
        status: f >= 1 || prev === next ? 'STOPPED_AT' : 'IN_TRANSIT_TO',
        stopId: next.stopId,
        ts: nowS - 15,
      })
    }
  }
  // Trips at the requested stops that the trip index doesn't cover (other routes): an update at that stop.
  for (const sd of stopDays) {
    for (const ev of sd.events) {
      const dep = gtfsToEpoch(sd.serviceDate, ev[3])
      if (dep < nowS - 15 * 60 || dep > nowS + 45 * 60) continue
      const key = tripInstanceKey(sd.trips[ev[0]] as string, sd.serviceDate)
      const ds = ev[9]
      const lastOffset = ds.length >= 4 ? (ds[ds.length - 3] as number) : 0
      add(key, ev[1], sd.stops[ev[6]]?.id ?? sd.stopKey, dep + lastOffset)
    }
  }
  return {
    header: {
      schemaVersion: SCHEMA_VERSION,
      seq: Math.floor(nowS / 15),
      staticGeneration: { bus: day.generation },
      serviceDates: dates,
      sourceTimestamp: nowS - 12,
      fetchedAt: nowS * 1000 - 9000,
    },
    trips,
    vehicles,
    alerts: [],
  }
}

/** Fixture alerts in the shape the hub publishes (route ids, stop ids), anchored to today. */
export function fixtureAlerts(nowS: number): Alert[] {
  const today = currentServiceDate(nowS * 1000)
  const at = (date: string, h: number) => gtfsToEpoch(date, h * 3600)
  const monday = (() => {
    let d = today
    for (let i = 0; i < 7; i++) {
      d = addDays(d, 1)
      if (new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T12:00:00Z`).getUTCDay() === 1) break
    }
    return d
  })()
  return [
    {
      id: 'fx-detour-60',
      header: 'Route 60 detour: Adelaide Street stop 37 closed',
      description:
        'CityGlider 60 stops at Adelaide Street stop 39 instead while kerb works run. Allow 5 extra minutes.',
      cause: 'CONSTRUCTION',
      effect: 'DETOUR',
      severity: 'WARNING',
      activePeriods: [{ start: nowS - 3600, end: at(today, 18) > nowS ? at(today, 18) : nowS + 4 * 3600 }],
      routes: ['60-5146'],
      stops: ['37'],
      modes: ['bus'],
    },
    {
      id: 'fx-moved-kgs',
      header: 'King George Square platform 2a moves to 2b',
      description: 'Temporary platform change while the platform 2a shelter is repaired.',
      cause: 'MAINTENANCE',
      effect: 'STOP_MOVED',
      severity: 'INFO',
      activePeriods: [{ start: at(monday, 4), end: at(addDays(monday, 5), 26) }],
      routes: ['M1-4949'],
      stops: ['10780'],
      modes: ['bus'],
    },
    {
      id: 'fx-planned-m2',
      header: 'Metro M2: reduced frequency after 9 pm this weekend',
      description: 'Metro M2 every 15 minutes after 9 pm on Saturday and Sunday.',
      cause: 'MAINTENANCE',
      effect: 'REDUCED_SERVICE',
      severity: 'INFO',
      activePeriods: [{ start: at(addDays(monday, 5), 21), end: at(addDays(monday, 6), 26) }],
      routes: ['M2-4949'],
      stops: [],
      modes: ['bus'],
    },
    {
      id: 'fx-info-glider',
      header: 'CityGlider: tap on at the rear doors',
      description: 'All doors open at busy city stops.',
      effect: 'OTHER_EFFECT',
      severity: 'INFO',
      activePeriods: [],
      routes: ['60-5146', '61-5146'],
      stops: [],
      modes: ['bus'],
    },
  ]
}

function forcedState(url: URL): RtState {
  const rt = url.searchParams.get('rt')
  return rt === 'unavailable' || rt === 'stale' || rt === 'reloading' ? rt : 'live'
}

function envelope(day: FixtureDay, dates: string[], rt: RtSnapshot, rtState: RtState, nowMs: number) {
  return {
    schemaVersion: SCHEMA_VERSION,
    staticGeneration: day.generation,
    serviceDates: dates,
    rtSourceTimestamp:
      rtState === 'unavailable'
        ? null
        : rtState === 'stale'
          ? Math.floor(nowMs / 1000) - 600
          : rt.header.sourceTimestamp,
    rtState,
    generatedAt: nowMs,
  }
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', 'x-bft-fixture': '1' } })

const stopName = (day: FixtureDay, id: string) =>
  day.stops.find((s) => s.key === id)?.name ??
  Object.values(day.stopDays)
    .flatMap((d) => d.stops)
    .find((s) => s.id === id)?.name

/** /__fixtures/data/bus/*: the built static data if present, else the fixture's subset. */
async function handleFixtureData(path: string, env: Env | null): Promise<Response> {
  if (env?.ASSETS) {
    const res = await env.ASSETS.fetch(new Request(`https://assets${path}`))
    if (res.ok) return res
  }
  const day = await loadFixture()
  const base = { schemaVersion: SCHEMA_VERSION, mode: 'bus' as const, generation: day.generation }
  if (path === '/data/bus/stops.json') return json({ ...base, stops: day.stops })
  if (path === '/data/bus/lines.json') return json({ ...base, lines: day.lines })
  const r = /^\/data\/bus\/routes\/([^/]+)\.json$/.exec(path)
  if (r) {
    const line = day.lines.find((l) => l.short === decodeURIComponent(r[1] as string))
    if (!line) return new Response('Not found', { status: 404 })
    return json(routeFileFor(line, new Map(day.stops.map((s) => [s.key, s])), day.generation))
  }
  const m = /^\/data\/bus\/geo\/([0-9b-hjkmnp-z]{5})\.json$/.exec(path)
  if (m) {
    const stops = day.stops
      .filter((s) => geohashEncode(s.lat, s.lon, 5) === m[1])
      .map(({ key, name, code, lat, lon }) =>
        code ? { key, name, code, lat, lon } : { key, name, lat, lon },
      )
    if (stops.length === 0) return new Response('Not found', { status: 404 })
    return json({ ...base, geohash: m[1], stops })
  }
  return new Response('Not found', { status: 404 })
}

/** Answer a /__fixtures/... request. `nowMs` is injectable for tests. */
export async function handleFixtureApi(url: URL, nowMs: number, env: Env | null = null): Promise<Response> {
  const path = url.pathname.replace(/^\/__fixtures/, '')
  if (path.startsWith('/data/')) return handleFixtureData(path, env)
  const day = await loadFixture()
  const nowS = Math.floor(nowMs / 1000)
  const today = currentServiceDate(nowMs)
  const dates = [addDays(today, -1), today, addDays(today, 1)]
  const rtState = forcedState(url)

  let m = /^\/v1\/bus\/stops\/([^/]+)\/departures$/.exec(path)
  if (m) {
    const key = decodeURIComponent(m[1] as string)
    const base = day.stopDays[key]
    if (!base) return json({ error: 'unknown stop', detail: key }, 404)
    const days = dates.map((d) => ({ ...base, serviceDate: d }))
    const rt = synthRt(day, dates, nowS, days)
    const env2 = envelope(day, dates, rt, rtState, nowMs)
    const departures = mergeDepartures(days, rtState === 'unavailable' ? null : rt, {
      nowS,
      limit: Math.min(Number(url.searchParams.get('limit')) || 20, 100),
      rtState,
    })
    const boarding = base.stops[base.events[0]?.[6] ?? -1]
    return json(
      DeparturesResponse.parse({
        ...env2,
        mode: 'bus',
        stop: { key, name: boarding?.name ?? stopName(day, key) ?? key, stopIds: [key] },
        to: null,
        departures,
      }),
    )
  }

  m = /^\/v1\/bus\/trips\/([^/]+)$/.exec(path)
  if (m) {
    const key = decodeURIComponent(m[1] as string)
    const { tripId, serviceDate } = parseTripInstanceKey(key)
    if (!dates.includes(serviceDate)) return json({ error: 'unknown trip', detail: key }, 404)
    const days = Object.values(day.stopDays).map((d) => ({ ...d, serviceDate }))
    const rt = synthRt(day, dates, nowS, days)
    const env2 = envelope(day, dates, rt, rtState, nowMs)
    const rtTrip = rtState === 'unavailable' ? undefined : rt.trips[key]
    let rows: Array<St & { name?: string }> = []
    let route = null
    let headsign = ''
    const t = day.tripIndex.trips.find((x) => x.id === tripId)
    if (t) {
      rows = tripStops(day.tripIndex, t, serviceDate).map((s) => ({ ...s, name: stopName(day, s.stopId) }))
      route = day.tripIndex.routes[t.r]
      headsign = t.h
    } else {
      // Routes outside the trip index: the stops from the earliest fixture stop it boards at onwards.
      let best: { d: StaticStopDay; ev: StaticStopDay['events'][number] } | null = null
      for (const d of days) {
        const ti = d.trips.indexOf(tripId)
        if (ti < 0) continue
        for (const ev of d.events) if (ev[0] === ti && (!best || ev[1] < best.ev[1])) best = { d, ev }
      }
      if (!best) return json({ error: 'unknown trip', detail: key }, 404)
      const { d, ev } = best
      const dep = gtfsToEpoch(serviceDate, ev[3])
      const board = d.stops[ev[6]]
      rows.push({
        stopId: board?.id ?? d.stopKey,
        name: board?.name,
        seq: ev[1],
        arr: gtfsToEpoch(serviceDate, ev[2]),
        dep,
      })
      for (let i = 0; i + 3 < ev[9].length; i += 4) {
        const s = d.stops[ev[9][i] as number]
        const arr = dep + (ev[9][i + 1] as number)
        rows.push({
          stopId: s?.id ?? '',
          name: s?.name,
          seq: ev[1] + (ev[9][i + 3] as number),
          arr,
          dep: arr,
        })
      }
      route = d.routes[ev[4]]
      headsign = d.headsigns[ev[5]] ?? ''
    }
    const stops: TripStop[] = rows.map((s, i) => {
      const p = predictStop(rtTrip, s.seq, s.arr, s.dep, rtState)
      return {
        stopId: s.stopId,
        name: s.name,
        stopSequence: s.seq,
        schedArr: i === 0 ? null : s.arr,
        schedDep: i === rows.length - 1 ? null : s.dep,
        estArr: i === 0 ? null : p.estArr,
        estDep: i === rows.length - 1 ? null : p.estDep,
        status: p.status,
        pickup: 0,
        dropOff: 0,
      }
    })
    const status = (stops[0]?.status ?? 'scheduled') as DepartureStatus
    const vehicle = rtState === 'live' ? (rt.vehicles.find((v) => v.tripKey === key) ?? null) : null
    return json(
      TripResponse.parse({
        ...env2,
        mode: 'bus',
        tripInstance: key,
        route,
        headsign,
        status,
        vehicle,
        stops,
      }),
    )
  }

  if (path === '/v1/bus/vehicles') {
    const rt = synthRt(day, dates, nowS, [])
    const route = url.searchParams.get('route')
    const vehicles =
      rtState === 'live'
        ? rt.vehicles.filter((v) => !route || v.routeId === route || routeShortOf(v.routeId ?? '') === route)
        : []
    return json(
      VehiclesResponse.parse({ ...envelope(day, dates, rt, rtState, nowMs), mode: 'bus', vehicles }),
    )
  }
  if (path === '/v1/alerts') {
    const rt = synthRt(day, dates, nowS, [])
    return json(
      AlertsResponse.parse({ ...envelope(day, dates, rt, rtState, nowMs), alerts: fixtureAlerts(nowS) }),
    )
  }
  return json({ error: 'not_found' }, 404)
}
