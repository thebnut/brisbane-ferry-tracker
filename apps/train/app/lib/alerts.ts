/**
 * Line status from /v1/alerts?mode=train (T-Alerts). Alerts name route_ids (e.g. "BRSP-5185"); their short name
 * (before the dash) maps to the display lines whose patterns use that route, so one alert can mark several lines.
 *
 * Rules (smoke test round 1, T3):
 *  - Only alerts active now mark a line. Alerts whose periods are all in the future are "upcoming" (listed with their
 *    start), never a status on today's line.
 *  - An alert that touches at least NETWORK_SHARE of the lines is network-wide ("Reduced train timetables" names every
 *    route): shown once as a network notice, not as a chip on each line.
 *  - Red "Disruption" is for no service, SEVERE alerts and unplanned causes (accident, breakdown, weather, police,
 *    medical, protest). TransLink tags every planned track closure REDUCED_SERVICE, so a planned or reduced service is
 *    amber ("Planned works" / "Reduced service"), not red.
 */
import type { Alert } from '@bft/core/contract'
import type { LineHealth } from '@bft/ui'
import { LINES } from './network.ts'

export interface LineStatusRow {
  id: string
  name: string
  color: string
  status: LineHealth
  statusText?: string
  detail: string
  alerts: Alert[]
}

const routeShort = (routeId: string) => routeId.split('-')[0] ?? routeId

/** Is the alert active at `nowS` (no periods = always)? */
export const isActive = (a: Alert, nowS: number) =>
  a.activePeriods.length === 0 ||
  a.activePeriods.some((p) => (p.start == null || p.start <= nowS) && (p.end == null || nowS <= p.end))

/** Start of the alert's next period after `nowS`, or null (already active, or nothing ahead). */
export function nextStart(a: Alert, nowS: number): number | null {
  if (isActive(a, nowS)) return null
  const starts = a.activePeriods.map((p) => p.start).filter((s): s is number => s != null && s > nowS)
  return starts.length ? Math.min(...starts) : null
}

/** End of the period active at `nowS` (null when open-ended or not active). */
export function currentEnd(a: Alert, nowS: number): number | null {
  const p = a.activePeriods.find(
    (x) => (x.start == null || x.start <= nowS) && (x.end == null || nowS <= x.end),
  )
  return p?.end ?? null
}

/** Causes nobody planned: these make a disruption red. */
const UNPLANNED = new Set([
  'ACCIDENT',
  'TECHNICAL_PROBLEM',
  'WEATHER',
  'POLICE_ACTIVITY',
  'MEDICAL_EMERGENCY',
  'DEMONSTRATION',
])
/** Effects that never stop or slow a train. */
const BENIGN = new Set(['ACCESSIBILITY_ISSUE', 'ADDITIONAL_SERVICE', 'STOP_MOVED'])
const PLANNED = new Set(['MAINTENANCE', 'CONSTRUCTION'])
const WEEKEND = /\bweekend\b|\bsaturday\b|\bsunday\b/

/** Classify one alert for the status chip (see the module comment). */
export function healthOf(a: Alert): { status: LineHealth; text?: string } {
  const effect = a.effect ?? ''
  const cause = a.cause ?? ''
  const text = `${a.header} ${a.description ?? ''}`.toLowerCase()
  if (effect === 'NO_SERVICE') return { status: 'major', text: 'No trains' }
  if (a.severity === 'SEVERE' || (UNPLANNED.has(cause) && !BENIGN.has(effect)))
    return { status: 'major', text: 'Disruption' }
  if (/platform/.test(text) && /change|leave from|depart from/.test(text))
    return { status: 'minor', text: 'Platform change' }
  if (effect === 'SIGNIFICANT_DELAYS' || /delay/.test(text)) return { status: 'minor', text: 'Minor delays' }
  const works = PLANNED.has(cause) || /track|closure|works|replace/.test(text)
  if (works || effect === 'MODIFIED_SERVICE')
    return { status: 'works', text: WEEKEND.test(text) ? 'Weekend works' : 'Planned works' }
  if (effect === 'REDUCED_SERVICE') return { status: 'minor', text: 'Reduced service' }
  return { status: 'minor', text: 'Service notice' }
}

const RANK: Record<LineHealth, number> = { major: 3, minor: 2, works: 1, good: 0 }

/** The lines on the status board (the City core isn't a line of its own). */
const STATUS_LINES = LINES.filter((l) => l.name !== 'City')

/** An alert touching at least this share of the lines is a network notice, not a chip on each line. */
export const NETWORK_SHARE = 0.75

/** Lines that an alert touches. */
export function linesOfAlert(a: Alert): string[] {
  const shorts = new Set(a.routes.map(routeShort))
  return LINES.filter((l) => l.patterns.some((p) => shorts.has(p.route))).map((l) => l.name)
}

/** Does the alert cover (nearly) the whole network? */
export function isNetworkWide(a: Alert): boolean {
  const lines = new Set(linesOfAlert(a))
  const touched = STATUS_LINES.filter((l) => lines.has(l.name)).length
  return touched >= Math.ceil(STATUS_LINES.length * NETWORK_SHARE)
}

const forTrains = (a: Alert) => a.modes.length === 0 || a.modes.includes('train')

/** Active, network-wide alerts: one notice each at the top of the status page. */
export function networkNotices(alerts: Alert[], nowS: number): Alert[] {
  return alerts.filter((a) => forTrains(a) && isActive(a, nowS) && isNetworkWide(a))
}

/** Alerts that start later, soonest first (planned weekend closures and the like). */
export function upcomingAlerts(alerts: Alert[], nowS: number): Alert[] {
  return alerts
    .filter((a) => forTrains(a) && nextStart(a, nowS) != null)
    .sort((x, y) => (nextStart(x, nowS) ?? 0) - (nextStart(y, nowS) ?? 0))
}

export function lineStatus(alerts: Alert[], nowS: number): LineStatusRow[] {
  const active = alerts.filter((a) => isActive(a, nowS) && forTrains(a) && !isNetworkWide(a))
  return STATUS_LINES.map((l) => {
    const mine = active.filter((a) => linesOfAlert(a).includes(l.name))
    let worst: { status: LineHealth; text?: string } = { status: 'good' }
    let detail = 'No disruptions'
    for (const a of mine) {
      const h = healthOf(a)
      if (RANK[h.status] > RANK[worst.status]) {
        worst = h
        detail = a.summary ?? a.header
      }
    }
    return {
      id: l.name,
      name: l.name,
      color: l.color,
      status: worst.status,
      statusText: worst.text,
      detail,
      alerts: mine,
    }
  }).sort((a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name))
}
