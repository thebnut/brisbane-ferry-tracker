/**
 * Load a GTFS directory into compact in-memory tables. Small files become objects; `stop_times.txt` is streamed into
 * typed arrays (about 20 bytes a row) for only the trips the build needs.
 */
import type { CalendarDateRow, CalendarRow, Mode } from '@bft/core'
import { ServiceCalendar } from '@bft/core'
import { CsvError, readCsvObjects, streamCsv } from './csv.ts'
import { feedFile } from './source.ts'

export class StructuralError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `structural feed errors:\n- ${problems.slice(0, 20).join('\n- ')}${problems.length > 20 ? `\n… ${problems.length - 20} more` : ''}`,
    )
  }
}

export interface RouteRow {
  id: string
  short: string
  long: string
  type: number
  color: string
  textColor: string
  mode: Mode | null
}

export interface StopRow {
  id: string
  code: string
  name: string
  lat: number
  lon: number
  locationType: number
  parent: string
  platformCode: string
}

export interface TripRow {
  id: string
  routeId: string
  serviceId: string
  headsign: string
  directionId: 0 | 1 | -1
  /** Raw CSV fields the legacy output reads verbatim. */
  rawDirection: string
  /** Row range in the stop-time arrays, sorted by stop_sequence. */
  start: number
  count: number
}

/** stop_times for the kept trips, grouped by trip and sorted by stop_sequence. */
export interface StopTimes {
  stop: Int32Array
  seq: Int32Array
  arr: Int32Array
  dep: Int32Array
  pickup: Uint8Array
  dropOff: Uint8Array
  /** Index of each row within its trip's rows in file order (the legacy output keeps file order). */
  fileRank: Int32Array
  /** 1 where departure_time was blank in the file (before interpolation); the legacy output skips those rows. */
  depBlank: Uint8Array
}

export interface Feed {
  dir: string
  feedInfo: { startDate: string; endDate: string; version: string } | null
  routes: Map<string, RouteRow>
  stops: StopRow[]
  stopIndex: Map<string, number>
  trips: TripRow[]
  stopTimes: StopTimes
  calendar: ServiceCalendar
  calendarRows: CalendarRow[]
  calendarDateRows: CalendarDateRow[]
  /** trips.txt row count, including trips that weren't kept. */
  tripRowsTotal: number
  stopTimeRowsTotal: number
}

export const ROUTE_TYPE_MODE: Record<number, Mode> = { 0: 'tram', 2: 'train', 3: 'bus', 4: 'ferry' }

export function modeOfRouteType(t: number): Mode | null {
  if (ROUTE_TYPE_MODE[t]) return ROUTE_TYPE_MODE[t] as Mode
  // Extended GTFS route types (100-1700): 100-199 rail, 700-799 bus, 900-999 tram, 1000-1200 water.
  if (t >= 100 && t < 200) return 'train'
  if (t >= 700 && t < 800) return 'bus'
  if (t >= 900 && t < 1000) return 'tram'
  if (t >= 1000 && t < 1300) return 'ferry'
  return null
}

const REQUIRED = ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'feed_info.txt']

/** Parse "HH:MM:SS" (HH may exceed 23) without allocating. -1 for empty, -2 for malformed. */
export function parseTime(s: string): number {
  const m = TIME_RE.exec(s)
  if (!m) return s.trim() === '' ? -1 : -2
  const min = Number(m[2])
  const sec = Number(m[3])
  if (min > 59 || sec > 59) return -2
  return Number(m[1]) * 3600 + min * 60 + sec
}

/** H:MM:SS with H of 1-3 digits, nothing else but surrounding spaces (Codex PR41 #4: no trailing garbage). */
const TIME_RE = /^ *(\d{1,3}):(\d{2}):(\d{2}) *$/

/** pickup_type / drop_off_type: empty means 0; anything outside 0-3 is structural corruption. */
export function parseBoardingRule(s: string | undefined): number {
  const v = (s ?? '').trim()
  if (v === '') return 0
  return v === '0' || v === '1' || v === '2' || v === '3' ? Number(v) : -1
}

export interface LoadOptions {
  /**
   * Keep stop_times only for trips whose service runs on one of these dates, plus every `F*` route trip (the legacy
   * latest.json connectivity reads all ferry trips). Default: every trip.
   */
  windowDates?: string[]
}

class Grow {
  stop = new Int32Array(1 << 16)
  seq = new Int32Array(1 << 16)
  arr = new Int32Array(1 << 16)
  dep = new Int32Array(1 << 16)
  pickup = new Uint8Array(1 << 16)
  dropOff = new Uint8Array(1 << 16)
  trip = new Int32Array(1 << 16)
  n = 0
  ensure(): void {
    if (this.n < this.stop.length) return
    const cap = this.stop.length * 2
    const g = <T extends Int32Array | Uint8Array>(a: T): T => {
      const b = new (a.constructor as new (n: number) => T)(cap)
      b.set(a)
      return b
    }
    this.stop = g(this.stop)
    this.seq = g(this.seq)
    this.arr = g(this.arr)
    this.dep = g(this.dep)
    this.pickup = g(this.pickup)
    this.dropOff = g(this.dropOff)
    this.trip = g(this.trip)
  }
}

export async function loadFeed(dir: string, opts: LoadOptions = {}): Promise<Feed> {
  const problems: string[] = []
  for (const f of REQUIRED) if (!feedFile(dir, f)) problems.push(`missing ${f}`)
  if (!feedFile(dir, 'calendar.txt') && !feedFile(dir, 'calendar_dates.txt'))
    problems.push('missing both calendar.txt and calendar_dates.txt')
  if (problems.length) throw new StructuralError(problems)

  const read = async (name: string) => {
    const p = feedFile(dir, name)
    if (!p) return []
    try {
      return await readCsvObjects(p)
    } catch (e) {
      if (e instanceof CsvError) throw new StructuralError([`${name}: unparseable (${e.message})`])
      throw e
    }
  }

  const need = (rows: Record<string, string>[], name: string, cols: string[]) => {
    if (rows.length === 0) {
      problems.push(`${name}: no rows`)
      return
    }
    const first = rows[0] as Record<string, string>
    for (const c of cols) if (!(c in first)) problems.push(`${name}: missing column ${c}`)
  }

  const [agency, routeRows, stopRows, calRows, calDateRows, feedInfoRows] = await Promise.all([
    read('agency.txt'),
    read('routes.txt'),
    read('stops.txt'),
    read('calendar.txt'),
    read('calendar_dates.txt'),
    read('feed_info.txt'),
  ])
  need(agency, 'agency.txt', ['agency_name'])
  need(routeRows, 'routes.txt', ['route_id', 'route_type'])
  need(stopRows, 'stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon'])
  need(feedInfoRows, 'feed_info.txt', ['feed_start_date', 'feed_end_date'])
  if (calRows.length) need(calRows, 'calendar.txt', ['service_id', 'monday', 'start_date', 'end_date'])
  if (problems.length) throw new StructuralError(problems)

  const routes = new Map<string, RouteRow>()
  for (const r of routeRows) {
    const type = Number(r.route_type)
    if (!Number.isInteger(type))
      problems.push(`routes.txt: route ${r.route_id} has bad route_type "${r.route_type}"`)
    routes.set(r.route_id as string, {
      id: r.route_id as string,
      short: r.route_short_name ?? '',
      long: r.route_long_name ?? '',
      type,
      color: (r.route_color ?? '').trim(),
      textColor: (r.route_text_color ?? '').trim(),
      mode: modeOfRouteType(type),
    })
  }

  const stops: StopRow[] = []
  const stopIndex = new Map<string, number>()
  for (const s of stopRows) {
    const lat = Number.parseFloat(s.stop_lat ?? '')
    const lon = Number.parseFloat(s.stop_lon ?? '')
    const locationType = Number(s.location_type || 0)
    if (locationType <= 1 && (!Number.isFinite(lat) || !Number.isFinite(lon)))
      problems.push(`stops.txt: stop ${s.stop_id} has no coordinates`)
    stopIndex.set(s.stop_id as string, stops.length)
    stops.push({
      id: s.stop_id as string,
      code: s.stop_code ?? '',
      name: s.stop_name ?? '',
      lat,
      lon,
      locationType,
      parent: s.parent_station ?? '',
      platformCode: s.platform_code ?? '',
    })
  }
  for (const s of stops)
    if (s.parent && !stopIndex.has(s.parent))
      problems.push(`stops.txt: stop ${s.id} parent_station ${s.parent} not found`)

  const calendarRows = calRows as unknown as CalendarRow[]
  const calendarDateRows = calDateRows as unknown as CalendarDateRow[]
  const services = new Set<string>([
    ...calendarRows.map((r) => r.service_id),
    ...calendarDateRows.map((r) => r.service_id),
  ])

  const fi = feedInfoRows[0]
  const feedInfo = fi
    ? { startDate: fi.feed_start_date ?? '', endDate: fi.feed_end_date ?? '', version: fi.feed_version ?? '' }
    : null
  if (feedInfo && !/^\d{8}$/.test(feedInfo.endDate))
    problems.push(`feed_info.txt: bad feed_end_date "${feedInfo.endDate}"`)

  // trips.txt can be large (137k rows); stream it.
  const trips: TripRow[] = []
  const tripIndex = new Map<string, number>()
  const allTripIds = new Set<string>()
  let tripRowsTotal = 0
  const calendar = new ServiceCalendar(calendarRows, calendarDateRows)
  const windowServices = opts.windowDates
    ? new Set(opts.windowDates.flatMap((d) => [...calendar.activeServices(d)]))
    : null
  // Services that calendar_dates removes inside the window are kept too: the quarantine validator uses their trips
  // to tell a planned closure from an unexplained loss of service.
  if (windowServices && opts.windowDates) {
    const inWindow = new Set(opts.windowDates)
    for (const r of calendarDateRows)
      if (r.exception_type === '2' && inWindow.has(r.date)) windowServices.add(r.service_id)
  }
  const keep = (t: { routeId: string; serviceId: string }) =>
    !windowServices || windowServices.has(t.serviceId) || t.routeId.startsWith('F')
  {
    let c = { route: -1, service: -1, trip: -1, headsign: -1, dir: -1 }
    try {
      tripRowsTotal = await streamCsv(
        feedFile(dir, 'trips.txt') as string,
        (h) => {
          c = {
            route: h.col('route_id'),
            service: h.col('service_id'),
            trip: h.col('trip_id'),
            headsign: h.col('trip_headsign'),
            dir: h.col('direction_id'),
          }
          for (const [k, v] of Object.entries(c))
            if (v < 0 && k !== 'headsign' && k !== 'dir') problems.push(`trips.txt: missing column ${k}`)
        },
        (f, line) => {
          const id = f[c.trip] as string
          const routeId = f[c.route] as string
          const serviceId = f[c.service] as string
          allTripIds.add(id)
          if (!routes.has(routeId))
            problems.push(`trips.txt:${line}: trip ${id} route_id ${routeId} not found`)
          if (!services.has(serviceId))
            problems.push(`trips.txt:${line}: trip ${id} service_id ${serviceId} not found`)
          if (!keep({ routeId, serviceId })) return
          const rawDirection = c.dir >= 0 ? (f[c.dir] as string) : ''
          tripIndex.set(id, trips.length)
          trips.push({
            id,
            routeId,
            serviceId,
            headsign: c.headsign >= 0 ? (f[c.headsign] as string) : '',
            directionId: rawDirection === '0' ? 0 : rawDirection === '1' ? 1 : -1,
            rawDirection,
            start: 0,
            count: 0,
          })
        },
      )
    } catch (e) {
      if (e instanceof CsvError) throw new StructuralError([`trips.txt: unparseable (${e.message})`])
      throw e
    }
  }
  if (problems.length) throw new StructuralError(problems)

  const g = new Grow()
  let stopTimeRowsTotal = 0
  {
    let c = { trip: -1, arr: -1, dep: -1, stop: -1, seq: -1, pickup: -1, drop: -1 }
    const tripsWithTimes = new Set<number>()
    try {
      stopTimeRowsTotal = await streamCsv(
        feedFile(dir, 'stop_times.txt') as string,
        (h) => {
          c = {
            trip: h.col('trip_id'),
            arr: h.col('arrival_time'),
            dep: h.col('departure_time'),
            stop: h.col('stop_id'),
            seq: h.col('stop_sequence'),
            pickup: h.col('pickup_type'),
            drop: h.col('drop_off_type'),
          }
          for (const k of ['trip', 'arr', 'dep', 'stop', 'seq'] as const)
            if (c[k] < 0) problems.push(`stop_times.txt: missing column ${k}`)
        },
        (f, line) => {
          if (problems.length > 200) return
          const tripId = f[c.trip] as string
          const ti = tripIndex.get(tripId)
          if (ti === undefined) {
            if (!allTripIds.has(tripId)) problems.push(`stop_times.txt:${line}: trip_id ${tripId} not found`)
            return
          }
          const si = stopIndex.get(f[c.stop] as string)
          if (si === undefined) {
            problems.push(`stop_times.txt:${line}: stop_id ${f[c.stop]} not found`)
            return
          }
          const seq = Number(f[c.seq])
          const arr = parseTime(f[c.arr] as string)
          const dep = parseTime(f[c.dep] as string)
          const pickup = c.pickup >= 0 ? parseBoardingRule(f[c.pickup]) : 0
          const dropOff = c.drop >= 0 ? parseBoardingRule(f[c.drop]) : 0
          if (!Number.isInteger(seq) || arr === -2 || dep === -2) {
            problems.push(`stop_times.txt:${line}: unparseable row`)
            return
          }
          if (pickup < 0 || dropOff < 0) {
            problems.push(`stop_times.txt:${line}: pickup_type/drop_off_type outside 0-3`)
            return
          }
          g.ensure()
          const n = g.n++
          g.trip[n] = ti
          g.stop[n] = si
          g.seq[n] = seq
          g.arr[n] = arr
          g.dep[n] = dep
          g.pickup[n] = pickup
          g.dropOff[n] = dropOff
          tripsWithTimes.add(ti)
        },
      )
    } catch (e) {
      if (e instanceof CsvError) throw new StructuralError([`stop_times.txt: unparseable (${e.message})`])
      throw e
    }
    if (problems.length) throw new StructuralError(problems)
  }

  const stopTimes = groupByTrip(g, trips, problems)
  if (problems.length) throw new StructuralError(problems)

  return {
    dir,
    feedInfo,
    routes,
    stops,
    stopIndex,
    trips,
    stopTimes,
    calendar,
    calendarRows,
    calendarDateRows,
    tripRowsTotal,
    stopTimeRowsTotal,
  }
}

/** Stable counting sort by trip (keeps file order), then sort each trip's rows by stop_sequence. */
function groupByTrip(g: Grow, trips: TripRow[], problems: string[]): StopTimes {
  const n = g.n
  const counts = new Int32Array(trips.length + 1)
  for (let i = 0; i < n; i++)
    counts[(g.trip[i] as number) + 1] = (counts[(g.trip[i] as number) + 1] as number) + 1
  for (let t = 0; t < trips.length; t++) {
    const trip = trips[t] as TripRow
    trip.count = counts[t + 1] as number
    counts[t + 1] = (counts[t + 1] as number) + (counts[t] as number)
    trip.start = counts[t] as number
  }
  const order = new Int32Array(n)
  const cursor = counts.slice(0, trips.length)
  for (let i = 0; i < n; i++) {
    const t = g.trip[i] as number
    order[(cursor[t] as number)++] = i
  }
  const out: StopTimes = {
    stop: new Int32Array(n),
    seq: new Int32Array(n),
    arr: new Int32Array(n),
    dep: new Int32Array(n),
    pickup: new Uint8Array(n),
    dropOff: new Uint8Array(n),
    fileRank: new Int32Array(n),
    depBlank: new Uint8Array(n),
  }
  for (const trip of trips) {
    const rows = Array.from(order.subarray(trip.start, trip.start + trip.count))
    const rank = new Map(rows.map((r, i) => [r, i]))
    rows.sort((a, b) => (g.seq[a] as number) - (g.seq[b] as number))
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k] as number
      const o = trip.start + k
      out.stop[o] = g.stop[r] as number
      out.seq[o] = g.seq[r] as number
      out.arr[o] = g.arr[r] as number
      out.dep[o] = g.dep[r] as number
      out.pickup[o] = g.pickup[r] as number
      out.dropOff[o] = g.dropOff[r] as number
      out.fileRank[o] = rank.get(r) as number
      out.depBlank[o] = (g.dep[r] as number) < 0 ? 1 : 0
      if (k > 0 && out.seq[o] === out.seq[o - 1])
        problems.push(`stop_times.txt: trip ${trip.id} repeats stop_sequence ${out.seq[o]}`)
    }
    fillTimes(out, trip, problems)
  }
  return out
}

/**
 * GTFS lets non-timepoint rows leave times blank. Copy arr↔dep when one is missing and interpolate between
 * timepoints by row position. A trip with no time at its first or last stop is structurally broken.
 */
function fillTimes(st: StopTimes, trip: TripRow, problems: string[]): void {
  const s = trip.start
  const e = s + trip.count
  for (let i = s; i < e; i++) {
    if ((st.arr[i] as number) < 0 && (st.dep[i] as number) >= 0) st.arr[i] = st.dep[i] as number
    if ((st.dep[i] as number) < 0 && (st.arr[i] as number) >= 0) st.dep[i] = st.arr[i] as number
  }
  if (trip.count === 0) return
  if ((st.dep[s] as number) < 0 || (st.arr[e - 1] as number) < 0) {
    problems.push(`stop_times.txt: trip ${trip.id} has no time at its first or last stop`)
    return
  }
  let prev = s
  for (let i = s + 1; i < e; i++) {
    if ((st.dep[i] as number) < 0) continue
    if (i - prev > 1) {
      const t0 = st.dep[prev] as number
      const t1 = st.arr[i] as number
      for (let k = prev + 1; k < i; k++) {
        const t = Math.round(t0 + ((t1 - t0) * (k - prev)) / (i - prev))
        st.arr[k] = t
        st.dep[k] = t
      }
    }
    prev = i
  }
}
