/** Departure rows → card props: countdown, status note and tone, highlighted next bus (B-Departures rules). */
import type { Alert, Departure } from '@bft/core/contract'
import { dayMarker, formatClock, minutesUntil } from '@bft/ui'
import type { NoteTone } from '@bft/ui/bus'
import { routeShortOf } from './stops.ts'

export interface RowView {
  key: string
  departure: Departure
  minutes: number
  time: string
  dayMarker: string | null
  note: string | null
  noteTone: NoteTone
  highlighted: boolean
}

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

export function noteFor(
  d: Departure,
  rows: Departure[],
  nowMs: number,
  detours: Map<string, Alert>,
): { note: string | null; tone: NoteTone } {
  if (d.status === 'cancelled') {
    const next = rows.find(
      (r) => r.route.short === d.route.short && r.status !== 'cancelled' && effective(r) > effective(d),
    )
    return next
      ? {
          note: `Next ${d.route.short} in ${Math.max(0, minutesUntil(effective(next), nowMs))} min`,
          tone: 'neutral',
        }
      : { note: null, tone: 'neutral' }
  }
  if (d.status === 'skipped') return { note: 'Not stopping here', tone: 'warning' }
  const detour = detours.get(d.route.short)
  if (d.status === 'live') {
    const delayMin = d.estDep != null ? Math.round((d.estDep - d.schedDep) / 60) : 0
    const base =
      delayMin >= 1 ? `+${delayMin} min late` : delayMin <= -1 ? `${-delayMin} min early` : 'On time'
    const tone: NoteTone = delayMin >= 1 ? 'late' : delayMin <= -1 ? 'info' : d.gps ? 'info' : 'good'
    if (detour) return { note: `${base} · detour`, tone: 'warning' }
    return { note: d.gps ? `GPS · ${base}` : base, tone }
  }
  if (detour) return { note: 'Detour: see alerts', tone: 'warning' }
  return { note: null, tone: 'neutral' }
}

export function rowViews(
  rows: Departure[],
  nowMs: number,
  opts: { alerts?: Alert[]; routes?: ReadonlySet<string> | null } = {},
): RowView[] {
  const detours = detourRoutes(opts.alerts ?? [], Math.floor(nowMs / 1000))
  // In the order of the times shown (R2-B8): once live estimates are dropped (offline, stale) the API's order, by
  // estimate, no longer matches the timetable times. Stable, so equal times keep the API's order.
  const shown = (opts.routes?.size ? rows.filter((d) => opts.routes?.has(d.route.short)) : rows)
    .slice()
    .sort((a, b) => effective(a) - effective(b))
  let highlightedDone = false
  return shown.map((d) => {
    const { note, tone } = noteFor(d, rows, nowMs, detours)
    const highlighted = !highlightedDone && d.status !== 'cancelled' && d.status !== 'skipped'
    if (highlighted) highlightedDone = true
    return {
      key: `${d.tripInstance}:${d.stopSequence}`,
      departure: d,
      minutes: minutesUntil(effective(d), nowMs),
      time: formatClock(effective(d)),
      dayMarker: dayMarker(effective(d), nowMs),
      note,
      noteTone: tone,
      highlighted,
    }
  })
}

/** Distinct route short names in departure order (route filter pills). */
export function routesIn(rows: Departure[]): string[] {
  const seen: string[] = []
  for (const d of rows) if (!seen.includes(d.route.short)) seen.push(d.route.short)
  return seen
}

/** Accessible one-line summary of a row. */
export function rowLabel(v: RowView): string {
  const d = v.departure
  const when =
    d.status === 'cancelled'
      ? 'cancelled'
      : v.minutes < 1
        ? 'departing now'
        : `in ${v.minutes} minutes, ${v.time}`
  return `Route ${d.route.short} to ${d.headsign}, ${when}${v.note ? `, ${v.note}` : ''}`
}
