/** Map /v1 departures to departure-card view models with the legacy ferry rules. */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  arrivalAfter,
  type BadgeKind,
  type DepartureCardProps,
  dayMarker,
  delayText,
  dropDeparted,
  formatClock,
  formatDuration,
  type LiveState,
  liveState,
  minutesBetween,
  minutesUntil,
  statusNote,
  timetableStatus,
  vesselName,
} from '@bft/ui'

export const isExpress = (d: Departure) => d.route.short === 'F11'

export function serviceLabel(d: Departure): string {
  const code = d.route.short
  if (code === 'F11') return `EXPRESS · ${code}`
  if (/^F2\d$/.test(code)) return `CROSS-RIVER · ${code}`
  return `ALL STOPS · ${code}`
}

/** Effective departure (live estimate if any), epoch s. */
export const effectiveDep = (d: Departure) => d.estDep ?? d.schedDep

/** Offline or no live data: show the timetable only (no stale live claims). */
export function asScheduled(d: Departure): Departure {
  if (d.status === 'cancelled') return d
  return { ...d, status: timetableStatus(d.status), estDep: null, estArrTo: null, gps: false }
}

export function cardModel(d: Departure, nowMs: number): DepartureCardProps & { key: string } {
  const express = isExpress(d)
  const live = d.status === 'live'
  const dep = effectiveDep(d)
  const rawArr = d.estArrTo ?? d.schedArrTo
  const arr = rawArr != null ? arrivalAfter(dep, rawArr) : null
  const badges: BadgeKind[] = []
  if (d.status === 'live') badges.push('live')
  if (d.gps) badges.push('gps')
  if (d.status === 'scheduled') badges.push('scheduled')
  if (d.status === 'cancelled') badges.push('cancelled')
  if (d.status === 'skipped') badges.push('skipped')
  if (d.status === 'unknown') badges.push('unknown')

  // From the clock minutes shown, so "9:02 pm → 9:04 pm" always reads 2 mins.
  const journeyMins = arr != null ? minutesBetween(dep, arr) : null
  const vessel = d.gps || live ? vesselName(d.vehicleId) : null
  const parts: string[] = []
  if (d.status === 'cancelled') parts.push('This service is cancelled')
  else if (d.status === 'skipped') parts.push('Not stopping here')
  else {
    if (vessel) parts.push(vessel)
    const s = statusNote(live, d.schedDep, d.estDep)
    if (s) parts.push(s)
    else if (journeyMins != null && journeyMins > 0) parts.push(`Journey ${formatDuration(journeyMins)}`)
  }
  const time = formatClock(dep)
  return {
    key: `${d.tripInstance}:${d.stopSequence}`,
    time,
    dayMarker: dayMarker(dep, nowMs),
    arrival: arr != null ? { time: formatClock(arr), dayMarker: dayMarker(arr, nowMs) } : null,
    journey: journeyMins != null && journeyMins > 0 ? formatDuration(journeyMins) : null,
    badges,
    service: serviceLabel(d),
    express,
    highlighted: express && d.status !== 'cancelled',
    cancelled: d.status === 'cancelled',
    note: parts.join(' · ') || null,
    delay: live ? delayText(d.schedDep, d.estDep) : null,
    minutes: d.status === 'cancelled' || d.status === 'skipped' ? null : minutesUntil(dep, nowMs),
  }
}

/** Express services among the first 13 departures in either direction (legacy hasExpressServices). */
export function hasExpress(...lists: Array<Departure[] | undefined>): boolean {
  return lists.some((l) => (l ?? []).slice(0, 13).some(isExpress))
}

export type ServiceFilter = 'all' | 'express'

export const applyFilter = (list: Departure[], filter: ServiceFilter) =>
  filter === 'express' ? list.filter(isExpress) : list

export type BoardState = LiveState

/** What a board can honestly claim (shared rule, @bft/ui liveState): null = live, otherwise the banner to show. */
export function boardState(res: DeparturesResponse | undefined, offline: boolean, nowMs: number): BoardState {
  return liveState(res, { offline, nowMs })
}

/** Board rows for display: departed rows removed, live claims removed unless the state is live. */
export function visibleRows(list: Departure[], state: BoardState, nowMs: number): Departure[] {
  const rows = state == null ? list : list.map(asScheduled)
  return dropDeparted(rows, effectiveDep, nowMs, state == null).sort(
    (a, b) => effectiveDep(a) - effectiveDep(b) || a.schedDep - b.schedDep,
  )
}
