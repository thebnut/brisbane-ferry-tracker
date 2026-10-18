/**
 * Line status from /v1/alerts?mode=train (T-Alerts). Alerts name route_ids (e.g. "BRSP-5185"); their short name
 * (before the dash) maps to the display lines whose patterns use that route, so one alert can mark several lines.
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

/** Classify one alert for the status chip. */
export function healthOf(a: Alert): { status: LineHealth; text?: string } {
  const effect = a.effect ?? ''
  const text = `${a.header} ${a.description ?? ''}`.toLowerCase()
  if (effect === 'NO_SERVICE' || effect === 'REDUCED_SERVICE' || a.severity === 'SEVERE')
    return { status: 'major', text: effect === 'NO_SERVICE' ? 'No trains' : 'Disruption' }
  if (/platform/.test(text) && /change|leave from|depart from/.test(text))
    return { status: 'minor', text: 'Platform change' }
  if (effect === 'SIGNIFICANT_DELAYS' || /delay/.test(text)) return { status: 'minor', text: 'Minor delays' }
  if (
    a.cause === 'MAINTENANCE' ||
    a.cause === 'CONSTRUCTION' ||
    effect === 'MODIFIED_SERVICE' ||
    /works|replace/.test(text)
  )
    return { status: 'works', text: /weekend|sat|sun/.test(text) ? 'Weekend works' : 'Planned works' }
  return { status: 'minor', text: 'Service notice' }
}

const RANK: Record<LineHealth, number> = { major: 3, minor: 2, works: 1, good: 0 }

/** Lines that an alert touches. */
export function linesOfAlert(a: Alert): string[] {
  const shorts = new Set(a.routes.map(routeShort))
  return LINES.filter((l) => l.patterns.some((p) => shorts.has(p.route))).map((l) => l.name)
}

export function lineStatus(alerts: Alert[], nowS: number): LineStatusRow[] {
  const active = alerts.filter(
    (a) => isActive(a, nowS) && (a.modes.length === 0 || a.modes.includes('train')),
  )
  return LINES.filter((l) => l.name !== 'City')
    .map((l) => {
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
    })
    .sort((a, b) => RANK[b.status] - RANK[a.status] || a.name.localeCompare(b.name))
}
