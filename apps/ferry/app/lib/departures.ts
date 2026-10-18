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
import { cleanStopName } from './names.ts'

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

export function cardModel(
  d: Departure,
  nowMs: number,
  destinationName: string,
): DepartureCardProps & { key: string } {
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
    label: `${express ? 'Express' : 'Ferry'} departing ${time} to ${cleanStopName(destinationName)}${
      arr != null ? `, arriving ${formatClock(arr)}` : ''
    }. ${d.status === 'live' ? 'Live' : d.status}. Show details`,
  }
}

/** Express services among the first 13 departures in either direction (legacy hasExpressServices). */
export function hasExpress(...lists: Array<Departure[] | undefined>): boolean {
  return lists.some((l) => (l ?? []).slice(0, 13).some(isExpress))
}

export type ServiceFilter = 'all' | 'express'

export const applyFilter = (list: Departure[], filter: ServiceFilter) =>
  filter === 'express' ? list.filter(isExpress) : list

/** The data state a board shows, for the status banner. */
export function boardState(res: DeparturesResponse | undefined, offline: boolean) {
  if (offline) return 'offline' as const
  if (!res) return null
  return res.rtState === 'live' ? null : res.rtState
}
