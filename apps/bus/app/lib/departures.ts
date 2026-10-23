/** Departure rows → row props: countdown, status line and fact, highlighted next bus (B-Departures rules). */
import type { Alert, Departure } from '@bft/core/contract'
import {
  dayMarker,
  formatClock,
  minutesUntil,
  nextAlike,
  type RowStatus,
  type StatusLine,
  soonestIndex,
  statusLine,
} from '@bft/ui'
import { routeShortOf } from './stops.ts'

/**
 * A "Depart from" board (the Now ▾ chip, THE-118 PR 5): only departures leaving at or after `at` (epoch s), by the time
 * shown, so a bus timetabled just before it but running late enough still counts (Codex r2). A timetable copy (offline
 * or not live) has no estimates, so its timetabled times decide.
 */
export const leavingFrom = <T extends { departures: Departure[] }>(res: T, at: number | null): T =>
  at ? { ...res, departures: res.departures.filter((d) => (d.estDep ?? d.schedDep) >= at) } : res

export interface RowView {
  key: string
  departure: Departure
  minutes: number
  time: string
  dayMarker: string | null
  status: RowStatusLine
  fact: string | null
  highlighted: boolean
}

export type RowStatusLine = StatusLine & { status: RowStatus }

const effective = (d: Departure) => d.estDep ?? d.schedDep

/** Route short names with an active detour or stop change, from alerts (route ids like "60-5146"). */
export function detourRoutes(alerts: Alert[], nowS: number): Map<string, Alert> {
  const out = new Map<string, Alert>()
  for (const a of alerts) {
    if (!isActive(a, nowS)) continue
    if (a.effect !== 'DETOUR' && a.effect !== 'STOP_MOVED' && a.effect !== 'MODIFIED_SERVICE') continue
    for (const r of a.routes) out.set(routeShortOf(r), a)
  }
  return out
}

export function isActive(a: Alert, nowS: number): boolean {
  if (a.activePeriods.length === 0) return true
  return a.activePeriods.some((p) => (p.start == null || p.start <= nowS) && (p.end == null || p.end >= nowS))
}

/** A row's status line and its one fact: "GPS", or "detour" when an alert changes the route. */
export function rowStatus(
  d: Departure,
  rows: Departure[],
  nowMs: number,
  detours: Map<string, Alert>,
): { status: RowStatusLine; fact: string | null } {
  const next =
    d.status === 'cancelled'
      ? nextAlike(
          rows,
          rows.indexOf(d),
          (r) => r.route.short === d.route.short && effective(r) > effective(d),
        )
      : undefined
  const status = {
    status: d.status,
    ...statusLine({
      status: d.status,
      schedDep: d.schedDep,
      estDep: d.estDep,
      next: next && { name: d.route.short, minutes: minutesUntil(effective(next), nowMs) },
    }),
  }
  const boardable = d.status !== 'cancelled' && d.status !== 'skipped'
  const fact = !boardable ? null : detours.has(d.route.short) ? 'detour' : d.gps ? 'GPS' : null
  return { status, fact }
}

export function rowViews(
  rows: Departure[],
  nowMs: number,
  opts: { alerts?: Alert[]; routes?: ReadonlySet<string> | null } = {},
): RowView[] {
  const detours = detourRoutes(opts.alerts ?? [], Math.floor(nowMs / 1000))
  // In the order of the times shown (R2-B8): once live estimates are dropped (offline, stale) the API's order, by
  // estimate, no longer matches the timetable times. Stable, so equal times keep the API's order.
  const sorted = rows.slice().sort((a, b) => effective(a) - effective(b))
  const shown = opts.routes?.size ? sorted.filter((d) => opts.routes?.has(d.route.short)) : sorted
  const soonest = soonestIndex(shown)
  return shown.map((d, i) => ({
    key: `${d.tripInstance}:${d.stopSequence}`,
    departure: d,
    minutes: minutesUntil(effective(d), nowMs),
    time: formatClock(effective(d)),
    dayMarker: dayMarker(effective(d), nowMs),
    ...rowStatus(d, sorted, nowMs, detours),
    highlighted: i === soonest,
  }))
}

/** Distinct route short names in departure order (route filter pills). */
export function routesIn(rows: Departure[]): string[] {
  const seen: string[] = []
  for (const d of rows) if (!seen.includes(d.route.short)) seen.push(d.route.short)
  return seen
}
