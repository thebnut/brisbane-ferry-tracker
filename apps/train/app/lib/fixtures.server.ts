/**
 * Fixture mode: /v1 responses built from a recorded weekday of the real rail timetable (fixtures/train-day.json, a
 * contract TripIndexDay from scripts/build-data.ts) merged by @bft/core with a deterministic synthetic RT snapshot,
 * rebased onto today so countdowns stay meaningful. Lets dev, Playwright and staging run without the live API.
 *
 * Each station's StaticStopDay is derived from the trip index on first use, the way the pipeline builds it (keyed by
 * parent station slug, platform as a field, no pickup_type=1 events, downstream only where alighting is allowed), so
 * the committed fixture stays small and one request does one station's work (Workers Free: 10 ms CPU).
 *
 * Synthetic RT, per trip instance (stable hash): 1 in 15 cancelled; 2 in 10 late by 2–4 min, 1 in 10 a minute
 * early; 1 in 5 moved to another platform at the first multi-platform station it calls at; 1 in 20 skips its third
 * stop. Query `rt=unavailable|stale|reloading` forces an rtState for the banners.
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
  platformChange,
  predictStop,
  type RtSnapshot,
  type RtState,
  type RtStopUpdate,
  type RtTrip,
  SCHEMA_VERSION,
  type StaticStopDay,
  type StopEventTuple,
  type StopRef,
  type TripIndexDay,
  TripResponse,
  tripInstanceKey,
  type Vehicle,
  VehiclesResponse,
} from '@bft/core'
import { lineNameFor } from './lineNames.ts'
import { platformOf, stationByKey, stationKeyOfStop, stationPlatforms } from './network.ts'

interface FixtureDay {
  serviceDate: string
  tripIndex: TripIndexDay
}

let cache: Promise<FixtureDay> | null = null
const load = () => {
  cache ??= import('../../fixtures/train-day.json').then((m) => m.default as unknown as FixtureDay)
  return cache
}

/** Small stable hash so the same trip always gets the same synthetic behaviour. */
export function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

type Row = { si: number; seq: number; arr: number; dep: number; pickup: number; dropOff: number }
type Trip = TripIndexDay['trips'][number]

const rowsOf = (t: Trip): Row[] => {
  const out: Row[] = []
  for (let i = 0; i + 5 < t.st.length; i += 6) {
    out.push({
      si: t.st[i] as number,
      seq: t.st[i + 1] as number,
      arr: t.st[i + 2] as number,
      dep: t.st[i + 3] as number,
      pickup: t.st[i + 4] as number,
      dropOff: t.st[i + 5] as number,
    })
  }
  return out
}

const stopRefOf = (stopId: string): StopRef => {
  const p = platformOf(stopId)
  if (!p) return { id: stopId, name: stopId }
  const ref: StopRef = {
    id: stopId,
    name: p.code ? `${p.station.name} station, platform ${p.code}` : `${p.station.name} station`,
    key: p.station.key,
  }
  if (p.code) ref.platform = p.code
  return ref
}

const stopDays = new Map<string, StaticStopDay>()

/** The station's StaticStopDay for the fixture's service date (pipeline stop-days.ts rules). */
export function stationDay(fx: FixtureDay, key: string): StaticStopDay | null {
  const hit = stopDays.get(key)
  if (hit) return hit
  const idx = fx.tripIndex
  const keyOf = idx.stops.map((id) => stationKeyOfStop(id))
  const day: StaticStopDay = {
    schemaVersion: SCHEMA_VERSION,
    mode: 'train',
    stopKey: key,
    serviceDate: fx.serviceDate,
    trips: [],
    routes: [],
    headsigns: [],
    stops: [],
    events: [],
  }
  const intern = <T>(arr: T[], map: Map<string, number>, id: string, make: () => T) => {
    let i = map.get(id)
    if (i == null) {
      i = arr.push(make()) - 1
      map.set(id, i)
    }
    return i
  }
  const tripI = new Map<string, number>()
  const routeI = new Map<string, number>()
  const headI = new Map<string, number>()
  const stopI = new Map<string, number>()
  for (const t of idx.trips) {
    const rows = rowsOf(t)
    for (let r = 0; r < rows.length - 1; r++) {
      const row = rows[r] as Row
      if (row.pickup === 1 || keyOf[row.si] !== key) continue
      const route = idx.routes[t.r]
      if (!route) continue
      const ds: number[] = []
      for (const d of rows.slice(r + 1)) {
        if (d.dropOff === 1) continue
        const id = idx.stops[d.si] as string
        ds.push(
          intern(day.stops, stopI, id, () => stopRefOf(id)),
          d.arr - row.dep,
          d.dropOff,
          d.seq - row.seq,
        )
      }
      const boardId = idx.stops[row.si] as string
      day.events.push([
        intern(day.trips, tripI, t.id, () => t.id),
        row.seq,
        row.arr,
        row.dep,
        intern(day.routes, routeI, route.id, () => route),
        intern(day.headsigns, headI, t.h, () => t.h),
        intern(day.stops, stopI, boardId, () => stopRefOf(boardId)),
        row.pickup as StopEventTuple[7],
        t.d,
        ds,
      ])
    }
  }
  if (day.events.length === 0) return null
  day.events.sort(
    (a, b) => a[3] - b[3] || (day.trips[a[0]] as string).localeCompare(day.trips[b[0]] as string),
  )
  stopDays.set(key, day)
  return day
}

const KINDS = ['NGR', 'IMU', 'SMU', 'EMU'] as const
const PLATFORM_CHANGE_STATIONS = new Set(['roma-street', 'central', 'fortitude-valley', 'bowen-hills'])

let bounds: Array<[number, number]> | null = null
let rtCache: { key: string; snap: RtSnapshot } | null = null

/**
 * Synthetic RT for trips running or starting within the next hour on the given service dates. Cached per 15 s
 * cycle (like the real hub's snapshot), so polling stays inside the Workers Free CPU budget.
 */
export function synthRt(fx: FixtureDay, dates: string[], nowS: number): RtSnapshot {
  const cycle = Math.floor(nowS / 15)
  const cacheKey = `${dates.join(',')}|${cycle}`
  if (rtCache?.key === cacheKey) return rtCache.snap
  const snap = buildRt(fx, dates, cycle * 15)
  rtCache = { key: cacheKey, snap }
  return snap
}

function buildRt(fx: FixtureDay, dates: string[], nowS: number): RtSnapshot {
  const idx = fx.tripIndex
  const trips: Record<string, RtTrip> = {}
  const vehicles: Vehicle[] = []
  // First departure and last arrival (GTFS seconds) per trip, computed once per isolate.
  bounds ??= idx.trips.map((t) => [t.st[3] as number, t.st[t.st.length - 4] as number])
  for (const date of dates) {
    const base = gtfsToEpoch(date, 0)
    for (let ti = 0; ti < idx.trips.length; ti++) {
      const [s0, s1] = bounds[ti] as [number, number]
      const start = base + s0
      const end = base + s1
      if (nowS < start - 60 * 60 || nowS > end + 120) continue
      const t = idx.trips[ti] as Trip
      const rows = rowsOf(t)
      const first = rows[0]
      const last = rows[rows.length - 1]
      if (!first || !last) continue
      const key = tripInstanceKey(t.id, date)
      const h = hash(key)
      if (h % 15 === 4) {
        trips[key] = { key, rel: 'CANCELED', ts: nowS - 12, until: end, updates: [] }
        continue
      }
      const bucket = h % 10
      const delay = bucket === 7 || bucket === 8 ? 120 + (h % 3) * 60 : bucket === 9 ? -60 : 0
      const vehicleId = `fx${h % 997}`
      const updates: RtStopUpdate[] = [
        { seq: first.seq, stopId: idx.stops[first.si], rel: 'SCHEDULED', arrDelay: delay, depDelay: delay },
      ]
      if (h % 5 === 2) {
        // Platform change at a busy city station it calls at (where they really happen), else at the first station
        // with 3+ platforms; never at the terminus.
        const calls = rows.slice(0, -1).filter((r) => r.pickup !== 1)
        const at =
          calls.find((r) =>
            PLATFORM_CHANGE_STATIONS.has(platformOf(idx.stops[r.si] as string)?.station.key ?? ''),
          ) ?? calls.find((r) => (platformOf(idx.stops[r.si] as string)?.station.platforms.length ?? 0) >= 3)
        const stopId = at ? (idx.stops[at.si] as string) : ''
        const others = platformOf(stopId)?.station.platforms.filter((x) => x.id !== stopId) ?? []
        const to = others[h % Math.max(1, others.length)]
        if (at && to) {
          if (at.seq === first.seq) updates.shift()
          updates.push({ seq: at.seq, stopId: to.id, rel: 'SCHEDULED', arrDelay: delay, depDelay: delay })
        }
      }
      const third = rows[2]
      if (h % 20 === 7 && third && rows.length > 4 && !updates.some((u) => u.seq === third.seq)) {
        updates.push({ seq: third.seq, stopId: idx.stops[third.si], rel: 'SKIPPED' })
      }
      updates.sort((a, b) => a.seq - b.seq)
      trips[key] = { key, rel: 'SCHEDULED', tier: 1, ts: nowS - 12, vehicleId, updates }
      if (nowS < start + delay) continue
      // Position: interpolate between the stations either side of "now".
      let prev = first
      let next = first
      for (const s of rows) {
        if (base + s.dep + delay <= nowS) prev = s
        if (base + s.arr + delay >= nowS) {
          next = s
          break
        }
        next = s
      }
      const a = platformOf(idx.stops[prev.si] as string)?.station
      const b = platformOf(idx.stops[next.si] as string)?.station
      if (!a || !b) continue
      const span = next.arr - prev.dep
      const f = span > 0 ? Math.min(1, Math.max(0, (nowS - delay - (base + prev.dep)) / span)) : 1
      vehicles.push({
        id: vehicleId,
        label: `${KINDS[h % KINDS.length]} ${700 + (h % 90)}`,
        tripKey: key,
        routeId: idx.routes[t.r]?.id,
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        speed: f > 0 && f < 1 ? 16 : 0,
        occupancy: h % 3 === 0 ? 'FEW_SEATS_AVAILABLE' : 'MANY_SEATS_AVAILABLE',
        status: f >= 1 || prev === next ? 'STOPPED_AT' : 'IN_TRANSIT_TO',
        stopId: idx.stops[next.si],
        ts: nowS - 15,
      })
    }
  }
  return {
    header: {
      schemaVersion: SCHEMA_VERSION,
      seq: Math.floor(nowS / 15),
      staticGeneration: { train: idx.generation },
      serviceDates: dates,
      sourceTimestamp: nowS - 12,
      fetchedAt: nowS * 1000 - 9000,
    },
    trips,
    vehicles,
    alerts: [],
  }
}

/** Three standing alerts in the T-Alerts shape: a platform change, minor delays and weekend works. */
export function fixtureAlerts(fx: FixtureDay, nowS: number): Alert[] {
  const routesOf = (line: string) =>
    fx.tripIndex.routes
      .filter((r) =>
        fx.tripIndex.trips.some((t) => fx.tripIndex.routes[t.r] === r && lineNameFor(r.long, t.h) === line),
      )
      .map((r) => r.id)
  const roma = stationByKey('roma-street')
  const base = { cause: 'TECHNICAL_PROBLEM', modes: ['train' as const] }
  return [
    {
      ...base,
      id: 'fx-roma-platforms',
      header: 'Platform changes at Roma Street this afternoon',
      description:
        'Westbound Springfield services leave from platform 7 until 6 pm while platform 4 is being repaired.',
      effect: 'OTHER_EFFECT',
      severity: 'WARNING',
      summary: 'Roma Street platform 7 until 6 pm',
      activePeriods: [{ start: nowS - 3600, end: nowS + 4 * 3600 }],
      routes: routesOf('Springfield'),
      stops: (roma?.platforms ?? []).map((p) => p.id),
    },
    {
      ...base,
      id: 'fx-ipswich-delays',
      header: 'Minor delays on the Ipswich/Rosewood line',
      description: 'Services are running up to 5 minutes late after an earlier signal fault at Darra.',
      effect: 'SIGNIFICANT_DELAYS',
      severity: 'WARNING',
      summary: 'Up to 5 min, earlier signal fault',
      activePeriods: [{ start: nowS - 1800, end: nowS + 2 * 3600 }],
      routes: routesOf('Ipswich/Rosewood'),
      stops: [],
    },
    {
      ...base,
      cause: 'MAINTENANCE',
      id: 'fx-shorncliffe-works',
      header: 'Weekend track works: Shorncliffe line',
      description: 'Buses replace trains between Northgate and Shorncliffe on Saturday and Sunday.',
      effect: 'MODIFIED_SERVICE',
      severity: 'INFO',
      summary: 'Buses replace trains Sat–Sun',
      activePeriods: [{ start: nowS - 600, end: nowS + 3 * 24 * 3600 }],
      routes: routesOf('Shorncliffe'),
      stops: [],
    },
  ]
}

function forcedState(url: URL): RtState {
  const rt = url.searchParams.get('rt')
  return rt === 'unavailable' || rt === 'stale' || rt === 'reloading' ? rt : 'live'
}

function envelope(fx: FixtureDay, dates: string[], rt: RtSnapshot, rtState: RtState, nowMs: number) {
  return {
    schemaVersion: SCHEMA_VERSION,
    staticGeneration: fx.tripIndex.generation,
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
  const fx = await load()
  const path = url.pathname.replace(/^\/__fixtures/, '')
  const at = Number(url.searchParams.get('at')) || 0
  const realNowS = Math.floor(nowMs / 1000)
  const nowS = Math.max(realNowS, at)
  const today = currentServiceDate(nowS * 1000)
  const dates = [addDays(today, -1), today, addDays(today, 1)]
  const rtState = forcedState(url)
  const rt = synthRt(fx, dates, realNowS)
  const env = envelope(fx, dates, rt, rtState, nowMs)
  const usedRt = rtState === 'unavailable' ? null : rt

  let m = /^\/v1\/train\/stops\/([^/]+)\/departures$/.exec(path)
  if (m) {
    const key = decodeURIComponent(m[1] as string)
    const station = stationByKey(key)
    const base = station ? stationDay(fx, key) : null
    if (!station || !base) return json({ error: 'unknown stop', detail: key }, 404)
    const toKey = url.searchParams.get('to')
    const to = toKey ? stationByKey(toKey) : null
    if (toKey && !to) return json({ error: 'unknown stop', detail: toKey }, 404)
    const days = dates.map((d) => ({ ...base, serviceDate: d }))
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 100)
    const departures = mergeDepartures(days, usedRt, {
      nowS,
      toStopIds: to ? new Set(to.platforms.map((p) => p.id)) : undefined,
      limit,
      rtState,
      withStopsAfter: true,
      boardingStopIds: new Set(station.platforms.map((p) => p.id)),
      stationPlatforms: stationPlatforms(key),
    })
    return json(
      DeparturesResponse.parse({
        ...env,
        mode: 'train',
        stop: { key, name: `${station.name} station`, stopIds: station.platforms.map((p) => p.id) },
        to: to ? { key: to.key, name: `${to.name} station` } : null,
        departures,
      }),
    )
  }

  m = /^\/v1\/train\/trips\/([^/]+)$/.exec(path)
  if (m) {
    const key = decodeURIComponent(m[1] as string)
    const { tripId, serviceDate } = parseTripInstanceKey(key)
    const t = fx.tripIndex.trips.find((x) => x.id === tripId)
    if (!t || !dates.includes(serviceDate)) return json({ error: 'unknown trip', detail: key }, 404)
    const rtTrip = usedRt?.trips[key]
    const rows = rowsOf(t)
    const stops = rows.map((s) => {
      const stopId = fx.tripIndex.stops[s.si] as string
      const schedArr = gtfsToEpoch(serviceDate, s.arr)
      const schedDep = gtfsToEpoch(serviceDate, s.dep)
      const p = predictStop(rtTrip, s.seq, schedArr, schedDep, rtState)
      const ref = stopRefOf(stopId)
      const sk = ref.key ?? stopId
      const change =
        p.status === 'live'
          ? platformChange(rtTrip, s.seq, ref, { stopKey: sk, stops: [] }, stationPlatforms(sk))
          : null
      return {
        stopId: change?.stopId ?? stopId,
        name: stationByKey(sk)?.name,
        platform: change ? change.platform : (ref.platform ?? null),
        ...(change && ref.platform && change.platform !== ref.platform
          ? { scheduledPlatform: ref.platform }
          : {}),
        stationKey: sk,
        stopSequence: s.seq,
        schedArr,
        schedDep,
        estArr: p.estArr,
        estDep: p.estDep,
        status: p.status,
        pickup: (s.pickup & 3) as 0 | 1 | 2 | 3,
        dropOff: (s.dropOff & 3) as 0 | 1 | 2 | 3,
      }
    })
    const status: DepartureStatus = stops.some((s) => s.status === 'cancelled')
      ? 'cancelled'
      : stops.some((s) => s.status === 'unknown')
        ? 'unknown'
        : stops.some((s) => s.status === 'live')
          ? 'live'
          : 'scheduled'
    const vehicle = rtState === 'live' ? (rt.vehicles.find((v) => v.tripKey === key) ?? null) : null
    return json(
      TripResponse.parse({
        ...env,
        mode: 'train',
        tripInstance: key,
        route: fx.tripIndex.routes[t.r],
        headsign: t.h,
        status,
        vehicle,
        stops,
      }),
    )
  }

  if (path === '/v1/train/vehicles') {
    return json(
      VehiclesResponse.parse({ ...env, mode: 'train', vehicles: rtState === 'live' ? rt.vehicles : [] }),
    )
  }
  if (path === '/v1/alerts') {
    const mode = url.searchParams.get('mode')
    const alerts = mode && mode !== 'train' ? [] : fixtureAlerts(fx, realNowS)
    return json(AlertsResponse.parse({ ...env, alerts }))
  }
  return json({ error: 'not_found' }, 404)
}
