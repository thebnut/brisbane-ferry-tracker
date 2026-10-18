/** Trip detail helpers (B-Detail timeline). */
import type { TripResponse, TripStop } from '@bft/core/contract'
import { type BusTimelineStop, formatClock } from '@bft/ui'
import type { RouteFile } from './data-contract.ts'
import { stopCode } from './stops.ts'

export const at = (s: TripStop) => s.estDep ?? s.schedDep ?? s.estArr ?? s.schedArr ?? 0
export const schedAt = (s: TripStop) => s.schedDep ?? s.schedArr ?? 0

/** Names of a trip's stops from its route's stop file (the trip endpoint carries ids only for buses). */
export function stopNamesFor(trip: TripResponse | null, route: RouteFile | null): Record<string, string> {
  if (!trip || !route) return {}
  const ids = new Set(trip.stops.map((s) => s.stopId))
  const names: Record<string, string> = {}
  for (const p of route.patterns) for (const s of p.stops) if (ids.has(s.key)) names[s.key] = s.name
  return names
}

/** Timeline kinds: stops before the bus are past; the bus's stop (or your stop if no GPS) is "here". */
export function timeline(
  trip: TripResponse,
  from: string | null,
  nowMs: number,
  names: Record<string, string> = {},
): BusTimelineStop[] {
  const nowS = nowMs / 1000
  const stops = trip.stops
  let hereIdx = -1
  if (trip.vehicle?.stopId) {
    const i = stops.findIndex((s) => s.stopId === trip.vehicle?.stopId)
    if (i >= 0) hereIdx = trip.vehicle.status === 'STOPPED_AT' ? i : Math.max(0, i - 1)
  }
  if (hereIdx < 0) {
    // No position: the last stop whose time has passed.
    for (let i = 0; i < stops.length; i++) if (at(stops[i] as TripStop) <= nowS) hereIdx = i
  }
  return stops.map((s, i) => {
    const isFrom = s.stopId === from
    const last = i === stops.length - 1
    const kind: BusTimelineStop['kind'] =
      i === hereIdx && trip.vehicle
        ? 'here'
        : i < hereIdx || (hereIdx === i && !trip.vehicle)
          ? 'past'
          : last
            ? 'end'
            : 'next'
    const metaParts = [
      kind === 'here' ? (isFrom ? 'Bus is here · your stop' : 'Bus is here') : isFrom ? 'Your stop' : null,
      s.status === 'skipped' ? 'Not stopping' : null,
      last ? 'Terminus' : null,
      kind === 'past' && !isFrom ? 'Departed' : null,
      !last && kind === 'next' && !isFrom && stopCode(s.stopId) ? `Stop ${stopCode(s.stopId)}` : null,
    ].filter(Boolean)
    return {
      key: `${s.stopId}:${s.stopSequence}`,
      name: s.name ?? names[s.stopId] ?? `Stop ${s.stopId}`,
      meta: metaParts.join(' · ') || undefined,
      time: at(s) ? formatClock(at(s)) : '',
      kind: isFrom && kind === 'next' ? 'here' : kind,
      struck: s.status === 'skipped',
    }
  })
}
