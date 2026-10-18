/**
 * Merged alerts for every mode (X-Alerts), classified with the standalone apps' own rules: bus `alertKind`/`whenText`
 * (generic GTFS-RT effects) and train `linesOfAlert` for line names (train-lines.ts), so a tab and the merged list
 * never disagree. The train network file (8 KB gz) is not on this page's first load: the server names the lines of the
 * alerts it renders, and the browser loads it only for alerts that arrive later or to match saved train stations.
 */
import { alertKind, whenText } from '@bft/bus/app/lib/alerts.ts'
import { routeShortOf } from '@bft/bus/app/lib/stops.ts'
import type { Alert, DeparturesResponse } from '@bft/core/contract'
import type { AlertSeverityKind, TransitMode } from '@bft/ui'
import { readSavedItems, type SavedItem } from './saved.ts'
import { safe } from './storage.ts'

export const ALERT_MODES: TransitMode[] = ['ferry', 'train', 'bus']

/** The alert's mode for the card (first of ferry/train/bus), or null for a network-wide notice. */
export const alertMode = (a: Alert): TransitMode | null =>
  (a.modes.find((m) => m !== 'tram') as TransitMode | undefined) ?? null

/** Does the alert belong under a mode chip? Network-wide notices show under every mode. */
export const inMode = (a: Alert, m: TransitMode) => a.modes.length === 0 || a.modes.includes(m)

export function severityOf(a: Alert, nowS: number): AlertSeverityKind {
  const kind = alertKind(a, nowS)
  if (kind === 'planned') return 'planned'
  if (a.effect === 'NO_SERVICE') return 'cancelled'
  if (kind === 'detour') return 'detour'
  if (kind === 'changed') return 'changed'
  return 'info'
}

/** Train line labels an alert touches ("Springfield line"), when the train network is loaded. */
export type TrainLinesOf = (a: Alert) => string[]

/** "BUS · ROUTE 66", "TRAIN · SPRINGFIELD LINE", "FERRY · F1", "ALL SERVICES". */
export function scopeText(a: Alert, trainLines?: TrainLinesOf): string {
  const mode = alertMode(a)
  if (!mode) return 'ALL SERVICES'
  const head = mode.toUpperCase()
  const shorts = [...new Set(a.routes.map(routeShortOf))]
  if (mode === 'train') {
    const lines = trainLines?.(a) ?? []
    if (lines.length === 1) return `${head} · ${(lines[0] as string).toUpperCase()}`
    if (lines.length > 1) return `${head} · ${lines.length} LINES`
  } else if (shorts.length === 1) return `${head} · ${mode === 'bus' ? 'ROUTE ' : ''}${shorts[0]}`
  else if (shorts.length > 1) return `${head} · ${shorts.length} ROUTES`
  if (a.stops.length) return `${head} · ${a.stops.length === 1 ? '1 STOP' : `${a.stops.length} STOPS`}`
  return `${head} · ALL ${mode === 'train' ? 'LINES' : mode === 'ferry' ? 'SERVICES' : 'ROUTES'}`
}

/** Active or upcoming alerts, disruptions first, then by start. */
export function sortAlerts(alerts: Alert[], nowS: number): Alert[] {
  const rank: Record<AlertSeverityKind, number> = {
    cancelled: 0,
    detour: 1,
    platform: 2,
    changed: 2,
    info: 3,
    planned: 4,
  }
  return alerts
    .filter(
      (a) => a.activePeriods.length === 0 || a.activePeriods.some((p) => p.end == null || p.end >= nowS),
    )
    .sort(
      (x, y) =>
        rank[severityOf(x, nowS)] - rank[severityOf(y, nowS)] ||
        (x.activePeriods[0]?.start ?? 0) - (y.activePeriods[0]?.start ?? 0),
    )
}

/** Stops and routes of what the user saved in any tab (stop ids from the items, routes from their last copies). */
export interface SavedScope {
  stops: Set<string>
  routes: Set<string>
}

/** Platform stop ids of a train station key (train-lines.ts), when the train network is loaded. */
export type PlatformsOf = (station: string | null) => string[]

export function savedScope(items: SavedItem[] = readSavedItems(), platformsOf?: PlatformsOf): SavedScope {
  const stops = new Set<string>()
  const routes = new Set<string>()
  for (const it of items) {
    if (it.mode === 'train')
      for (const k of [it.key, it.to]) for (const id of platformsOf?.(k) ?? []) stops.add(id)
    else {
      stops.add(it.key)
      if (it.to) stops.add(it.to)
    }
    const copy = safe(
      () =>
        JSON.parse(localStorage.getItem(`bft-transit-v1:${it.id}`) ?? 'null') as DeparturesResponse | null,
      null,
    )
    for (const d of copy?.departures ?? []) routes.add(routeShortOf(d.route.id))
  }
  return { stops, routes }
}

/** "Your saved stop" / "On a route you use" when an alert touches something saved, else null. */
export function impactOn(a: Alert, scope: SavedScope): string | null {
  if (a.stops.some((s) => scope.stops.has(s))) return 'Affects a saved stop'
  if (a.routes.some((r) => scope.routes.has(routeShortOf(r)))) return 'On a route you use'
  return null
}

export { whenText }
