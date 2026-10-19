/**
 * A last line of defence for read requests (the 19 Oct peak stall: departures held for 273-471 s after their caller
 * gave up). Each wait inside a request is bounded on its own (./deadline.ts), but a cold request chains several of
 * them; this caps the whole request and ends it as soon as the caller goes away.
 *
 * - The caller's abort (`request.signal`, which needs the `enable_request_signal` compatibility flag; over a service
 *   binding it fires when the calling Worker aborts its fetch) answers at once, so the invocation ends.
 * - Past REQUEST_DEADLINE_MS a GET answers 503 `timeout`. That is under the apps' 8 s client and 10 s proxy
 *   deadlines, so they see a prompt failure (and their fallbacks) rather than a hang.
 *
 * Only the response is raced: work shared with other requests (a snapshot refresh, a static read) carries on under
 * its own deadline. POSTs (/v1/ask, /mcp, Turnstile verify) and WebSocket upgrades keep their own limits.
 */
import { BUILD_HEADER } from '@bft/core'
import { corsHeaders } from './cors.ts'

export const REQUEST_DEADLINE_MS = 7_000

/** HTTP status for a request whose caller went away first (nobody reads it; nginx's "client closed request"). */
export const ABANDONED_STATUS = 499

export function isBounded(req: Request): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (req.headers.get('upgrade')) return false
  const path = new URL(req.url).pathname
  return !path.startsWith('/__')
}

export interface DeadlineOutcome {
  why: 'deadline' | 'abandoned'
  ms: number
}

export interface DeadlineOptions {
  ms?: number
  build?: string
  /** CORS_ALLOW_ALL, so a cut-off answer carries the same CORS headers as the app's (a browser can read it). */
  corsAllowAll?: boolean
  now?: () => number
  onCut?: (o: DeadlineOutcome) => void
}

/**
 * `handle(req)`, unless the deadline passes or the caller aborts first. `onCut` is told which (for the log). A cut-off
 * answer carries what the app's middleware would have added: CORS, x-request-id and the build marker (Codex r1).
 */
export function withRequestDeadline(
  req: Request,
  handle: () => Promise<Response>,
  opts: DeadlineOptions = {},
): Promise<Response> {
  if (!isBounded(req)) return handle()
  const ms = opts.ms ?? REQUEST_DEADLINE_MS
  const now = opts.now ?? Date.now
  const t0 = now()
  const headers = (): Record<string, string> => ({
    ...corsHeaders(req.headers.get('origin'), opts.corsAllowAll ?? false),
    'content-type': 'application/json',
    'cache-control': 'no-store',
    'x-request-id': req.headers.get('cf-ray') ?? crypto.randomUUID(),
    ...(opts.build ? { [BUILD_HEADER]: opts.build } : {}),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const signal = req.signal
  const cut = new Promise<Response>((resolve) => {
    const end = (why: DeadlineOutcome['why']) => {
      opts.onCut?.({ why, ms: now() - t0 })
      resolve(
        why === 'deadline'
          ? new Response(JSON.stringify({ error: 'timeout', detail: `no answer in ${ms} ms` }), {
              status: 503,
              headers: headers(),
            })
          : new Response(null, { status: ABANDONED_STATUS, headers: headers() }),
      )
    }
    timer = setTimeout(() => end('deadline'), ms)
    if (signal) {
      onAbort = () => end('abandoned')
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
  })
  return Promise.race([Promise.resolve().then(handle), cut]).finally(() => {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  })
}
