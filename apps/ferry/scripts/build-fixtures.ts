/**
 * Build the ferry app's bundled terminal list and its fixture data from a GTFS feed directory.
 *
 *   pnpm --filter @bft/ferry fixtures [gtfsDir=/tmp/bft-gtfs/x] [serviceDate=20261020]
 *
 * Writes:
 *  - app/data/terminals.json: every ferry terminal (id, name, slug, lat, lng) and the terminals reachable directly
 *    from it (any ferry trip in the feed that calls at both, in that order). Replaces the legacy hard-coded
 *    FERRY_STOPS / TEMPORARY_CONNECTIVITY. Slugs keep today's /terminal/<slug> URLs (checked by a test).
 *  - fixtures/ferry-day.json: one weekday of ferry StaticStopDay files (built the way the pipeline does, as in
 *    packages/core/test/helpers.ts) plus the TripIndexDay. Fixture mode rebases them onto "today".
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type CalendarDateRow,
  type CalendarRow,
  gtfsTimeToSeconds,
  type RouteRef,
  ServiceCalendar,
  type StaticStopDay,
  type StopEventTuple,
  type TripIndexDay,
} from '@bft/core'

const here = dirname(fileURLToPath(import.meta.url))
const gtfsDir = process.argv[2] ?? '/tmp/bft-gtfs/x'
const serviceDate = process.argv[3] ?? '20261020'

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function readCsv(name: string, keep?: (row: Record<string, string>) => boolean): Record<string, string>[] {
  const text = readFileSync(join(gtfsDir, name), 'utf8')
  const lines = text.split(/\r?\n/)
  const header = parseCsvLine(lines[0] as string)
  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] as string
    if (!line) continue
    const cells = parseCsvLine(line)
    const row: Record<string, string> = {}
    header.forEach((h, j) => {
      row[h] = cells[j] ?? ''
    })
    if (!keep || keep(row)) rows.push(row)
  }
  return rows
}

/** Legacy slug rule (src/utils/terminals.js) so /terminal/<slug> URLs don't change. */
export const legacySlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/ ferry terminal$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const cleanName = (name: string) => name.replace(/ ferry terminal$/i, '')

// Brisbane River services only (F1, F11, F12, F2x): the bay island ferries (F50 Coochiemudlo, SMBI) are not part of
// BrisbaneFerry, matching the legacy app's 22 terminals.
const RIVER_ROUTE = /^F([1-9]|[1-4]\d)$/
const routes = readCsv('routes.txt', (r) => r.route_type === '4' && RIVER_ROUTE.test(r.route_short_name as string))
const routeById = new Map(routes.map((r) => [r.route_id as string, r]))
const trips = readCsv('trips.txt', (r) => routeById.has(r.route_id as string))
const tripById = new Map(trips.map((t) => [t.trip_id as string, t]))
const stopTimes = readCsv('stop_times.txt', (r) => tripById.has(r.trip_id as string))
const stopsRaw = readCsv('stops.txt')
const stopById = new Map(stopsRaw.map((s) => [s.stop_id as string, s]))
const calendar = new ServiceCalendar(
  readCsv('calendar.txt') as unknown as CalendarRow[],
  readCsv('calendar_dates.txt') as unknown as CalendarDateRow[],
)

type St = { stopId: string; seq: number; arr: number; dep: number; pickup: number; dropOff: number }
const byTrip = new Map<string, St[]>()
for (const r of stopTimes) {
  const list = byTrip.get(r.trip_id as string) ?? []
  list.push({
    stopId: r.stop_id as string,
    seq: Number(r.stop_sequence),
    arr: gtfsTimeToSeconds(r.arrival_time || r.departure_time) as number,
    dep: gtfsTimeToSeconds(r.departure_time || r.arrival_time) as number,
    pickup: Number(r.pickup_type || 0),
    dropOff: Number(r.drop_off_type || 0),
  })
  byTrip.set(r.trip_id as string, list)
}
for (const list of byTrip.values()) list.sort((a, b) => a.seq - b.seq)

// ---- terminals + connectivity (all ferry trips in the feed) ----
const reach = new Map<string, Set<string>>()
for (const list of byTrip.values()) {
  list.forEach((s, i) => {
    if (s.pickup === 1) return
    const set = reach.get(s.stopId) ?? new Set<string>()
    for (const d of list.slice(i + 1)) if (d.dropOff !== 1 && d.stopId !== s.stopId) set.add(d.stopId)
    reach.set(s.stopId, set)
  })
}
// Route codes boarding at each terminal (not at a trip's last stop) and the terminals each route calls at.
const routesAt = new Map<string, Set<string>>()
const routeStops = new Map<string, Set<string>>()
for (const [tripId, list] of byTrip) {
  const code = routeById.get(tripById.get(tripId)?.route_id as string)?.route_short_name as string
  list.forEach((s, i) => {
    const rs = routeStops.get(code) ?? new Set<string>()
    rs.add(s.stopId)
    routeStops.set(code, rs)
    if (i === list.length - 1 || s.pickup === 1) return
    const ra = routesAt.get(s.stopId) ?? new Set<string>()
    ra.add(code)
    routesAt.set(s.stopId, ra)
  })
}
const byCode = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
const terminalIds = [...new Set(stopTimes.map((r) => r.stop_id as string))]
const terminals = terminalIds
  .map((id) => {
    const s = stopById.get(id) as Record<string, string>
    const name = cleanName(s.stop_name as string)
    return {
      id,
      name,
      slug: legacySlug(name),
      lat: Number(s.stop_lat),
      lng: Number(s.stop_lon),
      destinations: [...(reach.get(id) ?? [])].sort(),
      routes: [...(routesAt.get(id) ?? [])].sort(byCode),
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(join(here, '../app/data/terminals.json'), `${JSON.stringify(terminals, null, 1)}\n`)
writeFileSync(
  join(here, '../app/data/routes.json'),
  `${JSON.stringify(Object.fromEntries([...routeStops].sort((a, b) => byCode(a[0], b[0])).map(([c, s]) => [c, [...s].sort()])), null, 1)}\n`,
)

// ---- one service day of stop-day files + trip index ----
const active = calendar.activeServices(serviceDate)
const dayTrips = trips.filter((t) => active.has(t.service_id as string))
const routeRef = (id: string): RouteRef => {
  const r = routeById.get(id) as Record<string, string>
  return {
    id,
    short: r.route_short_name as string,
    long: r.route_long_name,
    color: r.route_color || undefined,
    textColor: r.route_text_color || undefined,
  }
}

const tripIndex: TripIndexDay = {
  schemaVersion: 1,
  mode: 'ferry',
  serviceDate,
  generation: `fixture-${serviceDate}`,
  routes: [],
  stops: [],
  trips: [],
}
const idx = <T>(arr: T[], v: T, eq: (a: T) => boolean) => {
  let i = arr.findIndex(eq)
  if (i < 0) i = arr.push(v) - 1
  return i
}
const stopDays = new Map<string, StaticStopDay>()
const dayFor = (stopId: string): StaticStopDay => {
  let d = stopDays.get(stopId)
  if (!d) {
    d = {
      schemaVersion: 1,
      mode: 'ferry',
      stopKey: stopId,
      serviceDate,
      trips: [],
      routes: [],
      headsigns: [],
      stops: [],
      events: [],
    }
    stopDays.set(stopId, d)
  }
  return d
}
const stopRef = (id: string) => ({ id, name: (stopById.get(id)?.stop_name as string) ?? id })

for (const t of dayTrips) {
  const tripId = t.trip_id as string
  const list = byTrip.get(tripId) ?? []
  const routeId = t.route_id as string
  const headsign = cleanName(t.trip_headsign ?? '')
  const dir = (t.direction_id === '1' ? 1 : t.direction_id === '0' ? 0 : -1) as 0 | 1 | -1
  const st: number[] = []
  for (const s of list) {
    st.push(
      idx(tripIndex.stops, s.stopId, (x) => x === s.stopId),
      s.seq,
      s.arr,
      s.dep,
      s.pickup,
      s.dropOff,
    )
  }
  tripIndex.trips.push({
    id: tripId,
    r: idx(tripIndex.routes, routeRef(routeId), (x) => x.id === routeId),
    d: dir,
    h: headsign,
    st,
  })
  list.forEach((s, i) => {
    if (s.pickup === 1 || i === list.length - 1) return
    const day = dayFor(s.stopId)
    const ds: number[] = []
    for (const d of list.slice(i + 1)) {
      if (d.dropOff === 1) continue
      ds.push(idx(day.stops, stopRef(d.stopId), (x) => x.id === d.stopId), d.arr - s.dep, d.dropOff, d.seq - s.seq)
    }
    const ev: StopEventTuple = [
      idx(day.trips, tripId, (x) => x === tripId),
      s.seq,
      s.arr,
      s.dep,
      idx(day.routes, routeRef(routeId), (x) => x.id === routeId),
      idx(day.headsigns, headsign, (x) => x === headsign),
      idx(day.stops, stopRef(s.stopId), (x) => x.id === s.stopId),
      s.pickup as 0 | 1 | 2 | 3,
      dir,
      ds,
    ]
    day.events.push(ev)
  })
}
for (const d of stopDays.values()) d.events.sort((a, b) => a[3] - b[3] || a[0] - b[0])

const out = { serviceDate, stopDays: Object.fromEntries(stopDays), tripIndex }
const json = JSON.stringify(out)
writeFileSync(join(here, '../fixtures/ferry-day.json'), json)
console.log(
  `terminals: ${terminals.length}; ${serviceDate}: ${dayTrips.length} trips, ${stopDays.size} stop-days, ${(json.length / 1024).toFixed(0)} KB`,
)
