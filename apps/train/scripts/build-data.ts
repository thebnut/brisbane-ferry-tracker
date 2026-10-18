/**
 * Build the train app's static data and fixture from a GTFS feed directory.
 *
 *   pnpm --filter @bft/train data [gtfsDir=/tmp/bft-gtfs/x] [serviceDate=20261020]
 *
 * Writes, in the layout and schemas feat/p1-static-pipeline publishes (core StopIndexFile / LinesFile):
 *  - app/data/stops.json  data/train/stops.json: every station (key = parent station slug), platforms, routes
 *  - app/data/lines.json  data/train/lines.json: route colours and stopping patterns (station keys)
 *    Both are also copied to public/data/train/ so browsers fetch them as free static assets.
 *  - fixtures/train-day.json: one weekday's TripIndexDay (contract shape). Fixture mode derives each station's
 *    StaticStopDay from it the way the pipeline does, so the committed file stays small.
 * Patterns and stations use trips active in the 7 days from serviceDate (the pipeline's build window).
 * Once the pipeline publishes data/train/* to R2, the app can read those instead (same schemas).
 */
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import {
  addDays,
  type CalendarDateRow,
  type CalendarRow,
  cleanStopName,
  gtfsTimeToSeconds,
  type Line,
  LinesFile,
  type RouteRef,
  ServiceCalendar,
  type StopIndexEntry,
  StopIndexFile,
  type StopPattern,
  slugify,
  TripIndexDay,
} from '@bft/core'
import { LINE_COLOURS, lineNameFor } from '../app/lib/lineNames.ts'

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
  const lines = readFileSync(join(gtfsDir, name), 'utf8').split(/\r?\n/)
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

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const natural = new Intl.Collator('en', { numeric: true }).compare
const round6 = (x: number) => Math.round(x * 1e6) / 1e6
const HEX6 = /^[0-9A-Fa-f]{6}$/

const routes = readCsv('routes.txt', (r) => r.route_type === '2')
const routeById = new Map(routes.map((r) => [r.route_id as string, r]))
const trips = readCsv('trips.txt', (r) => routeById.has(r.route_id as string))
const tripById = new Map(trips.map((t) => [t.trip_id as string, t]))
const stopsRaw = readCsv('stops.txt')
const stopById = new Map(stopsRaw.map((s) => [s.stop_id as string, s]))
const calendar = new ServiceCalendar(
  readCsv('calendar.txt') as unknown as CalendarRow[],
  readCsv('calendar_dates.txt') as unknown as CalendarDateRow[],
)

type St = { stopId: string; seq: number; arr: number; dep: number; pickup: number; dropOff: number }
const byTrip = new Map<string, St[]>()
{
  // stop_times.txt is ~200 MB: stream it and keep only train rows.
  const rl = createInterface({ input: createReadStream(join(gtfsDir, 'stop_times.txt')) })
  let header: string[] | null = null
  for await (const line of rl) {
    if (!header) {
      header = parseCsvLine(line)
      continue
    }
    const tripId = line.slice(0, line.indexOf(','))
    if (!tripById.has(tripId)) continue
    const c = parseCsvLine(line)
    const r = Object.fromEntries(header.map((h, j) => [h, c[j] ?? '']))
    const list = byTrip.get(tripId) ?? []
    list.push({
      stopId: r.stop_id as string,
      seq: Number(r.stop_sequence),
      arr: gtfsTimeToSeconds(r.arrival_time || r.departure_time) as number,
      dep: gtfsTimeToSeconds(r.departure_time || r.arrival_time) as number,
      pickup: Number(r.pickup_type || 0),
      dropOff: Number(r.drop_off_type || 0),
    })
    byTrip.set(tripId, list)
  }
}
for (const list of byTrip.values()) list.sort((a, b) => a.seq - b.seq)

// ---- station keys (pipeline keys.ts rule: slug of the parent station name; clashes get the station id) ----
const stationIdOf = (stopId: string) => {
  const s = stopById.get(stopId)
  return s?.parent_station ? (s.parent_station as string) : stopId
}
const stationIds = new Set<string>()
for (const list of byTrip.values()) for (const s of list) stationIds.add(stationIdOf(s.stopId))
const bySlug = new Map<string, string[]>()
for (const id of [...stationIds].sort()) {
  const slug = slugify((stopById.get(id)?.stop_name as string) ?? id) || slugify(id)
  bySlug.set(slug, [...(bySlug.get(slug) ?? []), id])
}
const keyOfStation = new Map<string, string>()
for (const [slug, ids] of bySlug) {
  ids.forEach((id, i) => {
    keyOfStation.set(id, i === 0 ? slug : `${slug}-${slugify(id)}`)
  })
}
const keyOf = (stopId: string) => keyOfStation.get(stationIdOf(stopId)) as string

const routeRef = (id: string): RouteRef => {
  const r = routeById.get(id) as Record<string, string>
  const ref: RouteRef = { id, short: r.route_short_name as string }
  if (r.route_long_name) ref.long = r.route_long_name
  if (HEX6.test(r.route_color ?? '')) ref.color = (r.route_color as string).toUpperCase()
  if (HEX6.test(r.route_text_color ?? '')) ref.textColor = (r.route_text_color as string).toUpperCase()
  return ref
}
const headsignOf = (t: Record<string, string>, list: St[]) =>
  t.trip_headsign || ((stopById.get(list[list.length - 1]?.stopId ?? '')?.stop_name as string) ?? '')
const dirOf = (t: Record<string, string>) =>
  (t.direction_id === '1' ? 1 : t.direction_id === '0' ? 0 : -1) as 0 | 1 | -1

// ---- client data over the 7-day window ----
const windowServices = new Set<string>()
for (let i = 0; i < 7; i++)
  for (const s of calendar.activeServices(addDays(serviceDate, i))) windowServices.add(s)
const windowTrips = [...byTrip.keys()]
  .filter((id) => windowServices.has(tripById.get(id)?.service_id as string))
  .sort(cmp)

const stopRoutes = new Map<string, Set<string>>()
const platforms = new Map<string, Map<string, string>>()
const lines = new Map<string, { routes: Set<string>; patterns: Map<string, StopPattern> }>()
for (const tripId of windowTrips) {
  const t = tripById.get(tripId) as Record<string, string>
  const list = byTrip.get(tripId) as St[]
  const short = routeById.get(t.route_id as string)?.route_short_name as string
  const seqKeys: string[] = []
  for (const s of list) {
    const key = keyOf(s.stopId)
    seqKeys.push(key)
    const rs = stopRoutes.get(key) ?? new Set<string>()
    rs.add(short)
    stopRoutes.set(key, rs)
    const p = platforms.get(key) ?? new Map<string, string>()
    p.set(s.stopId, (stopById.get(s.stopId)?.platform_code as string) ?? '')
    platforms.set(key, p)
  }
  const line = lines.get(short) ?? { routes: new Set<string>(), patterns: new Map<string, StopPattern>() }
  lines.set(short, line)
  line.routes.add(t.route_id as string)
  const headsign = headsignOf(t, list)
  const pk = `${dirOf(t)}|${headsign}|${seqKeys.join('>')}`
  const pat = line.patterns.get(pk)
  if (pat) pat.trips++
  else line.patterns.set(pk, { directionId: dirOf(t), headsign, stops: seqKeys, trips: 1 })
}

const generation = `fixture-${serviceDate}`
const stationRow = new Map(
  [...keyOfStation].map(([id, key]) => [key, stopById.get(id) as Record<string, string>]),
)
const entries: StopIndexEntry[] = [...stopRoutes.keys()].sort(cmp).map((key) => {
  const row = stationRow.get(key) as Record<string, string>
  const e: StopIndexEntry = {
    key,
    name: row.stop_name as string,
    lat: round6(Number(row.stop_lat)),
    lon: round6(Number(row.stop_lon)),
    routes: [...(stopRoutes.get(key) as Set<string>)].sort(natural),
  }
  if (row.stop_code) e.code = row.stop_code
  e.platforms = [...(platforms.get(key) as Map<string, string>).entries()]
    .sort((a, b) => natural(a[1], b[1]) || cmp(a[0], b[0]))
    .map(([id, code]) => (code ? { id, code } : { id }))
  return e
})
const lineList: Line[] = [...lines.entries()]
  .sort((a, b) => natural(a[0], b[0]))
  .map(([short, l]) => {
    const ids = [...l.routes].sort(cmp)
    const first = routeRef(ids[0] as string)
    const line: Line = {
      short,
      routeIds: ids,
      patterns: [...l.patterns.values()].sort(
        (a, b) =>
          b.trips - a.trips || a.directionId - b.directionId || cmp(a.stops.join('>'), b.stops.join('>')),
      ),
    }
    if (first.long) line.long = first.long
    if (first.color) line.color = first.color
    if (first.textColor) line.textColor = first.textColor
    return line
  })

const stopsFile = StopIndexFile.parse({ schemaVersion: 1, mode: 'train', generation, stops: entries })
const linesFile = LinesFile.parse({ schemaVersion: 1, mode: 'train', generation, lines: lineList })

// ---- compact network for the client bundle (station list + display lines), derived from the two files above ----
const stationIdx = new Map(stopsFile.stops.map((e, i) => [e.key, i]))
const display = new Map<string, Array<{ r: string; h: string; d: number; t: number; s: number[] }>>()
for (const line of linesFile.lines) {
  for (const p of line.patterns) {
    const name = lineNameFor(line.long, p.headsign)
    const list = display.get(name) ?? []
    list.push({
      r: line.short,
      h: cleanStopName(p.headsign),
      d: p.directionId,
      t: p.trips,
      s: p.stops.map((k) => stationIdx.get(k) as number),
    })
    display.set(name, list)
  }
}
const network = {
  generation,
  stations: stopsFile.stops.map((e) => ({
    k: e.key,
    n: cleanStopName(e.name),
    la: e.lat,
    lo: e.lon,
    p: (e.platforms ?? []).map((p) => [p.id, p.code ?? ''] as const),
  })),
  lines: [...display.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, patterns]) => ({
      name,
      color: LINE_COLOURS[name] ?? '666D8E',
      patterns: patterns.sort((a, b) => b.t - a.t || a.r.localeCompare(b.r)),
    })),
}

// ---- one service day's trip index (fixture) ----
const active = calendar.activeServices(serviceDate)
const dayTrips = [...byTrip.keys()]
  .filter((id) => active.has(tripById.get(id)?.service_id as string))
  .sort(cmp)
const tripIndex: TripIndexDay = {
  schemaVersion: 1,
  mode: 'train',
  serviceDate,
  generation,
  routes: [],
  stops: [],
  trips: [],
}
const routeIdx = new Map<string, number>()
const stopIdx = new Map<string, number>()
for (const tripId of dayTrips) {
  const t = tripById.get(tripId) as Record<string, string>
  const list = byTrip.get(tripId) as St[]
  const rid = t.route_id as string
  let r = routeIdx.get(rid)
  if (r == null) {
    r = tripIndex.routes.push(routeRef(rid)) - 1
    routeIdx.set(rid, r)
  }
  const st: number[] = []
  for (const s of list) {
    let si = stopIdx.get(s.stopId)
    if (si == null) {
      si = tripIndex.stops.push(s.stopId) - 1
      stopIdx.set(s.stopId, si)
    }
    st.push(si, s.seq, s.arr, s.dep, s.pickup, s.dropOff)
  }
  tripIndex.trips.push({ id: tripId, r, d: dirOf(t), h: headsignOf(t, list), st })
}
TripIndexDay.parse(tripIndex)

const write = (path: string, body: unknown) => {
  mkdirSync(dirname(path), { recursive: true })
  const json = JSON.stringify(body)
  writeFileSync(path, json)
  return json.length
}
const sStops = write(join(here, '../app/data/stops.json'), stopsFile)
const sLines = write(join(here, '../app/data/lines.json'), linesFile)
write(join(here, '../public/data/train/stops.json'), stopsFile)
write(join(here, '../public/data/train/lines.json'), linesFile)
const sNet = write(join(here, '../app/data/network.json'), network)
const sDay = write(join(here, '../fixtures/train-day.json'), { serviceDate, tripIndex })
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`
console.log(
  `stations ${entries.length} (${kb(sStops)}), lines ${lineList.length} with ${lineList.reduce((n, l) => n + l.patterns.length, 0)} patterns (${kb(sLines)}), network ${kb(sNet)}; ${serviceDate}: ${dayTrips.length} trips (${kb(sDay)})`,
)
