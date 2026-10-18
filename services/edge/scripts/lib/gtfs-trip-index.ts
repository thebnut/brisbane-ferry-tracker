/**
 * Minimal TripIndexDay builder straight from an unzipped GTFS directory, for the Phase 0 spike and local fixtures
 * until the pipeline (bft-pipeline) publishes real trees. Not the production builder: that's `pipeline/`.
 */
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  type CalendarDateRow,
  type CalendarRow,
  gtfsTimeToSeconds,
  type Mode,
  type RouteRef,
  ServiceCalendar,
  type TripIndexDay,
} from '@bft/core'

const ROUTE_TYPE_MODE: Record<string, Mode> = { '0': 'tram', '2': 'train', '3': 'bus', '4': 'ferry' }

function splitCsv(line: string): string[] {
  if (!line.includes('"')) return line.split(',')
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
  return out
}

async function readTable(path: string): Promise<Record<string, string>[]> {
  const text = (await readFile(path, 'utf8')).replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).filter(Boolean)
  const head = splitCsv(lines[0] as string)
  return lines.slice(1).map((l) => {
    const v = splitCsv(l)
    return Object.fromEntries(head.map((h, i) => [h, v[i] ?? '']))
  })
}

/** TripIndexDay per mode for each service date. Streams stop_times.txt once. */
export async function buildTripIndexes(
  dir: string,
  serviceDates: string[],
  generation = 'spike',
): Promise<Map<string, TripIndexDay>> {
  const [routes, trips, calendar, calendarDates] = await Promise.all([
    readTable(join(dir, 'routes.txt')),
    readTable(join(dir, 'trips.txt')),
    readTable(join(dir, 'calendar.txt')),
    readTable(join(dir, 'calendar_dates.txt')).catch(() => []),
  ])
  const cal = new ServiceCalendar(
    calendar as unknown as CalendarRow[],
    calendarDates as unknown as CalendarDateRow[],
  )
  const routeById = new Map(routes.map((r) => [r.route_id as string, r]))
  const active = new Map(serviceDates.map((d) => [d, cal.activeServices(d)]))

  // tripId -> { mode, dates it runs, meta }
  const tripInfo = new Map<string, { mode: Mode; dates: string[]; route: string; d: number; h: string }>()
  for (const t of trips) {
    const r = routeById.get(t.route_id as string)
    const mode = r ? ROUTE_TYPE_MODE[r.route_type as string] : undefined
    if (!mode) continue
    const dates = serviceDates.filter((d) => active.get(d)?.has(t.service_id as string))
    if (dates.length === 0) continue
    const dir = t.direction_id === '0' ? 0 : t.direction_id === '1' ? 1 : -1
    tripInfo.set(t.trip_id as string, {
      mode,
      dates,
      route: t.route_id as string,
      d: dir,
      h: t.trip_headsign ?? '',
    })
  }

  const stopRows = new Map<string, number[][]>()
  const rl = createInterface({
    input: createReadStream(join(dir, 'stop_times.txt')),
    crlfDelay: Number.POSITIVE_INFINITY,
  })
  let head: string[] | null = null
  let ix: Record<string, number> = {}
  for await (const raw of rl) {
    const line = raw.replace(/^﻿/, '')
    if (!head) {
      head = splitCsv(line)
      ix = Object.fromEntries(head.map((h, i) => [h, i]))
      continue
    }
    const v = splitCsv(line)
    const tripId = v[ix.trip_id as number] as string
    if (!tripInfo.has(tripId)) continue
    const arr =
      gtfsTimeToSeconds(v[ix.arrival_time as number]) ?? gtfsTimeToSeconds(v[ix.departure_time as number])
    const dep = gtfsTimeToSeconds(v[ix.departure_time as number]) ?? arr
    if (arr == null || dep == null) continue
    let l = stopRows.get(tripId)
    if (!l) {
      l = []
      stopRows.set(tripId, l)
    }
    l.push([
      Number(v[ix.stop_sequence as number]),
      arr,
      dep,
      Number(v[ix.pickup_type as number] || 0),
      Number(v[ix.drop_off_type as number] || 0),
      // stop id kept as a string via a side table below
    ])
    ;(l[l.length - 1] as unknown as { s: string }).s = v[ix.stop_id as number] as string
  }

  const out = new Map<string, TripIndexDay>()
  const ensure = (mode: Mode, date: string) => {
    const k = `${mode}|${date}`
    let day = out.get(k)
    if (!day) {
      day = { schemaVersion: 1, mode, serviceDate: date, generation, routes: [], stops: [], trips: [] }
      out.set(k, day)
      routeIx.set(k, new Map())
      stopIx.set(k, new Map())
    }
    return { day, k }
  }
  const routeIx = new Map<string, Map<string, number>>()
  const stopIx = new Map<string, Map<string, number>>()
  for (const [tripId, info] of tripInfo) {
    const rows = stopRows.get(tripId)
    if (!rows || rows.length === 0) continue
    rows.sort((a, b) => (a[0] as number) - (b[0] as number))
    for (const date of info.dates) {
      const { day, k } = ensure(info.mode, date)
      const ri = routeIx.get(k) as Map<string, number>
      const si = stopIx.get(k) as Map<string, number>
      let r = ri.get(info.route)
      if (r == null) {
        const src = routeById.get(info.route)
        const ref: RouteRef = {
          id: info.route,
          short: src?.route_short_name || info.route.split('-')[0] || info.route,
        }
        if (src?.route_long_name) ref.long = src.route_long_name
        if (/^[0-9A-Fa-f]{6}$/.test(src?.route_color ?? '')) ref.color = src?.route_color
        r = day.routes.push(ref) - 1
        ri.set(info.route, r)
      }
      const st: number[] = []
      for (const row of rows) {
        const sid = (row as unknown as { s: string }).s
        let s = si.get(sid)
        if (s == null) {
          s = day.stops.push(sid) - 1
          si.set(sid, s)
        }
        st.push(s, row[0] as number, row[1] as number, row[2] as number, row[3] as number, row[4] as number)
      }
      day.trips.push({ id: tripId, r, d: info.d as 0 | 1 | -1, h: info.h, st })
    }
  }
  return out
}
