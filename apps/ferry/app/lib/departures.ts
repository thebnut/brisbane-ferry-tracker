/** Map /v1 departures to departure-card view models with the legacy ferry rules. */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  type BadgeKind,
  type DepartureCardProps,
  dayMarker,
  delayText,
  formatClock,
  formatDuration,
  minutesUntil,
  statusNote,
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
  return { ...d, status: 'scheduled', estDep: null, estArrTo: null, gps: false }
}

export function cardModel(d: Departure, nowMs: number): DepartureCardProps & { key: string } {
  const express = isExpress(d)
  const live = d.status === 'live'
  const dep = effectiveDep(d)
  const arr = d.estArrTo ?? d.schedArrTo
  const badges: BadgeKind[] = []
  if (d.status === 'live') badges.push('live')
  if (d.gps) badges.push('gps')
  if (d.status === 'scheduled') badges.push('scheduled')
  if (d.status === 'cancelled') badges.push('cancelled')
  if (d.status === 'skipped') badges.push('skipped')
  if (d.status === 'unknown') badges.push('unknown')

  const journeyMins = arr != null ? Math.round((arr - dep) / 60) : null
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

/** Live data older than this (or a refresh that has failed for this long) is shown as timetable times. */
export const LIVE_MAX_AGE_S = 300
export const REFRESH_MAX_AGE_MS = 60_000
/** Rows that left more than a minute ago are dropped (cached data must not keep them as "Departing"). */
export const DEPARTED_GRACE_S = 60

export type BoardState = 'offline' | 'stale' | 'reloading' | 'unavailable' | null

/**
 * What a board can honestly claim. Live only while the response says live, its TransLink source is under 5 min old
 * and the last successful refresh is under a minute old; otherwise the rows fall back to timetable times.
 */
export function boardState(
  res: DeparturesResponse | undefined,
  offline: boolean,
  nowMs: number,
  updatedAtMs: number,
): BoardState {
  if (offline) return 'offline'
  if (!res) return null
  if (res.rtState !== 'live') return res.rtState
  const sourceAge = res.rtSourceTimestamp == null ? Infinity : nowMs / 1000 - res.rtSourceTimestamp
  if (sourceAge > LIVE_MAX_AGE_S || nowMs - updatedAtMs > REFRESH_MAX_AGE_MS) return 'stale'
  return null
}

/** Board rows for display: departed rows removed, live claims removed unless the state is live. */
export function visibleRows(list: Departure[], state: BoardState, nowMs: number): Departure[] {
  const rows = state == null ? list : list.map(asScheduled)
  return rows.filter((d) => effectiveDep(d) >= nowMs / 1000 - DEPARTED_GRACE_S)
}
