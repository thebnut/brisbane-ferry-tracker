/**
 * The RT stop-event state machine (transit-architecture.md §3.3, Codex finding 3).
 *
 * Rules:
 * - A delay propagates downstream only until the next explicit update, and never through NO_DATA.
 * - SKIPPED stops render as "not stopping here" and are transparent for propagation.
 * - CANCELED trips stay cancelled until their scheduled end; when RT is stale a cancellation shows "unknown",
 *   never a silent return to scheduled.
 * - When RT is stale (older than STALE_AFTER_S), ordinary rows fall back to scheduled.
 */
import type { DepartureStatus, RtState, RtStopUpdate, RtTrip } from '../contract/index.ts'

export const STALE_AFTER_S = 300

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
 */
export function predictStop(
  trip: RtTrip | undefined,
  seq: number,
  schedArr: number,
  schedDep: number,
  rtState: RtState,
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
    // A vehicle can't leave before it arrives: clamp departure to at least the predicted arrival.
    const estDep = Math.max(u.dep ?? schedDep + (depDelay ?? 0), Math.min(estArr, schedDep + (depDelay ?? 0)))
    return { estArr, estDep, status: 'live' }
  }
  // Propagate the upstream stop's departure delay (falling back to its arrival delay).
  const delay = u.depDelay ?? u.arrDelay
  if (delay == null) return scheduled
  return { estArr: schedArr + delay, estDep: schedDep + delay, status: 'live' }
}

/** Should the hub keep this record? Cancellations persist until `until` even if the feed drops them. */
export function isRecordLive(trip: RtTrip, nowS: number, seenThisCycle: boolean): boolean {
  if (seenThisCycle) return true
  if ((trip.rel === 'CANCELED' || trip.rel === 'DELETED') && trip.until != null) return nowS <= trip.until
  return false
}
