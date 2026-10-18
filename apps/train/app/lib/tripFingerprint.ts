/**
 * Push logic for the trip WebSocket prototype (workers/tripSocket.ts), kept pure so it is unit-tested.
 *
 * Frames: a full TripResponse when anything a viewer can see changed; otherwise a small `tick` each cycle (keeps the
 * client's "updated n s ago" honest and proves the stream is alive); `unavailable` when the upstream load failed, so
 * the client falls back to polling instead of showing stale data.
 */
import type { TripResponse } from '@bft/core/contract'

export type TripFrame =
  | { type: 'tick'; tripInstance: string; rtSourceTimestamp: number | null; generatedAt: number }
  | { type: 'unavailable'; tripInstance: string }

/** Everything rendered from a trip, minus envelope metadata that changes on every response. */
export function tripFingerprint(t: TripResponse): string {
  const { generatedAt: _g, rtSourceTimestamp: _r, vehicle, ...rest } = t
  return JSON.stringify([rest, vehicle ? { ...vehicle, ts: 0 } : null])
}

export interface PushState {
  /** Fingerprint every connected socket has been sent. */
  last: string | null
}

export type PushAction =
  | { kind: 'broadcast'; body: string }
  | { kind: 'send-new'; body: string }
  | { kind: 'tick'; body: string }
  | { kind: 'unavailable'; body: string }

/**
 * A viewer connected and we loaded the trip. If it changed since the last broadcast, everyone gets it (so a new viewer
 * never leaves older viewers behind); otherwise only the new viewer does.
 */
export function onConnect(state: PushState, trip: TripResponse | null, key: string): PushAction {
  if (!trip) return { kind: 'unavailable', body: JSON.stringify({ type: 'unavailable', tripInstance: key }) }
  const fp = tripFingerprint(trip)
  const body = JSON.stringify(trip)
  if (fp !== state.last) {
    state.last = fp
    return { kind: 'broadcast', body }
  }
  return { kind: 'send-new', body }
}

/** One 15 s cycle: push the trip if it changed, otherwise a tick; tell viewers when the load failed. */
export function onCycle(state: PushState, trip: TripResponse | null, key: string): PushAction {
  if (!trip) return { kind: 'unavailable', body: JSON.stringify({ type: 'unavailable', tripInstance: key }) }
  const fp = tripFingerprint(trip)
  if (fp !== state.last) {
    state.last = fp
    return { kind: 'broadcast', body: JSON.stringify(trip) }
  }
  const tick: TripFrame = {
    type: 'tick',
    tripInstance: trip.tripInstance,
    rtSourceTimestamp: trip.rtSourceTimestamp,
    generatedAt: trip.generatedAt,
  }
  return { kind: 'tick', body: JSON.stringify(tick) }
}
