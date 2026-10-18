/** Map /v1 departures to train departure-card view models (T-Departures). */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  type BadgeKind,
  dayMarker,
  delayText,
  formatClock,
  formatDuration,
  minutesUntil,
  type PatternStop,
  statusNote,
} from '@bft/ui'
import { cleanStopName } from './names.ts'
import { type DisplayLine, lineFor, stationKeyOfStop, stripFor } from './network.ts'

/** Effective departure (live estimate if any), epoch s. */
export const effectiveDep = (d: Departure) => d.estDep ?? d.schedDep

/** Offline or no live data: show the timetable only (no stale live claims, no platform changes). */
export function asScheduled(d: Departure): Departure {
  if (d.status === 'cancelled') return d
  const { scheduledPlatform, ...rest } = d
  return {
    ...rest,
    platform: scheduledPlatform ?? d.platform,
    status: 'scheduled',
    estDep: null,
    estArrTo: null,
    gps: false,
  }
}

/** "3:04" when the arrival has the same am/pm as the departure ("2:52 pm → 3:04"), as in T-Departures. */
export function shortArrival(dep: string, arr: string): string {
  const suffix = / (am|pm)$/.exec(dep)?.[0]
  return suffix && arr.endsWith(suffix) ? arr.slice(0, -suffix.length) : arr
}

export interface TrainCard {
  key: string
  tripInstance: string
  time: string
  dayMarker: string | null
  arrival: { time: string; dayMarker: string | null } | null
  journey: string | null
  badges: BadgeKind[]
  line: DisplayLine
  headsign: string
  express: boolean
  skips: number
  strip: PatternStop[]
  platform: string | null
  scheduledPlatform: string | null
  note: string | null
  delay: string | null
  minutes: number | null
  cancelled: boolean
  skipped: boolean
  /** Accessible summary of the whole card. */
  label: string
}

export function trainCard(d: Departure, nowMs: number, from: string, to: string | null): TrainCard {
  const live = d.status === 'live'
  const dep = effectiveDep(d)
  const arr = d.estArrTo ?? d.schedArrTo
  const line = lineFor(d.route, d.headsign)
  const headsign = cleanStopName(d.headsign)
  const stopsAfter = d.stopsAfter
    ? d.stopsAfter.map((id) => stationKeyOfStop(id)).filter((k): k is string => !!k)
    : null
  const strip = stripFor({ from, stopsAfter, route: d.route.short, headsign, to })
  const skips = strip.filter((s) => !s.stops).length
  const badges: BadgeKind[] = []
  if (live) badges.push('live')
  if (d.gps) badges.push('gps')
  if (d.status === 'scheduled') badges.push('scheduled')
  if (d.status === 'cancelled') badges.push('cancelled')
  if (d.status === 'skipped') badges.push('skipped')
  if (d.status === 'unknown') badges.push('unknown')
  const journeyMins = arr != null ? Math.round((arr - dep) / 60) : null
  const cancelled = d.status === 'cancelled'
  const skipped = d.status === 'skipped'
  const time = formatClock(dep)
  const scheduledPlatform = d.scheduledPlatform ?? null
  const note = cancelled
    ? 'This service is cancelled'
    : skipped
      ? 'Not stopping here'
      : (statusNote(live, d.schedDep, d.estDep) ?? null)
  const platformText = d.platform
    ? scheduledPlatform
      ? `platform ${d.platform}, changed from ${scheduledPlatform}`
      : `platform ${d.platform}`
    : 'platform not known'
  return {
    key: `${d.tripInstance}:${d.stopSequence}`,
    tripInstance: d.tripInstance,
    time,
    dayMarker: dayMarker(dep, nowMs),
    arrival:
      arr != null ? { time: shortArrival(time, formatClock(arr)), dayMarker: dayMarker(arr, nowMs) } : null,
    journey: journeyMins != null && journeyMins > 0 ? formatDuration(journeyMins) : null,
    badges,
    line,
    headsign,
    express: skips > 0,
    skips,
    strip,
    platform: d.platform,
    scheduledPlatform,
    note,
    delay: live ? delayText(d.schedDep, d.estDep) : null,
    minutes: cancelled || skipped ? null : minutesUntil(dep, nowMs),
    cancelled,
    skipped,
    label: [
      `${time}${skips > 0 ? ' express' : ''} to ${headsign}`,
      platformText,
      cancelled ? 'cancelled' : skipped ? 'not stopping here' : live ? 'live' : 'scheduled',
    ].join(', '),
  }
}

/** The data state a board shows, for the status banner. */
export function boardState(res: DeparturesResponse | undefined, offline: boolean) {
  if (offline) return 'offline' as const
  if (!res) return null
  return res.rtState === 'live' ? null : res.rtState
}

/** Live platform changes in a list (for the "Platform change" banner). */
export const platformChanges = (list: Departure[]) =>
  list.filter((d) => d.scheduledPlatform && d.status === 'live')

/** Rows from an offline day that are still to come, as scheduled. */
export function offlineRows(departures: Departure[], nowS: number, limit: number): Departure[] {
  return departures
    .filter((d) => d.schedDep >= nowS - 30)
    .slice(0, limit)
    .map(asScheduled)
}

export type ServiceFilter = 'all' | 'express'
