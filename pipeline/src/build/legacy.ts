/**
 * legacy/latest.json: a port of schedule-processor/process-schedule.js (the contract old iOS builds and the current
 * ferry app fetch). It reproduces that script's output byte for byte, quirks included, as it runs on GitHub's UTC
 * runners:
 *  - departures for every `F*` route trip on service dates D..D+2 (Brisbane), kept when the Brisbane wall-clock
 *    departure is within [D 00:00, D+2 00:00]; seconds are dropped; sorted stably by time, ties in trips.txt order
 *    then stop_times.txt file order then date order
 *  - `validFrom` is the Brisbane wall-clock time written with a `Z` suffix, `validTo` is D+2 00:00 likewise
 *  - calendar_dates removals delete one occurrence, as the script's `splice` does
 * test/legacy.test.ts runs the original script on the same feed and instant and diffs the output.
 */
import { addDays, brisbaneDate, brisbaneSecondsOfDay, dayOfWeek, serviceDayStartEpoch, TIMEZONE } from '@bft/core'
import type { Feed, StopRow, TripRow } from '../feed/load.ts'

const FERRY_STOP_NAMES = [
  'Apollo Road',
  'Bretts Wharf',
  'Bulimba',
  'Dockside',
  'Guyatt Park',
  'Hawthorne',
  'Holman Street',
  'Howard Smith Wharves',
  'Maritime Museum',
  'Milton',
  'Mowbray Park',
  'New Farm Park',
  'North Quay',
  'Northshore Hamilton',
  'QUT Gardens Point',
  'Regatta',
  'Riverside',
  'South Bank',
  'Sydney Street',
  'Teneriffe',
  'UQ St Lucia',
  'West End',
]

const DAY_FIELDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

interface LegacyDeparture {
  tripId: string
  routeId: string
  serviceId: string
  departureTime: string
  stopId: string
  direction: string
  headsign: string
  isScheduled: boolean
  stopSequence: number
}

/** The script's getActiveServiceIds, including its array semantics. */
function activeServicesLegacy(feed: Feed, dates: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const date of dates) {
    const field = DAY_FIELDS[dayOfWeek(date)] as (typeof DAY_FIELDS)[number]
    const active: string[] = []
    for (const s of feed.calendarRows) {
      if (s.start_date <= date && date <= s.end_date && s[field] === '1') active.push(s.service_id)
    }
    for (const e of feed.calendarDateRows) {
      if (e.date !== date) continue
      if (e.exception_type === '1') active.push(e.service_id)
      else if (e.exception_type === '2') {
        const i = active.indexOf(e.service_id)
        if (i > -1) active.splice(i, 1)
      }
    }
    out.set(date, [...new Set(active)])
  }
  return out
}

/** UTC-runner rendering of a Brisbane wall-clock instant: its wall-clock fields written as if they were UTC. */
function wallClockIso(epochMs: number): string {
  const date = brisbaneDate(epochMs)
  const secs = brisbaneSecondsOfDay(epochMs)
  const wall = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8))) + secs * 1000
  return new Date(wall + (epochMs % 1000)).toISOString()
}

function connectivity(feed: Feed) {
  const st = feed.stopTimes
  const ferryStopIds = new Set<string>()
  const ferryStops: Record<string, { name: string; lat: number; lng: number; validDestinations: string[] }> = {}
  const stopConnectivity: Record<string, Set<string>> = {}
  const tripPatterns = new Map<string, Set<string>>()

  for (const trip of feed.trips) {
    if (!trip.routeId.startsWith('F') || trip.count === 0) continue
    const stopSequence: string[] = []
    for (let r = trip.start; r < trip.start + trip.count; r++)
      stopSequence.push((feed.stops[st.stop[r] as number] as StopRow).id)
    for (const s of stopSequence) ferryStopIds.add(s)
    const patternKey = `${trip.routeId}-${trip.rawDirection || '0'}`
    let set = tripPatterns.get(patternKey)
    if (!set) {
      set = new Set()
      tripPatterns.set(patternKey, set)
    }
    set.add(JSON.stringify(stopSequence))
  }

  for (const patterns of tripPatterns.values()) {
    for (const json of patterns) {
      const seq = JSON.parse(json) as string[]
      seq.forEach((origin, i) => {
        if (!stopConnectivity[origin]) stopConnectivity[origin] = new Set()
        for (let k = i + 1; k < seq.length; k++) stopConnectivity[origin].add(seq[k] as string)
      })
    }
  }

  for (const stop of feed.stops) {
    if (!ferryStopIds.has(stop.id)) continue
    const lower = stop.name.toLowerCase()
    const isFerryStop = FERRY_STOP_NAMES.some((n) => lower.includes(n.toLowerCase())) && lower.includes('ferry')
    if (!isFerryStop) continue
    ferryStops[stop.id] = {
      name: stop.name,
      lat: stop.lat,
      lng: stop.lon,
      validDestinations: stopConnectivity[stop.id] ? Array.from(stopConnectivity[stop.id] as Set<string>).sort() : [],
    }
  }

  const ids = new Set(Object.keys(ferryStops))
  for (const id of Object.keys(ferryStops)) {
    const fs = ferryStops[id] as (typeof ferryStops)[string]
    fs.validDestinations = fs.validDestinations.filter((d) => ids.has(d))
  }
  const connectivityArray: Record<string, string[]> = {}
  for (const [id, dests] of Object.entries(stopConnectivity)) {
    if (ids.has(id))
      connectivityArray[id] = Array.from(dests)
        .filter((d) => ids.has(d))
        .sort()
  }
  return { ferryStops, stopConnectivity: connectivityArray }
}

/** Build the legacy document for the instant `nowMs`. Returns the JSON text exactly as the script writes it. */
export function buildLegacyLatest(feed: Feed, nowMs: number): string {
  const st = feed.stopTimes
  const today = brisbaneDate(nowMs)
  const dates = [today, addDays(today, 1), addDays(today, 2)]
  const active = activeServicesLegacy(feed, dates)
  const todayStart = serviceDayStartEpoch(today) * 1000
  const endDate = serviceDayStartEpoch(addDays(today, 2)) * 1000

  const relevant: TripRow[] = feed.trips.filter(
    (t) => [...active.values()].some((s) => s.includes(t.serviceId)) && t.routeId.startsWith('F'),
  )

  const departures: Array<LegacyDeparture & { t: number }> = []
  for (const trip of relevant) {
    const rows: number[] = []
    for (let r = trip.start; r < trip.start + trip.count; r++) rows[st.fileRank[r] as number] = r
    for (const r of rows) {
      // The script parses departure_time as written: a blank one yields an Invalid Date that no filter keeps.
      if (st.depBlank[r]) continue
      for (const [date, services] of active) {
        if (!services.includes(trip.serviceId)) continue
        const dep = st.dep[r] as number
        // Hours and minutes only, on the Brisbane calendar date (24:xx rolls to the next day once).
        const h = Math.floor(dep / 3600)
        const m = Math.floor((dep % 3600) / 60)
        const day = h >= 24 ? addDays(date, 1) : date
        const t = (serviceDayStartEpoch(day) + ((h >= 24 ? h - 24 : h) * 3600 + m * 60)) * 1000
        if (t >= todayStart && t <= endDate) {
          departures.push({
            t,
            tripId: trip.id,
            routeId: trip.routeId,
            serviceId: trip.serviceId,
            departureTime: new Date(t).toISOString(),
            stopId: (feed.stops[st.stop[r] as number] as StopRow).id,
            direction: 'outbound',
            headsign: trip.headsign,
            isScheduled: true,
            stopSequence: st.seq[r] as number,
          })
        }
      }
    }
  }
  departures.sort((a, b) => a.t - b.t)
  const { ferryStops, stopConnectivity } = connectivity(feed)

  const output = {
    generated: new Date(nowMs).toISOString(),
    timezone: TIMEZONE,
    validFrom: wallClockIso(nowMs),
    validTo: new Date(Date.parse(`${addDays(today, 2).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}T00:00:00.000Z`)).toISOString(),
    departureCount: departures.length,
    departures: departures.map(({ t: _t, ...d }) => d),
    ferryStops,
    stopConnectivity,
  }
  return JSON.stringify(output, null, 2)
}
