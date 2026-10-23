/**
 * Which modes an alert belongs to, without the rest of alerts.ts (saved scopes, storage): the ferry board's alert
 * count (modes/ferry-alerts.tsx, THE-118 PR 3) loads only this, which keeps the root's list of that chunk's
 * dependencies (on every first load) short. alerts.ts re-exports it.
 */
import { routeShortOf } from '@bft/bus/app/lib/stops.ts'
import type { Alert } from '@bft/core/contract'
import FERRY_ROUTE_STOPS from '@bft/ferry/app/data/routes.json'
import { terminalById } from '@bft/ferry/app/lib/terminals.ts'
import type { TransitMode } from '@bft/ui'

export const ALERT_MODES: TransitMode[] = ['ferry', 'train', 'bus']

/** The mode of a stop id, where it can be told (null: unknown). */
export type StopModeOf = (stopId: string) => TransitMode | null

/**
 * Stop ids → mode: ferry terminals are bundled; train platforms need the train network (train-lines.ts
 * `isTrainPlatform`), and only with it can any other numeric stop id be called a bus stop. Parent ids ("place_…")
 * stay unknown.
 */
export function stopModeOf(isTrainPlatform?: (stopId: string) => boolean): StopModeOf {
  return (id) =>
    terminalById(id)
      ? 'ferry'
      : !isTrainPlatform
        ? null
        : isTrainPlatform(id)
          ? 'train'
          : /^\d+$/.test(id)
            ? 'bus'
            : null
}

const FERRY_ROUTES = new Set(Object.keys(FERRY_ROUTE_STOPS))

/**
 * The alert's modes (R2-X7b): the feed's own, else the modes of its routes and stops (TransLink often sends a stop
 * closure with no mode). Train routes are known from the train network (`trainLines`), ferry routes from the ferry
 * app's route list. Null for a network-wide notice (no route, no stop); empty when nothing can be placed, so it shows
 * under All but under no mode chip.
 */
export function alertModes(a: Alert, stopMode?: StopModeOf, trainLines?: TrainLinesOf): TransitMode[] | null {
  const own = a.modes.filter((m): m is TransitMode => m !== 'tram')
  if (own.length) return own
  if (a.modes.length) return []
  if (a.routes.length === 0 && a.stops.length === 0) return null
  const out = new Set<TransitMode>()
  if (trainLines?.(a).length) out.add('train')
  if (a.routes.some((r) => FERRY_ROUTES.has(routeShortOf(r)))) out.add('ferry')
  for (const s of a.stops) {
    const m = stopMode?.(s)
    if (m) out.add(m)
  }
  return [...out]
}

/** The alert's mode for the card (first of ferry/train/bus), or null for a network-wide or unplaced notice. */
export const alertMode = (a: Alert, stopMode?: StopModeOf, trainLines?: TrainLinesOf): TransitMode | null =>
  alertModes(a, stopMode, trainLines)?.[0] ?? null

/** Does the alert belong under a mode chip? Network-wide notices show under every mode. */
export const inMode = (a: Alert, m: TransitMode, modes = alertModes(a)) => modes == null || modes.includes(m)

/**
 * An alert under no mode chip (tram only, or stops this app can't place): the "Other" chip lists them, so every alert
 * the header counts can be found under a filter (R3-X10).
 */
export const inNoMode = (a: Alert, modes = alertModes(a)) => !ALERT_MODES.some((m) => inMode(a, m, modes))

/** Train line labels an alert touches ("Springfield line"), when the train network is loaded. */
export type TrainLinesOf = (a: Alert) => string[]

/** Alerts not over yet: active now or starting later (what the Alerts page lists, and its chips count). */
export const notOver = (a: Alert, nowS: number) =>
  a.activePeriods.length === 0 || a.activePeriods.some((p) => p.end == null || p.end >= nowS)
