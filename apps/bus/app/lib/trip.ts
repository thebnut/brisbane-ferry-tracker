/** Trip detail helpers (B-Detail, THE-118 PR 6 "Your trip"). */
import type { TripResponse, TripStop } from '@bft/core/contract'
import { formatClock } from '@bft/ui'
import { positionFromVehicle, type TimelineStop } from '@bft/ui/trip'
import type { RouteFile } from './data-contract.ts'
import { stopCode } from './stops.ts'

export const at = (s: TripStop) => s.estDep ?? s.schedDep ?? s.estArr ?? s.schedArr ?? 0
/** The timetabled time, or null for an extra service (no timetable, so no delay is measured from it). */
export const schedAt = (s: TripStop) => s.schedDep ?? s.schedArr ?? null

/** True when the API left a stop unnamed (an older API, or a stop missing from its stop index). */
export const needsStopNames = (trip: TripResponse | null): trip is TripResponse =>
  !!trip && trip.stops.some((s) => !s.name)

/**
 * A stop the API couldn't name: its public stop number ("Stop 000142"), else the raw id. The meta line then leaves
 * the stop number out, so it isn't shown twice.
 */
export const unnamedStop = (stopId: string) => `Stop ${stopCode(stopId) ?? stopId}`

/** Names of a trip's stops from its route's stop file: the fallback when the trip endpoint left some unnamed. */
export function stopNamesFor(trip: TripResponse | null, route: RouteFile | null): Record<string, string> {
  if (!trip || !route) return {}
  const ids = new Set(trip.stops.map((s) => s.stopId))
  const names: Record<string, string> = {}
  for (const p of route.patterns) for (const s of p.stops) if (ids.has(s.key)) names[s.key] = s.name
  return names
}

/**
 * "Your trip" (THE-118 PR 6): one row per stop, from @bft/ui/trip's timeline. Stops before the bus (by its GPS stop, or
 * by the clock without one) are passed; the bus rides the line from its GPS stop. `board` is your stop's row.
 */
export function timeline(
  trip: TripResponse,
  from: string | null,
  nowMs: number,
  names: Record<string, string> = {},
): { rows: TimelineStop[]; board: number; position: number | null; positionLabel: string | null } {
  const nowS = nowMs / 1000
  const stops = trip.stops
  const position = positionFromVehicle(
    stops.map((s) => s.stopId),
    trip.vehicle,
  )
  const board = Math.max(
    0,
    stops.findIndex((s) => s.stopId === from),
  )
  const nameOf = (s: TripStop) => s.name ?? names[s.stopId]
  const rows = stops.map((s, i): TimelineStop => {
    const isFrom = i === board && s.stopId === from
    const name = nameOf(s)
    const last = i === stops.length - 1
    const skipped = s.status === 'skipped'
    const past = position != null ? i < position : at(s) <= nowS && !last
    const parts = [
      isFrom ? 'You board' : null,
      skipped ? 'Not stopping' : null,
      last ? 'Terminus' : null,
      past && !isFrom && !last ? 'Departed' : null,
      name && !last && !past && !isFrom && stopCode(s.stopId) ? `Stop ${stopCode(s.stopId)}` : null,
    ].filter(Boolean)
    return {
      id: `${s.stopId}:${s.stopSequence}`,
      name: name ?? unnamedStop(s.stopId),
      note: parts.join(' · ') || undefined,
      dep: at(s) ? formatClock(at(s)) : null,
      kind: skipped ? 'skip' : past ? 'passed' : last ? 'terminus' : 'stop',
      cancelled: s.status === 'cancelled',
    }
  })
  const here = position == null ? null : stops[Math.ceil(position)]
  const hereName = here ? (nameOf(here) ?? unnamedStop(here.stopId)) : null
  return {
    rows,
    board,
    position,
    positionLabel: hereName
      ? `The bus is ${trip.vehicle?.status === 'STOPPED_AT' ? 'at' : 'heading to'} ${hereName}`
      : null,
  }
}
