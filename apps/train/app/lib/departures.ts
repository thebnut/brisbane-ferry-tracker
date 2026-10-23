/** Map /v1 departures to train departure-card view models (T-Departures). */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  arrivalAfter,
  type BadgeKind,
  dayMarker,
  dropDeparted,
  formatClock,
  formatDuration,
  type LiveState,
  liveState,
  minutesBetween,
  minutesUntil,
  type PageCheck,
  type PatternStop,
  type RowStatus,
  type StatusLine,
  statusLine,
  timetableStatus,
} from '@bft/ui'
import { lineLabel } from './lineNames.ts'
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
    status: timetableStatus(d.status),
    estDep: null,
    estArrTo: null,
    gps: false,
  }
}

export interface TrainCard {
  key: string
  tripInstance: string
  /** Departure shown, epoch s. */
  dep: number
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
  minutes: number | null
  cancelled: boolean
  skipped: boolean
  /** The row's status line (THE-118 PR 4): "Live · 2 min late", "Live · platform changed from 5", "Cancelled · next…". */
  status: StatusLine & { status: RowStatus }
  /** Its one fact: "arr 7:31" with a destination, else the line ("Beenleigh line", "Ferny Grove express"). */
  fact: string | null
  /** The line, on a wide row whose extra column shows the arrival. */
  lineFact: string | null
  /** Accessible summary of the whole card. */
  label: string
}

export function trainCard(
  d: Departure,
  nowMs: number,
  from: string,
  to: string | null,
  /** A cancelled row: the next train on its line you can board. */
  next?: Departure,
): TrainCard {
  const live = d.status === 'live'
  const dep = effectiveDep(d)
  const rawArr = d.estArrTo ?? d.schedArrTo
  const arr = rawArr != null ? arrivalAfter(dep, rawArr) : null
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
  // From the clock minutes shown, so the journey always matches the two times on the card.
  const journeyMins = arr != null ? minutesBetween(dep, arr) : null
  const cancelled = d.status === 'cancelled'
  const skipped = d.status === 'skipped'
  const time = formatClock(dep)
  const scheduledPlatform = d.scheduledPlatform ?? null
  const status = {
    status: d.status,
    ...statusLine({
      status: d.status,
      schedDep: d.schedDep,
      estDep: d.estDep,
      platformFrom: live ? scheduledPlatform : null,
      next: next && { name: lineLabel(line.name), minutes: minutesUntil(effectiveDep(next), nowMs) },
    }),
  }
  const lineFact = skips > 0 ? `${line.name} express` : lineLabel(line.name)
  const arrText = arr != null ? `arr ${formatClock(arr)}` : null
  // A platform change is in the status words ("platform changed from 5").
  const platformText = d.platform ? `platform ${d.platform}` : 'platform not known'
  return {
    key: `${d.tripInstance}:${d.stopSequence}`,
    tripInstance: d.tripInstance,
    dep,
    time,
    dayMarker: dayMarker(dep, nowMs),
    arrival: arr != null ? { time: formatClock(arr), dayMarker: dayMarker(arr, nowMs) } : null,
    journey: journeyMins != null && journeyMins > 0 ? formatDuration(journeyMins) : null,
    badges,
    line,
    headsign,
    express: skips > 0,
    skips,
    strip,
    platform: d.platform,
    scheduledPlatform,
    minutes: cancelled || skipped ? null : minutesUntil(dep, nowMs),
    cancelled,
    skipped,
    status,
    // A row you can't board has no fact: "Cancelled · next Ferny Grove line in 12 min" already names the line.
    fact: cancelled || skipped ? null : to && arrText ? arrText : lineFact,
    lineFact: cancelled || skipped ? null : lineFact,
    label: [
      `${time}${skips > 0 ? ' express' : ''} to ${headsign}`,
      platformText,
      status.text.split(' · ').join(', ').toLowerCase(),
    ].join(', '),
  }
}

/**
 * The data state a board shows (shared rule, @bft/ui liveState): null = live; otherwise the banner, and the rows are
 * shown as timetable times. Offline, the API's rtState, or data that is too old to call live.
 */
export function boardState(
  res: DeparturesResponse | undefined,
  offline: boolean,
  nowMs: number,
  /** usePageCheck() (@bft/ui): cached-page cutoff and page arrival (R2-T7, R15-S1). */
  page: PageCheck | null = null,
): LiveState {
  return liveState(res, { offline, nowMs, ...page })
}

/**
 * Rows to show: live claims removed unless live, trains that have left dropped (@bft/ui dropDeparted), in the order
 * of the times shown (once estimates are dropped the API's order by estimate can be out of order, R2-B8).
 */
export function visibleRows(list: Departure[], state: LiveState, nowMs: number): Departure[] {
  const rows = state == null ? list : list.map(asScheduled)
  return dropDeparted(rows, effectiveDep, nowMs, state == null).sort(
    (a, b) => effectiveDep(a) - effectiveDep(b),
  )
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
