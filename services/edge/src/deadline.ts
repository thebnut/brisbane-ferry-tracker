/**
 * Bounded waits on loads shared between requests (the 19 Oct staging stall: a per-isolate in-flight refresh whose
 * I/O died with the request that started it stayed pending forever, and every later request awaited it).
 *
 * In a Worker, a promise's I/O belongs to the request that created it. When that request ends (or is cancelled),
 * the promise can stay pending for good, and so can a timer set in that request. So a shared load is stamped with
 * its start time and treated as dead once it is past its deadline, and every waiter races it on its own timer.
 */

export class DeadlineError extends Error {
  override name = 'DeadlineError'
}

/** The caller went away (its request's signal aborted) before `what` answered. */
export class AbandonedError extends Error {
  override name = 'AbandonedError'
}

/**
 * `p`, or a DeadlineError after `ms`, or an AbandonedError as soon as `signal` aborts. The timer is the caller's own,
 * set in the caller's request. Only the wait ends: `p` itself (often shared with other requests) is left running.
 */
export function within<T>(p: Promise<T>, ms: number, what: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(`${what}: no answer in ${ms} ms`)), Math.max(0, ms))
    if (signal) {
      onAbort = () => reject(new AbandonedError(`${what}: caller went away`))
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  return Promise.race([p, late]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  })
}

/** A load shared by concurrent requests, stamped with when it started. */
export interface Flight<T> {
  readonly p: Promise<T>
  readonly at: number
  settled: boolean
}

export function flight<T>(p: Promise<T>, at: number): Flight<T> {
  const f: Flight<T> = { p, at, settled: false }
  const done = () => {
    f.settled = true
  }
  p.then(done, done)
  return f
}

/** Still pending past its deadline: its I/O is presumed lost, so it must be replaced, not joined. */
export const isDead = (f: Flight<unknown>, nowMs: number, deadlineMs: number): boolean =>
  !f.settled && nowMs - f.at >= deadlineMs

/** Wait for a flight for at most what is left of its deadline. */
export function awaitFlight<T>(
  f: Flight<T>,
  nowMs: number,
  deadlineMs: number,
  what: string,
  signal?: AbortSignal,
): Promise<T> {
  return f.settled ? f.p : within(f.p, f.at + deadlineMs - nowMs, what, signal)
}
