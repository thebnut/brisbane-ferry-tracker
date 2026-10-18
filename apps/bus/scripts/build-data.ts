/**
 * Build the bus app's static client data and its fixture day from a GTFS feed directory.
 *
 *   pnpm --filter @bft/bus data [gtfsDir=/tmp/bft-gtfs/x] [serviceDate=20261020]
 *
 * Writes (same shapes and paths as the pipeline's client data, transit-architecture.md §3.2 / §3.4):
 *  - public/data/bus/stops.json        StopIndexFile: every bus stop (key = stop_id, code, name, lat/lon, routes,
 *                                      busway platform code). Gitignored: deploys build it or the Worker proxies the
 *                                      API's /data/bus/*.
 *  - public/data/bus/geo/{gh5}.json    GeoTileFile per geohash-5 cell
 *  - public/data/bus/lines.json        LinesFile: route colours and stopping patterns
 *  - fixtures/bus-day.json             one weekday of real StaticStopDay files for a curated set of stops (busway
 *                                      stations and the CBD), a TripIndexDay for the curated routes, and the stops
 *                                      they touch. Fixture mode rebases it onto today. Committed (server-only).
 *  - fixtures/measurements.json        stop-day sizes per stop (raw / gzip / brotli) for the busiest stops.
 *
 * Trips are counted for the 7 days from serviceDate (D..D+6), like the pipeline's build window.
 */
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import {
  addDays,
  type CalendarDateRow,
  type CalendarRow,
  gtfsTimeToSeconds,
  type RouteRef,
  SCHEMA_VERSION,
  ServiceCalendar,
  type StaticStopDay,
  type StopEventTuple,
  type TripIndexDay,
} from '@bft/core'
import type {
  GeoTileFile,
  Line,
  LinesFile,
  RouteFile,
  StopIndexEntry,
  StopIndexFile,
} from '../app/lib/data-contract.ts'
import { geohashEncode } from '../app/lib/geo.ts'
import { routeFileFor } from '../app/lib/route-file.ts'

const here = dirname(fileURLToPath(import.meta.url))
const gtfsDir = process.argv[2] ?? '/tmp/bft-gtfs/x'
const serviceDate = process.argv[3] ?? '20261020'
const outDir = join(here, '../public/data/bus')

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

/** Stream a CSV file row by row (stop_times.txt is ~200 MB). `col(name)` gives a column's index. */
async function eachRow(name: string, fn: (row: string[], col: (n: string) => number) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(join(gtfsDir, name)), crlfDelay: Infinity })
  let header: string[] | null = null
  const col = (n: string) => header?.indexOf(n) ?? -1
  for await (const line of rl) {
    if (!line) continue
    const cells = parseCsvLine(line)
    if (!header) header = cells.map((h) => h.replace(/^\uFEFF/, ''))
    else fn(cells, col)
  }
}

async function readCsv(name: string): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = []
  let names: string[] | null = null
  const rl = createInterface({ input: createReadStream(join(gtfsDir, name)), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    const cells = parseCsvLine(line)
    if (!names) {
      names = cells.map((h) => h.replace(/^\uFEFF/, ''))
      continue
    }
    const o: Record<string, string> = {}
    names.forEach((n, i) => {
      o[n] = cells[i] ?? ''
    })
    rows.push(o)
  }
  return rows
}

const natural = new Intl.Collator('en', { numeric: true }).compare
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const round6 = (x: number) => Math.round(x * 1e6) / 1e6

// ---- feed ----
const routesRaw = (await readCsv('routes.txt')).filter((r) => r.route_type === '3')
const routeById = new Map(routesRaw.map((r) => [r.route_id as string, r]))
const tripsRaw = (await readCsv('trips.txt')).filter((t) => routeById.has(t.route_id as string))
const tripIdx = new Map(tripsRaw.map((t, i) => [t.trip_id as string, i]))
const stopsRaw = await readCsv('stops.txt')
const stopIdx = new Map(stopsRaw.map((s, i) => [s.stop_id as string, i]))
const calendar = new ServiceCalendar(
  (await readCsv('calendar.txt')) as unknown as CalendarRow[],
  (await readCsv('calendar_dates.txt')) as unknown as CalendarDateRow[],
)

// Columnar stop_times for bus trips only.
const N = 3_600_000
const stTrip = new Int32Array(N)
const stStop = new Int32Array(N)
const stSeq = new Int32Array(N)
const stArr = new Int32Array(N)
const stDep = new Int32Array(N)
const stPick = new Int8Array(N)
const stDrop = new Int8Array(N)
let n = 0
const t0 = Date.now()
await eachRow('stop_times.txt', (c, col) => {
  const ti = tripIdx.get(c[0] as string)
  if (ti == null) return
  const arr = gtfsTimeToSeconds(c[col('arrival_time')] || c[col('departure_time')])
  const dep = gtfsTimeToSeconds(c[col('departure_time')] || c[col('arrival_time')])
  stTrip[n] = ti
  stStop[n] = stopIdx.get(c[col('stop_id')] as string) ?? -1
  stSeq[n] = Number(c[col('stop_sequence')])
  stArr[n] = arr ?? 0
  stDep[n] = dep ?? 0
  stPick[n] = Number(c[col('pickup_type')] || 0)
  stDrop[n] = Number(c[col('drop_off_type')] || 0)
  n++
})
console.log(`stop_times: ${n} bus rows in ${((Date.now() - t0) / 1000).toFixed(1)} s`)

// Rows per trip, in stop_sequence order.
const byTrip: number[][] = tripsRaw.map(() => [])
for (let r = 0; r < n; r++) (byTrip[stTrip[r] as number] as number[]).push(r)
for (const rows of byTrip) rows.sort((a, b) => (stSeq[a] as number) - (stSeq[b] as number))

const routeRef = (id: string): RouteRef => {
  const r = routeById.get(id) as Record<string, string>
  const ref: RouteRef = { id, short: r.route_short_name as string }
  if (r.route_long_name) ref.long = r.route_long_name
  if (r.route_color) ref.color = r.route_color
  if (r.route_text_color) ref.textColor = r.route_text_color
  return ref
}
const stopRow = (si: number) => stopsRaw[si] as Record<string, string>
const headsignOf = (t: Record<string, string>) => t.trip_headsign ?? ''
const dirOf = (t: Record<string, string>) =>
  (t.direction_id === '1' ? 1 : t.direction_id === '0' ? 0 : -1) as 0 | 1 | -1

// ---- client data: trips active anywhere in D..D+6 ----
const windowServices = new Set<string>()
for (let i = 0; i < 7; i++)
  for (const s of calendar.activeServices(addDays(serviceDate, i))) windowServices.add(s)
const generation = `fixture-${serviceDate}`

const stopRoutes = new Map<number, Set<string>>()
const lines = new Map<string, { routes: Set<string>; patterns: Map<string, Line['patterns'][number]> }>()
tripsRaw.forEach((t, ti) => {
  if (!windowServices.has(t.service_id as string)) return
  const route = routeById.get(t.route_id as string) as Record<string, string>
  const short = route.route_short_name as string
  const keys: string[] = []
  for (const r of byTrip[ti] as number[]) {
    const si = stStop[r] as number
    if (si < 0) continue
    keys.push(stopRow(si).stop_id as string)
    let rs = stopRoutes.get(si)
    if (!rs) {
      rs = new Set()
      stopRoutes.set(si, rs)
    }
    rs.add(short)
  }
  let line = lines.get(short)
  if (!line) {
    line = { routes: new Set(), patterns: new Map() }
    lines.set(short, line)
  }
  line.routes.add(t.route_id as string)
  const pk = `${t.direction_id}|${headsignOf(t)}|${keys.join('>')}`
  const pat = line.patterns.get(pk)
  if (pat) pat.trips++
  else line.patterns.set(pk, { directionId: dirOf(t), headsign: headsignOf(t), stops: keys, trips: 1 })
})

const entries: StopIndexEntry[] = [...stopRoutes.keys()]
  .map((si) => {
    const s = stopRow(si)
    const e: StopIndexEntry = {
      key: s.stop_id as string,
      name: s.stop_name as string,
      lat: round6(Number(s.stop_lat)),
      lon: round6(Number(s.stop_lon)),
      routes: [...(stopRoutes.get(si) as Set<string>)].sort(natural),
    }
    if (s.stop_code) e.code = s.stop_code
    // Busway platforms ("Cultural Centre station, platform 1" → "1"; King George Square "2a").
    if (s.platform_code) e.platforms = [{ id: s.stop_id as string, code: s.platform_code }]
    return e
  })
  .sort((a, b) => cmp(a.key, b.key))

const stopsFile: StopIndexFile = { schemaVersion: SCHEMA_VERSION, mode: 'bus', generation, stops: entries }
const tiles = new Map<string, GeoTileFile['stops']>()
for (const e of entries) {
  const gh = geohashEncode(e.lat, e.lon, 5)
  const list = tiles.get(gh) ?? []
  const s: GeoTileFile['stops'][number] = { key: e.key, name: e.name, lat: e.lat, lon: e.lon }
  if (e.code) s.code = e.code
  list.push(s)
  tiles.set(gh, list)
}
const linesFile: LinesFile = {
  schemaVersion: SCHEMA_VERSION,
  mode: 'bus',
  generation,
  lines: [...lines.entries()]
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
    }),
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(join(outDir, 'geo'), { recursive: true })
const stopsJson = JSON.stringify(stopsFile)
writeFileSync(join(outDir, 'stops.json'), stopsJson)
for (const [gh, stops] of tiles) {
  const tile: GeoTileFile = { schemaVersion: SCHEMA_VERSION, mode: 'bus', generation, geohash: gh, stops }
  writeFileSync(join(outDir, 'geo', `${gh}.json`), JSON.stringify(tile))
}
const linesJson = JSON.stringify(linesFile)
writeFileSync(join(outDir, 'lines.json'), linesJson)
mkdirSync(join(outDir, 'routes'), { recursive: true })
const entryByKey = new Map(entries.map((e) => [e.key, e]))
for (const line of linesFile.lines) {
  const rf: RouteFile = routeFileFor(line, entryByKey, generation)
  writeFileSync(join(outDir, 'routes', `${encodeURIComponent(line.short)}.json`), JSON.stringify(rf))
}
const gz = (s: string | Buffer) => gzipSync(s, { level: 9 }).length
const br = (s: string | Buffer) =>
  brotliCompressSync(s, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`
console.log(
  `stops.json: ${entries.length} stops, ${kb(stopsJson.length)} raw, ${kb(gz(stopsJson))} gz, ${kb(br(stopsJson))} br`,
)
console.log(`geo tiles: ${tiles.size}; lines.json: ${lines.size} lines, ${kb(gz(linesJson))} gz`)

// ---- stop-day files for the fixture date (built the way the pipeline does, packages/core/test/helpers.ts) ----
const active = calendar.activeServices(serviceDate)
const stopDays = new Map<number, StaticStopDay>()
const idx = <T>(arr: T[], map: Map<string, number>, k: string, v: () => T) => {
  let i = map.get(k)
  if (i == null) {
    i = arr.push(v()) - 1
    map.set(k, i)
  }
  return i
}
type Lookup = {
  trips: Map<string, number>
  routes: Map<string, number>
  heads: Map<string, number>
  stops: Map<string, number>
}
const lookups = new Map<number, Lookup>()
const dayFor = (si: number): [StaticStopDay, Lookup] => {
  let d = stopDays.get(si)
  if (!d) {
    d = {
      schemaVersion: SCHEMA_VERSION,
      mode: 'bus',
      stopKey: stopRow(si).stop_id as string,
      serviceDate,
      trips: [],
      routes: [],
      headsigns: [],
      stops: [],
      events: [],
    }
    stopDays.set(si, d)
    lookups.set(si, { trips: new Map(), routes: new Map(), heads: new Map(), stops: new Map() })
  }
  return [d, lookups.get(si) as Lookup]
}
const stopRef = (si: number) => {
  const s = stopRow(si)
  const ref: StaticStopDay['stops'][number] = { id: s.stop_id as string, name: s.stop_name as string }
  if (s.platform_code) ref.platform = s.platform_code
  return ref
}
let dayTrips = 0
tripsRaw.forEach((t, ti) => {
  if (!active.has(t.service_id as string)) return
  dayTrips++
  const rows = byTrip[ti] as number[]
  const tripId = t.trip_id as string
  const routeId = t.route_id as string
  const headsign = headsignOf(t)
  rows.forEach((r, i) => {
    const si = stStop[r] as number
    if (si < 0 || stPick[r] === 1 || i === rows.length - 1) return
    const [day, lk] = dayFor(si)
    const ds: number[] = []
    for (const d of rows.slice(i + 1)) {
      if (stDrop[d] === 1 || (stStop[d] as number) < 0) continue
      const dsi = stStop[d] as number
      ds.push(
        idx(day.stops, lk.stops, String(dsi), () => stopRef(dsi)),
        (stArr[d] as number) - (stDep[r] as number),
        stDrop[d] as number,
        (stSeq[d] as number) - (stSeq[r] as number),
      )
    }
    const ev: StopEventTuple = [
      idx(day.trips, lk.trips, tripId, () => tripId),
      stSeq[r] as number,
      stArr[r] as number,
      stDep[r] as number,
      idx(day.routes, lk.routes, routeId, () => routeRef(routeId)),
      idx(day.headsigns, lk.heads, headsign, () => headsign),
      idx(day.stops, lk.stops, String(si), () => stopRef(si)),
      stPick[r] as 0 | 1 | 2 | 3,
      dirOf(t),
      ds,
    ]
    day.events.push(ev)
  })
})
for (const d of stopDays.values()) d.events.sort((a, b) => a[3] - b[3] || a[0] - b[0])
console.log(`${serviceDate}: ${dayTrips} bus trips, ${stopDays.size} stop-days`)

// ---- measurements: busiest stop-days ----
const sizes = [...stopDays.values()].map((d) => {
  const json = JSON.stringify(d)
  return {
    key: d.stopKey,
    name: stopRow(stopIdx.get(d.stopKey) as number).stop_name,
    events: d.events.length,
    raw: json.length,
    gz: gz(json),
    br: br(json),
  }
})
sizes.sort((a, b) => b.gz - a.gz)
const pct = (p: number, xs: number[]) => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)] ?? 0
const measurements = {
  serviceDate,
  stopDays: stopDays.size,
  gz: {
    median: pct(
      0.5,
      sizes.map((s) => s.gz),
    ),
    p95: pct(
      0.95,
      sizes.map((s) => s.gz),
    ),
    max: sizes[0]?.gz,
  },
  br: {
    median: pct(
      0.5,
      sizes.map((s) => s.br),
    ),
    p95: pct(
      0.95,
      sizes.map((s) => s.br),
    ),
    max: Math.max(...sizes.map((s) => s.br)),
  },
  busiest: sizes.slice(0, 10),
  stopsIndex: { stops: entries.length, raw: stopsJson.length, gz: gz(stopsJson), br: br(stopsJson) },
  lines: { lines: lines.size, raw: linesJson.length, gz: gz(linesJson), br: br(linesJson) },
  geoTiles: tiles.size,
}
writeFileSync(join(here, '../fixtures/measurements.json'), `${JSON.stringify(measurements, null, 1)}\n`)
console.log(
  'busiest stop-days:',
  sizes
    .slice(0, 3)
    .map((s) => `${s.name} (${s.key}) ${kb(s.gz)} gz`)
    .join('; '),
)

// ---- fixture: curated stops, their stop-days, and a trip index for the curated routes ----
const FIXTURE_STOP =
  /^(Cultural Centre station, platform [12]|King George Square, [12]a|Mater Hill station, platform 1|UQ Lakes station)/
const FIXTURE_ROUTES = new Set(['M1', 'M2', '60'])
const fixtureStops = entries.filter(
  (e) => FIXTURE_STOP.test(e.name) && stopDays.has(stopIdx.get(e.key) as number),
)
// Also a couple of street stops from the design boards.
for (const e of entries) if (/^Adelaide Street Stop 37\b/.test(e.name)) fixtureStops.push(e)
const fixtureDays: Record<string, StaticStopDay> = {}
for (const e of fixtureStops) {
  const d = stopDays.get(stopIdx.get(e.key) as number)
  if (d) fixtureDays[e.key] = d
}
const tripIndex: TripIndexDay = {
  schemaVersion: SCHEMA_VERSION,
  mode: 'bus',
  serviceDate,
  generation,
  routes: [],
  stops: [],
  trips: [],
}
const tiRoutes = new Map<string, number>()
const tiStops = new Map<string, number>()
const touched = new Set<string>(fixtureStops.map((e) => e.key))
tripsRaw.forEach((t, ti) => {
  if (!active.has(t.service_id as string)) return
  const route = routeById.get(t.route_id as string) as Record<string, string>
  if (!FIXTURE_ROUTES.has(route.route_short_name as string)) return
  const st: number[] = []
  for (const r of byTrip[ti] as number[]) {
    const si = stStop[r] as number
    if (si < 0) continue
    const id = stopRow(si).stop_id as string
    touched.add(id)
    st.push(
      idx(tripIndex.stops, tiStops, id, () => id),
      stSeq[r] as number,
      stArr[r] as number,
      stDep[r] as number,
      stPick[r] as number,
      stDrop[r] as number,
    )
  }
  tripIndex.trips.push({
    id: t.trip_id as string,
    r: idx(tripIndex.routes, tiRoutes, t.route_id as string, () => routeRef(t.route_id as string)),
    d: dirOf(t),
    h: headsignOf(t),
    st,
  })
})
const fixtureIndex = entries.filter((e) => touched.has(e.key))
const fixtureRoutes = new Set<string>()
for (const d of Object.values(fixtureDays)) for (const r of d.routes) fixtureRoutes.add(r.short)
const fixtureLines = linesFile.lines
  .filter((l) => fixtureRoutes.has(l.short))
  // Keep the two busiest patterns per line so the fixture stays small.
  .map((l) => ({ ...l, patterns: l.patterns.slice(0, 2) }))
const fixture = {
  serviceDate,
  generation,
  stopDays: fixtureDays,
  tripIndex,
  stops: fixtureIndex,
  lines: fixtureLines,
}
const fixtureJson = JSON.stringify(fixture)
writeFileSync(join(here, '../fixtures/bus-day.json'), fixtureJson)
console.log(
  `fixture: ${Object.keys(fixtureDays).length} stop-days, ${tripIndex.trips.length} trips, ${fixtureIndex.length} stops, ${fixtureLines.length} lines, ${kb(fixtureJson.length)} raw, ${kb(gz(fixtureJson))} gz`,
)
