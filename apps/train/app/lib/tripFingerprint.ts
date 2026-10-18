import type { TripResponse } from '@bft/core/contract'

/** The part of a trip that matters to a viewer; envelope timestamps change every response and are ignored. */
export function tripFingerprint(t: TripResponse): string {
  return JSON.stringify([
    t.status,
    t.rtState,
    t.stops.map((s) => [s.estArr, s.estDep, s.status, s.platform ?? null]),
    t.vehicle ? [Math.round(t.vehicle.lat * 1e4), Math.round(t.vehicle.lon * 1e4), t.vehicle.status] : null,
  ])
}
