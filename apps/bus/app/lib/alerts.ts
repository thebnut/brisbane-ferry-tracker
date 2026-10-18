/** Alert presentation (B-Alerts): severity chip, "when" text, scope filtering for My stops. */
import type { Alert } from '@bft/core/contract'
import { formatClock } from '@bft/ui'
import { isActive } from './departures.ts'
import { routeShortOf } from './stops.ts'

export type AlertKind = 'detour' | 'changed' | 'planned' | 'info'

export function alertKind(a: Alert, nowS: number): AlertKind {
  const active = isActive(a, nowS)
  if (a.effect === 'DETOUR' || a.effect === 'NO_SERVICE' || a.effect === 'SIGNIFICANT_DELAYS')
    return active ? 'detour' : 'planned'
  if (a.effect === 'STOP_MOVED' || a.effect === 'MODIFIED_SERVICE') return 'changed'
  if (!active) return 'planned'
  if (a.effect === 'REDUCED_SERVICE') return 'changed'
  return 'info'
}

export const KIND_LABEL: Record<AlertKind, (active: boolean) => string> = {
  detour: (active) => (active ? 'DETOUR · NOW' : 'DETOUR'),
  changed: () => 'CHANGED STOP',
  planned: () => 'PLANNED',
  info: () => 'INFO',
}

const dayFmt = new Intl.DateTimeFormat('en-AU', {
  timeZone: 'Australia/Brisbane',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Brisbane' })

export function whenText(a: Alert, nowS: number): string {
  const p = a.activePeriods.find((x) => x.end == null || x.end >= nowS)
  if (!p) return 'Ongoing'
  const today = dateKey.format(nowS * 1000)
  const sameDay = (s: number) => dateKey.format(s * 1000) === today
  if (p.start != null && p.start > nowS) {
    const start = sameDay(p.start)
      ? `From ${formatClock(p.start)} today`
      : `From ${dayFmt.format(p.start * 1000)}`
    if (p.end != null && dateKey.format(p.end * 1000) !== dateKey.format(p.start * 1000))
      return `${dayFmt.format(p.start * 1000)} – ${dayFmt.format(p.end * 1000)}`
    return start
  }
  if (p.end == null) return 'Until further notice'
  return sameDay(p.end) ? `Until ${formatClock(p.end)} today` : `Until ${dayFmt.format(p.end * 1000)}`
}

/** Bus alerts in display order: active detours first, then by start. Ended alerts are dropped. */
export function sortAlerts(alerts: Alert[], nowS: number): Alert[] {
  const rank: Record<AlertKind, number> = { detour: 0, changed: 1, planned: 2, info: 3 }
  return alerts
    .filter(
      (a) => a.activePeriods.length === 0 || a.activePeriods.some((p) => p.end == null || p.end >= nowS),
    )
    .filter((a) => a.modes.length === 0 || a.modes.includes('bus'))
    .sort(
      (x, y) =>
        rank[alertKind(x, nowS)] - rank[alertKind(y, nowS)] ||
        (x.activePeriods[0]?.start ?? 0) - (y.activePeriods[0]?.start ?? 0),
    )
}

/** Alerts touching saved stops, or routes that serve them. */
export function forMyStops(alerts: Alert[], stopIds: string[], routes: ReadonlySet<string>): Alert[] {
  return alerts.filter(
    (a) => a.stops.some((s) => stopIds.includes(s)) || a.routes.some((r) => routes.has(routeShortOf(r))),
  )
}
