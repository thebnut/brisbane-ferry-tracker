/**
 * The RT stop-event state machine (transit-architecture.md §3.3, Codex finding 3).
 *
 * Rules:
 * - A delay propagates downstream only until the next explicit update, and never through NO_DATA.
 * - SKIPPED stops render as "not stopping here" and are transparent for propagation.
 * - CANCELED trips stay cancelled until their scheduled end; when RT is stale a cancellation shows "unknown",
 *   never a silent return to scheduled.
 * - When RT is stale (older than STALE_AFTER_S), ordinary rows fall back to scheduled.
 * - An estimate more than MAX_UNSTATED_DELAY_S off the timetable is untrusted (shown as scheduled, never LIVE)
 *   unless the feed states that time at that stop: a propagated delay, or a departure pushed back by the arrival
 *   clamp, of that size is far more likely a wrong vehicle/block assignment than a real ferry an hour late.
 */
import type { DepartureStatus, RtState, RtStopUpdate, RtTrip } from '../contract/index.ts'

export const STALE_AFTER_S = 300
/** Largest delay (either way) we show without the feed stating it at the stop itself. */
export const MAX_UNSTATED_DELAY_S = 3600

export interface StopPrediction {
  estArr: number | null
  estDep: number | null
  status: DepartureStatus
}

/** rtState for a snapshot, given its source age and whether its static generation matches ours. */
export function rtStateFor(
  sourceTimestamp: number | null,
  nowS: number,
  generationMatches: boolean,
): RtState {
  if (sourceTimestamp == null) return 'unavailable'
  if (!generationMatches) return 'reloading'
  return nowS - sourceTimestamp > STALE_AFTER_S ? 'stale' : 'live'
}

/** The update that governs `seq`: the last non-SKIPPED update at or before it. */
function governingUpdate(updates: RtStopUpdate[], seq: number): RtStopUpdate | undefined {
  let best: RtStopUpdate | undefined
  for (const u of updates) {
    if (u.seq > seq) break
    if (u.rel === 'SKIPPED') continue
    best = u
  }
  return best
}

/**
 * Predict arrival and departure at one stop occurrence of a trip.
 * `updates` must be sorted by seq and carry delays (the hub normalises absolute times to delays).
 * `use` says which time the caller shows: 'dep' (a boarding row, the default) trusts an hour-plus delay only when the
 * feed states this stop's departure; 'arr' (a destination, a trip's last stop) trusts this stop's own arrival.
 */
export function predictStop(
  trip: RtTrip | undefined,
  seq: number,
  schedArr: number,
  schedDep: number,
  rtState: RtState,
  use: 'dep' | 'arr' = 'dep',
): StopPrediction {
  const scheduled: StopPrediction = { estArr: null, estDep: null, status: 'scheduled' }
  if (!trip || rtState === 'unavailable' || rtState === 'reloading') return scheduled
  if (trip.rel === 'CANCELED' || trip.rel === 'DELETED') {
    return { estArr: null, estDep: null, status: rtState === 'stale' ? 'unknown' : 'cancelled' }
  }
  if (rtState === 'stale') return scheduled

  const exact = trip.updates.find((u) => u.seq === seq)
  if (exact?.rel === 'SKIPPED') return { estArr: null, estDep: null, status: 'skipped' }

  const u = governingUpdate(trip.updates, seq)
  if (!u || u.rel === 'NO_DATA') return scheduled

  if (u.seq === seq) {
    const arrDelay = u.arrDelay ?? u.depDelay
    const depDelay = u.depDelay ?? u.arrDelay
    if (arrDelay == null && depDelay == null) return scheduled
    const estArr = u.arr ?? schedArr + (arrDelay ?? 0)
    const stated = u.dep ?? schedDep + (depDelay ?? 0)
    // A vehicle can't leave before it arrives: clamp the departure to at least the predicted arrival.
    const estDep = Math.max(stated, estArr)
    // A departure is stated only by the feed's own departure at this stop, not derived from the arrival (or pushed
    // past the stated one by the clamp). The arrival always comes from this stop's own update.
    const depStated = (u.dep != null || u.depDelay != null) && estDep === stated
    if (use === 'dep' && !depStated && Math.abs(estDep - schedDep) > MAX_UNSTATED_DELAY_S) return scheduled
    return { estArr, estDep, status: 'live' }
  }
  // Propagate the upstream stop's departure delay (falling back to its arrival delay).
  const delay = u.depDelay ?? u.arrDelay
  if (delay == null || Math.abs(delay) > MAX_UNSTATED_DELAY_S) return scheduled
  return { estArr: schedArr + delay, estDep: schedDep + delay, status: 'live' }
}

/** Should the hub keep this record? Cancellations persist until `until` even if the feed drops them. */
export function isRecordLive(trip: RtTrip, nowS: number, seenThisCycle: boolean): boolean {
  if (seenThisCycle) return true
  if ((trip.rel === 'CANCELED' || trip.rel === 'DELETED') && trip.until != null) return nowS <= trip.until
  return false
}
