/**
 * Fixture mode: /v1 responses built from a recorded weekday of real ferry stop-day files
 * (fixtures/ferry-day.json, from scripts/build-fixtures.ts) merged by @bft/core with a deterministic synthetic RT
 * snapshot, rebased onto today so countdowns stay meaningful. Lets dev and Playwright run without the live API.
 *
 * Query `rt=unavailable|stale|reloading` forces an rtState to exercise the banners.
 */
import {
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
  tripInstanceKey,
  type Vehicle,
  VehiclesResponse,
} from '@bft/core'
import { terminalById } from './terminals.ts'

interface FixtureDay {
  serviceDate: string
  stopDays: Record<string, StaticStopDay>
  tripIndex: TripIndexDay
}

let cache: Promise<FixtureDay> | null = null
const load = () => {
  cache ??= import('../../fixtures/ferry-day.json').then((m) => m.default as unknown as FixtureDay)
  return cache
}

const VESSELS = [
  'MOOROOLBIN II',
  'Kuluwin',
  'Tunamun',
  'Mirbarpa',
  'Beenung-urrung',
  'Gootcha',
  'Binkinba',
  'Baneraba',
  'Kurilpa',
  'Mudlark',
  'Neville Bonner',
  'Yoogera',
]

/** Small stable hash so the same trip always gets the same synthetic behaviour. */
function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
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
 * Synthetic RT: trips running or starting within 45 min are live; 1 in 10 late, 1 in 10 early, 1 in 12 cancelled.
 * `only` limits the work to the trips a response can show (Workers Free allows 10 ms CPU per request).
 */
function synthRt(day: FixtureDay, dates: string[], nowS: number, only?: ReadonlySet<string>): RtSnapshot {
  const trips: Record<string, RtTrip> = {}
  const vehicles: Vehicle[] = []
  for (const date of dates) {
    for (const t of day.tripIndex.trips) {
      if (only && !only.has(t.id)) continue
      const stops = tripStops(day.tripIndex, t, date)
      const first = stops[0]
      const last = stops[stops.length - 1]
      if (!first || !last) continue
      if (nowS < first.dep - 45 * 60 || nowS > last.arr + 120) continue
      const key = tripInstanceKey(t.id, date)
      const h = hash(key)
      const vehicleId = `fx${h % 997}_${VESSELS[h % VESSELS.length]}`
      if (h % 12 === 5) {
        trips[key] = { key, rel: 'CANCELED', ts: nowS - 12, until: last.arr, updates: [] }
        continue
      }
      const bucket = h % 10
      const delay = bucket === 7 || bucket === 8 ? 120 + (h % 3) * 60 : bucket === 9 ? -60 : 0
      trips[key] = {
        key,
        rel: 'SCHEDULED',
        tier: 1,
        ts: nowS - 12,
        vehicleId,
        updates: [
          { seq: first.seq, stopId: first.stopId, rel: 'SCHEDULED', arrDelay: delay, depDelay: delay },
        ],
      }
      if (nowS < first.dep + delay) continue
      // Position: interpolate between the stops either side of "now".
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
      const a = terminalById(prev.stopId)
      const b = terminalById(next.stopId)
      if (!a || !b) continue
      const span = next.arr - prev.dep
      const f = span > 0 ? Math.min(1, Math.max(0, (nowS - delay - prev.dep) / span)) : 1
      vehicles.push({
        id: vehicleId,
        label: vehicleId.split('_')[1],
        tripKey: key,
        routeId: day.tripIndex.routes[t.r]?.id,
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lng + (b.lng - a.lng) * f,
        speed: f > 0 && f < 1 ? 6.5 : 0,
        occupancy: 'MANY_SEATS_AVAILABLE',
        status: f >= 1 || prev === next ? 'STOPPED_AT' : 'IN_TRANSIT_TO',
        stopId: next.stopId,
        ts: nowS - 15,
      })
    }
  }
  return {
    header: {
      schemaVersion: SCHEMA_VERSION,
      seq: Math.floor(nowS / 15),
      staticGeneration: { ferry: day.tripIndex.generation },
      serviceDates: dates,
      sourceTimestamp: nowS - 12,
      fetchedAt: nowS * 1000 - 9000,
    },
    trips,
    vehicles,
    alerts: [],
  }
}

function forcedState(url: URL): RtState {
  const rt = url.searchParams.get('rt')
  return rt === 'unavailable' || rt === 'stale' || rt === 'reloading' ? rt : 'live'
}

function envelope(day: FixtureDay, dates: string[], rt: RtSnapshot, rtState: RtState, nowMs: number) {
  return {
    schemaVersion: SCHEMA_VERSION,
    staticGeneration: day.tripIndex.generation,
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

/** Answer a /__fixtures/v1/... request. `nowMs` is injectable for tests. */
export async function handleFixtureApi(url: URL, nowMs: number): Promise<Response> {
  const day = await load()
  const path = url.pathname.replace(/^\/__fixtures/, '')
  const at = Number(url.searchParams.get('at')) || 0
  const nowS = Math.max(Math.floor(nowMs / 1000), at)
  const today = currentServiceDate(nowS * 1000)
  const dates = [addDays(today, -1), today, addDays(today, 1)]
  const rtState = forcedState(url)
  const realNowS = Math.floor(nowMs / 1000)
  const env = (rt: RtSnapshot) => envelope(day, dates, rt, rtState, nowMs)

  let m = /^\/v1\/ferry\/stops\/([^/]+)\/departures$/.exec(path)
  if (m) {
    const key = decodeURIComponent(m[1] as string)
    const base = day.stopDays[key]
    const stop = terminalById(key)
    if (!base || !stop) return json({ error: 'unknown_stop' }, 404)
    const toKey = url.searchParams.get('to')
    const to = toKey ? terminalById(toKey) : null
    if (toKey && !to) return json({ error: 'unknown_stop' }, 404)
    const days = dates.map((d) => ({ ...base, serviceDate: d }))
    const rt = synthRt(day, dates, realNowS, new Set(base.trips))
    const departures = mergeDepartures(days, rtState === 'unavailable' ? null : rt, {
      nowS,
      toStopIds: to ? new Set([to.id]) : undefined,
      limit: Math.min(Number(url.searchParams.get('limit')) || 20, 200),
      rtState,
      withStopsAfter: true,
    })
    return json(
      DeparturesResponse.parse({
        ...env(rt),
        mode: 'ferry',
        stop: { key, name: `${stop.name} ferry terminal`, stopIds: [key] },
        to: to ? { key: to.id, name: `${to.name} ferry terminal` } : null,
        departures,
      }),
    )
  }

  m = /^\/v1\/ferry\/trips\/([^/]+)$/.exec(path)
  if (m) {
    const key = decodeURIComponent(m[1] as string)
    const { tripId, serviceDate } = parseTripInstanceKey(key)
    const t = day.tripIndex.trips.find((x) => x.id === tripId)
    if (!t || !dates.includes(serviceDate)) return json({ error: 'unknown_trip' }, 404)
    const rt = synthRt(day, dates, realNowS, new Set([tripId]))
    const rtTrip = rtState === 'unavailable' ? undefined : rt.trips[key]
    const rows = tripStops(day.tripIndex, t, serviceDate)
    const stops = rows.map((s, i) => {
      const p = predictStop(rtTrip, s.seq, s.arr, s.dep, rtState)
      return {
        stopId: s.stopId,
        name: terminalById(s.stopId)?.name,
        stopSequence: s.seq,
        schedArr: i === 0 ? null : s.arr,
        schedDep: i === rows.length - 1 ? null : s.dep,
        estArr: i === 0 ? null : p.estArr,
        estDep: i === rows.length - 1 ? null : p.estDep,
        status: p.status,
        pickup: 0 as const,
        dropOff: 0 as const,
      }
    })
    const status: DepartureStatus = (stops[0]?.status ?? 'scheduled') as DepartureStatus
    const vehicle = rtState === 'live' ? (rt.vehicles.find((v) => v.tripKey === key) ?? null) : null
    return json(
      TripResponse.parse({
        ...env(rt),
        mode: 'ferry',
        tripInstance: key,
        route: day.tripIndex.routes[t.r],
        headsign: t.h,
        status,
        vehicle,
        stops,
      }),
    )
  }

  if (path === '/v1/ferry/vehicles') {
    const rt = synthRt(day, dates, realNowS)
    return json(
      VehiclesResponse.parse({ ...env(rt), mode: 'ferry', vehicles: rtState === 'live' ? rt.vehicles : [] }),
    )
  }
  if (path === '/v1/alerts') {
    return json(AlertsResponse.parse({ ...env(synthRt(day, dates, realNowS, new Set())), alerts: [] }))
  }
  return json({ error: 'not_found' }, 404)
}
