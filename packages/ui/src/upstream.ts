/**
 * Deadlines for the app Workers' same-origin /v1 proxies (Worker code, no React). The browser abandons a live call
 * after LIVE_REQUEST_TIMEOUT_MS (connectivity.ts); the proxy's own deadline is a little longer, so a call bft-api
 * holds open (R8-F1: some for minutes) ends on the Worker side too, and the visitor's abort reaches the API.
 */

/** Upstream time limit: a hung binding (seen for 60 s during a bft-api redeploy, minutes in R8-F1) must not hang. */
export const API_TIMEOUT_MS = 10_000

/** The error a `proxied` call fails with at its deadline (other failures are the call's own). */
export class UpstreamTimeout extends Error {}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`upstream timeout after ${ms} ms`)), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

/**
 * Runs a proxied call for `request` under one deadline that covers the body read and the contract check too, not just
 * the response headers (Codex review of transit's proxy). `call` gets the signal to pass upstream: it aborts at the
 * deadline or when the visitor goes away, so a call bft-api holds open doesn't outlive either.
 */
export function proxied<T>(
  request: Request,
  call: (signal: AbortSignal) => Promise<T>,
  ms = API_TIMEOUT_MS,
): Promise<T> {
  const ctrl = new AbortController()
  const onGone = () => ctrl.abort(request.signal.reason)
  if (request.signal.aborted) onGone()
  else request.signal.addEventListener('abort', onGone, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new UpstreamTimeout(`upstream timeout after ${ms} ms`)
      ctrl.abort(error)
      reject(error)
    }, ms)
  })
  const gone = new Promise<never>((_, reject) =>
    ctrl.signal.addEventListener('abort', () => reject(ctrl.signal.reason), { once: true }),
  )
  return Promise.race([Promise.resolve().then(() => call(ctrl.signal)), deadline, gone]).finally(() => {
    clearTimeout(timer)
    request.signal.removeEventListener('abort', onGone)
  })
}
