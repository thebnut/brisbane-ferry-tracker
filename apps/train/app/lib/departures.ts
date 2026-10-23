/** Map /v1 departures to train departure-card view models (T-Departures). */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  arrivalAfter,
  type BadgeKind,
  dayMarker,
  dropDeparted,
  formatClock,
  formatDuration,
  isExtraService,
  type LiveState,
  liveState,
  minutesBetween,
  minutesUntil,
  nextAlike,
  type PageCheck,
  type PatternStop,
  type RowStatus,
  type StatusLine,
  statusLine,
  timetableStatus,
} from '@bft/ui'
import { lineLabel } from './lineNames.ts'
import { cleanStopName } from './names.ts'
import { callsAfter, type DisplayLine, lineFor, stationKeyOfStop, stripFor } from './network.ts'

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

/** The station keys of a departure's `stopsAfter`, or null when the API didn't send them. */
const stationsAfter = (d: Departure) =>
  d.stopsAfter ? d.stopsAfter.map((id) => stationKeyOfStop(id)).filter((k): k is string => !!k) : null

/**
 * A cancelled row's "next": the first later row you can board on the same line that heads the same way. It must call,
 * after `from`, at the cancelled train's next stop or its destination (or at `to`, where every train on the board
 * goes), so a train the other way on the same line is never suggested. None when no train on the board qualifies.
 */
export function nextInstead(
  rows: readonly Departure[],
  i: number,
  from: string,
  to: string | null,
): Departure | undefined {
  const d = rows[i]
  if (!d) return undefined
  const calls = (r: Departure) =>
    callsAfter({
      from,
      stopsAfter: stationsAfter(r),
      route: r.route.short,
      headsign: cleanStopName(r.headsign),
    })
  const own = calls(d)
  const targets = [own[0], own[own.length - 1], to].filter((k): k is string => !!k)
  if (targets.length === 0) return undefined
  const line = lineFor(d.route, d.headsign).name
  return nextAlike(
    rows,
    i,
    (r) => lineFor(r.route, r.headsign).name === line && calls(r).some((k) => targets.includes(k)),
  )
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
  const strip = stripFor({ from, stopsAfter: stationsAfter(d), route: d.route.short, headsign, to })
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
      extra: isExtraService(d.tripInstance),
      platformFrom: live ? scheduledPlatform : null,
      next: next && { name: lineLabel(line.name), minutes: minutesUntil(effectiveDep(next), nowMs) },
    }),
  }
  const lineFact = skips > 0 ? `${line.name} express` : lineLabel(line.name)
  const arrText = arr != null ? `arr ${formatClock(arr)}` : null
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
