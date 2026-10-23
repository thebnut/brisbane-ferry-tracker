/** Map /v1 departures to departure-row view models with the legacy ferry rules. */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import {
  arrivalAfter,
  dropDeparted,
  formatClock,
  formatDuration,
  type LiveState,
  liveState,
  minutesBetween,
  minutesUntil,
  type PageCheck,
  type RowStatus,
  type StatusLine,
  statusLine,
  timetableStatus,
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
  return { ...d, status: timetableStatus(d.status), estDep: null, estArrTo: null, gps: false }
}

export interface RowModel {
  key: string
  /** Departure shown, epoch s. */
  dep: number
  code: string
  express: boolean
  destination: string
  status: StatusLine & { status: RowStatus }
  /** "arr 7:31" on a phone row; a wide row shows the arrival in its extra column instead. */
  fact: string | null
  arrival: string | null
  journey: string | null
  minutes: number | null
  time: string
  label: string
}

/**
 * One row (THE-118 PR 4): the service tile, the headsign, "Live · 2 min late · arr 7:31", the countdown. The vessel,
 * the journey line and the per-time date tag are in the details sheet and the Tomorrow divider now.
 */
export function rowModel(d: Departure, nowMs: number, next?: Departure): RowModel {
  const dep = effectiveDep(d)
  const rawArr = d.estArrTo ?? d.schedArrTo
  const arr = rawArr != null ? arrivalAfter(dep, rawArr) : null
  // From the clock minutes shown, so "9:02 pm → 9:04 pm" always reads 2 mins.
  const journeyMins = arr != null ? minutesBetween(dep, arr) : null
  const boardable = d.status !== 'cancelled' && d.status !== 'skipped'
  const status = {
    status: d.status,
    ...statusLine({
      status: d.status,
      schedDep: d.schedDep,
      estDep: d.estDep,
      next: next && { name: d.route.short, minutes: minutesUntil(effectiveDep(next), nowMs) },
    }),
  }
  const time = formatClock(dep)
  const arrival = arr != null && boardable ? formatClock(arr) : null
  const destination = cleanStopName(d.headsign)
  return {
    key: `${d.tripInstance}:${d.stopSequence}`,
    dep,
    code: d.route.short,
    express: isExpress(d),
    destination,
    status,
    fact: arrival ? `arr ${arrival}` : null,
    arrival,
    journey: journeyMins != null && journeyMins > 0 ? formatDuration(journeyMins) : null,
    minutes: boardable ? minutesUntil(dep, nowMs) : null,
    time,
    label: [
      `${time} ${d.route.short}${isExpress(d) ? ' express' : ''} to ${destination}`,
      ...status.text.split(' · '),
    ]
      .concat(arrival ? `arrives ${arrival}` : [])
      .join(', '),
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
export function boardState(
  res: DeparturesResponse | undefined,
  offline: boolean,
  nowMs: number,
  /** usePageCheck() (@bft/ui): cached-page cutoff and page arrival (R2-T7, R15-S1). */
  page: PageCheck | null = null,
): BoardState {
  return liveState(res, { offline, nowMs, ...page })
}

/**
 * The one banner over both boards: offline when either board shows an offline copy (each board's own state wins over
 * the connection flag, R6-B1; one direction can be fresh while the other is still a copy), else the first board's.
 */
export function bannerState(states: BoardState[]): BoardState {
  return states.includes('offline') ? 'offline' : (states[0] ?? null)
}

/** Board rows for display: departed rows removed, live claims removed unless the state is live. */
export function visibleRows(list: Departure[], state: BoardState, nowMs: number): Departure[] {
  const rows = state == null ? list : list.map(asScheduled)
  return dropDeparted(rows, effectiveDep, nowMs, state == null).sort(
    (a, b) => effectiveDep(a) - effectiveDep(b) || a.schedDep - b.schedDep,
  )
}
