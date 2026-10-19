/**
 * Connectivity and live-data freshness, shared by every app so they all say "offline" at the same moment.
 *
 * "Online" means the browser says so (navigator.onLine and its online/offline events) AND the last API call reached
 * the network. A call counts as failed when fetch() throws, when the service worker answered from its cache (its data
 * caches mark those responses, see `markCacheHits`), or when it is still unanswered after `LIVE_REQUEST_TIMEOUT_MS` (lie-fi; it is then abandoned).
 * The next call that reaches the network clears it, and so does the browser's own "online" event.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { NULL_BODY_STATUS } from './upstream.ts'

/** Header the service worker adds to /v1 responses it serves from its cache instead of the network. */
export const SW_CACHE_HEADER = 'x-bft-cache'

/**
 * A live request still unanswered after this long (headers and body) is abandoned, and marks the connection as down
 * until a request succeeds. The board then shows its offline copy and the next poll or probe asks again.
 */
export const LIVE_REQUEST_TIMEOUT_MS = 8_000

/** Live data whose TransLink source is older than this is shown as timetable times. */
export const LIVE_SOURCE_MAX_AGE_S = 300
/**
 * Live data generated longer ago than this is shown as timetable. Judged on the response's own `generatedAt`, never
 * on when it was fetched: a copy from the service worker's cache (or a page reloaded from it) is fetched "now" but
 * generated minutes ago. Polling is every 15 s, so this is four missed refreshes.
 */
export const LIVE_REFRESH_MAX_AGE_MS = 60_000

let unreachable = false
const listeners = new Set<(e?: Event) => void>()
/** Disconnects so far (a failed API call or the browser going offline), however quickly the connection came back. */
let disconnects = 0

function setUnreachable(value: boolean) {
  if (unreachable === value) return
  unreachable = value
  if (value) disconnects++
  for (const l of listeners) l()
}

/** An API call couldn't reach the network. */
export const reportOffline = () => setUnreachable(true)
/** An API call reached the network. */
export const reportOnline = () => setUnreachable(false)

/**
 * Set on <html> while the live claims in server-rendered HTML are unconfirmed; theme.css hides every element marked
 * `data-live-claim` (LIVE pill, LIVE and GPS badges) while it is there.
 */
export const LIVE_UNCONFIRMED_ATTR = 'data-live-unconfirmed'

/**
 * Data in a page's HTML may be generated a little after the root's clock read (route loaders run alongside it), so
 * anything generated up to this long after the render counts as part of that render.
 */
export const RENDER_MARGIN_MS = 10_000

/**
 * Was this page's HTML unconfirmed when it loaded (a service-worker copy, or old or offline by the device's clock;
 * see liveGuardScript)? Then data generated with that render (`generatedAt` up to this cutoff, server time) can't
 * claim LIVE: each board waits for its own fresh answer from the network, rendered by the app (R2-T7, Codex review).
 * Read once, when this module loads before hydration; null when the page was fresh (or during SSR).
 */
function readUnconfirmedBefore(): number | null {
  if (typeof document === 'undefined' || !document.documentElement.hasAttribute(LIVE_UNCONFIRMED_ATTR))
    return null
  const at = (window as { __bftRenderedAt?: unknown }).__bftRenderedAt
  return typeof at === 'number' ? at + RENDER_MARGIN_MS : Number.POSITIVE_INFINITY
}
let unconfirmedBefore: number | null | undefined
const getUnconfirmedBefore = () => {
  if (unconfirmedBefore === undefined) unconfirmedBefore = readUnconfirmedBefore()
  return unconfirmedBefore
}
if (typeof document !== 'undefined') getUnconfirmedBefore()
const noSubscribe = () => () => {}

/** `unconfirmedBefore` for liveState, as React state: null during SSR and hydration (matching the HTML), then the cutoff. */
export function useUnconfirmedBefore(): number | null {
  return useSyncExternalStore(noSubscribe, getUnconfirmedBefore, () => null)
}

/** Tests: forget the cutoff read at load. */
export function resetUnconfirmedBefore(): void {
  unconfirmedBefore = undefined
}

/**
 * The live guard's own rule, inlined in each layout's <head> next to liveGuardScript (R3-F1): theme.css carries the
 * same rule, but a page whose stylesheet failed to load must still hide its live claims.
 */
export const LIVE_GUARD_CSS = `html[${LIVE_UNCONFIRMED_ATTR}] [data-live-claim]{display:none!important}`

/**
 * For a <noscript> in each layout's <head> (Codex review of R3-F1): without JavaScript nothing can confirm (or keep
 * up) live data, so live claims are never shown.
 */
export const NO_SCRIPT_LIVE_CSS = '<style>[data-live-claim]{display:none!important}</style>'

export function useLiveGuardRelease() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!mounted) return
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => document.documentElement.removeAttribute(LIVE_UNCONFIRMED_ATTR))
    })
    return () => cancelAnimationFrame(id)
  }, [mounted])
}

/**
 * Workbox runtime-caching plugin for the page (navigation) caches (R2-T7): HTML served from the cache gets
 * LIVE_UNCONFIRMED_ATTR on its <html> tag, whatever its age, so its live claims stay hidden and its boards wait for
 * their own fresh data (useUnconfirmedBefore). liveGuardScript adds the clock and offline checks for anything this misses. Serialised
 * into the service worker like markCacheHits: one self-contained expression. The body is rewritten, so the length
 * and encoding headers of the stored copy no longer apply.
 */
export const markCachedPages = {
  cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) =>
    cachedResponse &&
    new Response((await cachedResponse.text()).replace(/<html(?=[\s>])/i, '<html data-live-unconfirmed=""'), {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: new Headers(
        [...cachedResponse.headers].filter(([k]) => k !== 'content-length' && k !== 'content-encoding'),
      ),
    }),
}

/**
 * Inline <head> script for the root layout (R2-T7): a cached render must never claim LIVE before freshness is known.
 * The service worker serves a page's last HTML when the network is down, with the LIVE markup it had when rendered,
 * and it paints before the app hydrates and judges the data. Before first paint this compares the render time with
 * the device clock (the same minute as LIVE_REFRESH_MAX_AGE_MS) and checks navigator.onLine; if the HTML is old or the
 * device is offline it sets LIVE_UNCONFIRMED_ATTR, which hides the live claims until the app has rendered its own
 * judgement (useLiveGuardRelease); then data that came with this HTML still can't claim LIVE (useUnconfirmedBefore).
 * Pages the service worker serves from its cache arrive already marked (markCachedPages). It also records the
 * render time for that cutoff. A fresh online page is untouched, and
 * React never sees a difference (an attribute on <html>, which the layouts render with suppressHydrationWarning).
 */
export function liveGuardScript(renderedAt: number): string {
  const at = Math.floor(renderedAt)
  return `try{window.__bftRenderedAt=${at};if(navigator.onLine===false||Date.now()-${at}>${LIVE_REFRESH_MAX_AGE_MS})document.documentElement.setAttribute('${LIVE_UNCONFIRMED_ATTR}','')}catch(e){}`
}

/** Current answer, outside React (false only in a browser that is offline or whose API calls are failing). */
export function isOnline(): boolean {
  if (typeof window === 'undefined') return true
  // workerd has a `navigator` without `onLine`; only an explicit false counts.
  return navigator.onLine !== false && !unreachable
}

/**
 * The browser's online, offline and visibilitychange events, heard from the moment this module loads (in a browser).
 * Online, the browser is trusted until a request fails again (the next poll checks at once). Then every subscriber
 * hears of the event, after the state it reads is up to date.
 */
const onBrowserEvent = (e: Event) => {
  if (e.type === 'online') unreachable = false
  else if (e.type === 'offline') disconnects++
  for (const l of listeners) l(e)
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', onBrowserEvent)
  window.addEventListener('offline', onBrowserEvent)
  document.addEventListener('visibilitychange', onBrowserEvent)
}

function subscribe(onChange: (e?: Event) => void) {
  listeners.add(onChange)
  return () => void listeners.delete(onChange)
}

/**
 * The number of disconnects so far, as React state (0 during SSR and hydration). It only goes up, so something
 * confirmed by a network answer can require a new one after any disconnect, even one React never rendered: a failed
 * call and the next success in the same batch leave `useOnline()` true throughout (Codex review).
 */
export function useDisconnects(): number {
  return useSyncExternalStore(
    subscribe,
    () => disconnects,
    () => 0,
  )
}

/**
 * Calls `refetch` the moment the connection may be back (R3-X9), instead of leaving "Offline · scheduled" up until the
 * next 15 s poll: when the browser says it is online again, when a call reaches the network after failures (the
 * other boards follow at once), and when the page becomes visible again while it was offline. Returns an unsubscribe.
 */
export function onReconnect(onBack: () => void): () => void {
  let wasOnline = isOnline()
  // The online event and the store change it causes arrive together: refetch once.
  let last = 0
  const refetch = () => {
    if (Date.now() - last < 1_000) return
    last = Date.now()
    onBack()
  }
  // Store changes and the browser's events (`e`): online, refetch even if nothing had failed; shown again, refetch if
  // the connection was or is down.
  const check = (e?: Event) => {
    const now = isOnline()
    if (
      e?.type === 'visibilitychange'
        ? !document.hidden && !(wasOnline && now)
        : now && (!wasOnline || e?.type === 'online')
    )
      refetch()
    wasOnline = now
  }
  return subscribe(check)
}

/**
 * Did a page's data fail to load because the network is down (R7-T2)? A client navigation fetches its loader data
 * (`<path>.data`); offline the service worker has no copy, so fetch() rejects with a TypeError ("Failed to fetch",
 * Safari's "Load failed", Firefox's "NetworkError…"), and React Router hands that to the error boundary. Any error
 * while the browser says it is offline, or while API calls are failing, counts too.
 */
export function isOfflineFailure(error: unknown): boolean {
  // Only in the browser: an error on the server says nothing about the device's connection.
  if (typeof window === 'undefined') return false
  if (!isOnline()) return true
  return error instanceof TypeError && /^(?:failed to fetch|load failed|networkerror)/i.test(error.message)
}

/** How often a screen that needs the network retries while it waits for it (as well as on every reconnect). */
export const OFFLINE_RETRY_MS = 10_000

/**
 * For a screen that couldn't load offline (R7-T2): calls `retry` the moment the connection may be back (onReconnect),
 * and every OFFLINE_RETRY_MS meanwhile, because a dead connection that never said it was offline (lie-fi, the
 * service worker cut off) never says it is back either. Returns an unsubscribe.
 */
export function retryWhenBack(retry: () => void, intervalMs = OFFLINE_RETRY_MS): () => void {
  const off = onReconnect(retry)
  const id = setInterval(retry, intervalMs)
  return () => {
    off()
    clearInterval(id)
  }
}

/** The polled (live) queries of a TanStack QueryClient: what a reconnect refetches. Static data stays cached. */
export interface RefetchableClient {
  refetchQueries(
    filters: { type: 'active'; predicate(query: PolledQuery): boolean },
    options: { cancelRefetch: boolean },
  ): Promise<unknown>
}
/** The part of a TanStack Query this reads: its observers' options (where `refetchInterval` lives). */
interface PolledQuery {
  observers: ReadonlyArray<{ options: object }>
}
const isPolled = (q: PolledQuery) =>
  q.observers.some((o) => (o.options as { refetchInterval?: unknown }).refetchInterval != null)

/** While API calls fail but the browser says it is online, the live boards first retry after this long (R7). */
export const RECONNECT_PROBE_MS = 2_500
/** ...and then back off, doubling the wait up to this (offline backoff). */
export const BACKOFF_MAX_MS = LIVE_REFRESH_MAX_AGE_MS

/**
 * Calls `probe` while API calls are failing (or answered from the service worker's cache) and the browser still says
 * it is online, backing off: at a fixed 2.5 s, lie-fi made ~40 /v1 calls a minute (smoke round 9). That
 * connection can come back without any event: DevTools' "Service Workers → Offline" unticked, a flaky link, a captive
 * network let through. Until the next 15 s poll reached the network, nothing noticed, so a saved stop took 15–25 s to
 * show LIVE again (R7). Once a probe gets through, onReconnect refetches every board. With navigator.onLine false the
 * browser's `online` event does the job instead. A hidden tab doesn't poll, so it doesn't probe either (Codex review;
 * onReconnect refetches when it is shown). The waits start over with each outage and whenever the page is shown.
 */
export function probeWhileUnreachable(probe: () => void, firstMs = RECONNECT_PROBE_MS): () => void {
  let id: ReturnType<typeof setTimeout> | undefined
  let n = 0
  const update = () => {
    if (unreachable && navigator.onLine !== false && !document.hidden)
      id ??= setTimeout(
        () => {
          id = undefined
          probe()
          update()
        },
        // Doubling up to BACKOFF_MAX_MS, then up to a fifth shorter at random: devices that lost the same network
        // don't all come back in step.
        Math.min(BACKOFF_MAX_MS, firstMs * 2 ** n++) * (1 - Math.random() / 5),
      )
    else {
      clearTimeout(id)
      id = undefined
      n = 0
    }
  }
  const unsubscribe = subscribe(update)
  update()
  return () => {
    unsubscribe()
    clearTimeout(id)
  }
}

/**
 * A live query's `refetchInterval` (TanStack reads it after each fetch): every `ms` while API calls get through, as
 * before. None while the browser says it is offline: its `online` event refetches every board (onReconnect). While
 * calls fail with the browser online (lie-fi), probeWhileUnreachable refetches every board on its backoff, so the
 * board's own timer only backs that up, at the longest wait.
 */
export const pollEvery = (ms: number) => () =>
  isOnline() ? ms : navigator.onLine !== false && BACKOFF_MAX_MS

/**
 * onReconnect for an app's QueryClient, refetching every active polled query at once (R3-X9), and probing them while
 * the connection is down without the browser knowing (probeWhileUnreachable).
 */
export function useRefetchOnReconnect(client: RefetchableClient): void {
  useEffect(() => {
    const refetch = () => {
      void client
        .refetchQueries(
          { type: 'active', predicate: isPolled },
          // A board already fetching keeps its request (one reaching the network is what told us we're back).
          { cancelRefetch: false },
        )
        .catch(() => {})
    }
    const offReconnect = onReconnect(refetch)
    const offProbe = probeWhileUnreachable(refetch)
    return () => {
      offReconnect()
      offProbe()
    }
  }, [client])
}

/** `isOnline()` as React state: true during SSR and hydration, then the live answer. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, isOnline, () => true)
}

/** Live API paths (/v1/…, and the fixture copies under /__fixtures/v1/…). */
const LIVE_PATH = /^(?:https?:\/\/[^/]+)?(?:\/__fixtures)?\/v1\//

/**
 * fetch() that reports whether the network answered (see the module comment). Browser only. Any failure counts, but
 * only a live /v1 response from the network clears it: static data files (stop indexes, geo tiles) come from
 * stale-while-revalidate caches even with no connection, so they say nothing about being online.
 */
export async function trackedFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!LIVE_PATH.test(input)) {
    try {
      return await fetch(input, init)
    } catch (error) {
      if (!init?.signal?.aborted) reportOffline()
      throw error
    }
  }
  // A live call is abandoned after LIVE_REQUEST_TIMEOUT_MS, body included (R8-F1). One that never settled (bft-api
  // held some for minutes) kept its query fetching: TanStack joins the 15 s poll, the reconnect refetch and the probe
  // to the request in flight, so the board stayed "Offline · scheduled" until it ended.
  const caller = init?.signal
  const deadline = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    reportOffline()
    deadline.abort()
  }, LIVE_REQUEST_TIMEOUT_MS)
  const onAbort = () => deadline.abort(caller?.reason)
  if (caller?.aborted) onAbort()
  else caller?.addEventListener('abort', onAbort, { once: true })
  try {
    const res = await fetch(input, { ...init, signal: deadline.signal })
    const body = NULL_BODY_STATUS.has(res.status) ? null : await res.arrayBuffer()
    if (res.headers.get(SW_CACHE_HEADER)) reportOffline()
    else reportOnline()
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
  } catch (error) {
    if (timedOut) throw new TypeError(`Failed to fetch: no answer within ${LIVE_REQUEST_TIMEOUT_MS} ms`)
    if (!caller?.aborted) reportOffline()
    throw error
  } finally {
    clearTimeout(timer)
    caller?.removeEventListener('abort', onAbort)
  }
}

/** Bodies parsed from a response the service worker served from its cache (see noteCacheCopy). */
const cacheCopies = new WeakSet<object>()

/**
 * Each app's JSON reader calls this with the response and its parsed body, so the body itself says it is a cached
 * copy. A board must decide from its own response, never from the connection flag at the moment it checks: between
 * a cached answer (which reports offline) and that check, another request reaching the network (alerts every 60 s,
 * on the same tick as the 15 s poll) or an `online` event can clear the flag, and the old body was then shown as
 * live data: "Live times delayed", its old "Updated" time, and its departed rows gone (R6-B1).
 */
export function noteCacheCopy<T>(res: Response, body: T): T {
  if (res.headers.get(SW_CACHE_HEADER) && typeof body === 'object' && body !== null) cacheCopies.add(body)
  return body
}

/**
 * Is a freshly fetched body a network answer a board may show as such? Not when the service worker served it from its
 * cache, and not while the connection is down.
 */
export function isNetworkAnswer(body: unknown): boolean {
  return !(typeof body === 'object' && body !== null && cacheCopies.has(body)) && isOnline()
}

/**
 * May a freshly fetched body replace the board on screen as live data? Only a network answer (isNetworkAnswer) that
 * is not older than the server board on screen: an older body means some cache answered without saying so, and a
 * board never goes back to an older body (R6-B1). Server times only (serverStamp): a board built on the device, or a
 * copy saved on it, never holds a network answer back, whatever the device clock says (Codex release review).
 */
export function replacesBoard(
  body: { generatedAt: number },
  shown: ({ generatedAt: number } & OfflineCopy) | null | undefined,
) {
  const at = serverStamp(shown)
  return isNetworkAnswer(body) && !(at != null && body.generatedAt < at)
}

/** Marks a board built from copies on hand while offline. liveState keeps it 'offline' until a network answer replaces it. */
export interface OfflineCopy {
  offline?: boolean
  /**
   * The server generation time of the board this copy replaced on screen, or null when there was none: the copy's own
   * `generatedAt` may be a device-clock stamp (a timetable saved on the device) or an older saved answer.
   */
  serverGeneratedAt?: number | null
  /** Built on the device: its `generatedAt` is the device clock's, never compared with a server time. */
  deviceStamped?: boolean
}

/** The server time a board on screen was generated at: a response's own `generatedAt`, an offline copy's kept one. */
export function serverStamp(
  board: ({ generatedAt: number } & OfflineCopy) | null | undefined,
): number | null {
  if (!board) return null
  return board.serverGeneratedAt !== undefined ? board.serverGeneratedAt : board.generatedAt
}

/**
 * A board's copy, marked as offline (a new object: TanStack's structural sharing must see the change). It keeps the
 * server time of `shown`, the board on screen it replaces, for replacesBoard.
 */
export function asOfflineCopy<T extends object>(
  copy: T,
  shown: ({ generatedAt: number } & OfflineCopy) | null | undefined,
): T & { offline: true; serverGeneratedAt: number | null } {
  return { ...copy, offline: true, serverGeneratedAt: serverStamp(shown) }
}

/**
 * Workbox runtime-caching plugin for the /v1 data caches: marks a response served from the cache (the network failed
 * or timed out) with `SW_CACHE_HEADER`, so the page knows it is looking at an old copy. workbox-build serialises it
 * into the generated service worker with toString(), so it must not reference anything outside its own body.
 */
export const markCacheHits = {
  // One expression on purpose: the generated service worker joins lines with spaces, and this codebase's style has no
  // semicolons, so statements would run together (test/connectivity.test.ts compiles the serialised form).
  cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) =>
    cachedResponse &&
    new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: new Headers([...cachedResponse.headers, ['x-bft-cache', 'sw']]),
    }),
}

export type LiveState = 'offline' | 'stale' | 'reloading' | 'unavailable' | null

/**
 * What a board can honestly claim. null = live. Otherwise the banner to show, and the rows fall back to timetable
 * times: offline, the API's own rtState, or 'stale' when the TransLink source is over 5 min old or the response was
 * generated over a minute ago (both judged on the data's own timestamps).
 */
export function liveState(
  res: ({ rtState: string; rtSourceTimestamp: number | null; generatedAt: number } & OfflineCopy) | undefined,
  {
    offline,
    nowMs,
    unconfirmedBefore = null,
  }: {
    offline: boolean
    nowMs: number
    /** useUnconfirmedBefore(): data generated up to then came with an unconfirmed (cached) page. */
    unconfirmedBefore?: number | null
  },
): LiveState {
  // A board built offline stays offline until its own network answer replaces it, even if the connection flag says
  // otherwise meanwhile (another request got through): it is a cached copy, never live or "delayed" (R6-B1).
  if (offline || res?.offline === true) return 'offline'
  if (!res) return null
  // Came with a cached page (the service worker's copy, or HTML old by the device clock): a copy kept on the device,
  // shown as the offline timetable until this board's own network answer arrives (R2-T7). Never 'stale': an offline
  // reload can start with navigator.onLine true, and then "Live times delayed" with that copy's departed rows gone
  // ("No buses due") and its old "Updated" time showed before the first poll failed (R6-B1).
  if (unconfirmedBefore != null && res.generatedAt <= unconfirmedBefore) return 'offline'
  if (res.rtState !== 'live') {
    return res.rtState === 'stale' || res.rtState === 'reloading' || res.rtState === 'unavailable'
      ? res.rtState
      : 'unavailable'
  }
  const sourceAge = res.rtSourceTimestamp == null ? Infinity : nowMs / 1000 - res.rtSourceTimestamp
  if (sourceAge > LIVE_SOURCE_MAX_AGE_S || nowMs - res.generatedAt > LIVE_REFRESH_MAX_AGE_MS) return 'stale'
  return null
}

/**
 * A row's status once live estimates are removed: only "live" becomes "scheduled". Cancelled and skipped stay (never
 * boardable), and so does "unknown" (core's stale cancellation: it must not read as an ordinary scheduled service).
 */
export function timetableStatus<S extends string>(status: S): S | 'scheduled' {
  return status === 'live' ? 'scheduled' : status
}

/**
 * A trip detail with its live claims removed (offline, or data too old): no vehicle (so no GPS badge or position), no
 * live estimates, statuses per `timetableStatus`.
 */
export function tripAsTimetable<
  T extends {
    status: string
    vehicle: unknown
    stops: Array<{ status: string; estArr: number | null; estDep: number | null }>
  },
>(trip: T): T {
  return {
    ...trip,
    status: timetableStatus(trip.status),
    vehicle: null,
    stops: trip.stops.map((s) => ({ ...s, status: timetableStatus(s.status), estArr: null, estDep: null })),
  }
}

/**
 * Offline, the copy of a board worth showing, from the copies on hand (the data already on screen, the service
 * worker's cached response, a timetable saved on the device). The base is always the newest copy from the server, even
 * if its rows have run out, so a board never goes back to an older body or "Updated" time (R6-B1), and an hours-old
 * service-worker copy never replaces a fresher board (R2-B6). A copy built on the device (`deviceStamped`, stamped by
 * the device clock) is the base only when there is no server copy: its time can't be compared with a server's
 * (release review). Older copies only extend the base: the departures still to come after its last row, from the copy
 * with the most of them (a saved timetable), are appended, so the rows last as long as the device has timetable for.
 * Null with no copy at all.
 */
export function bestOfflineCopy<
  D extends { schedDep: number },
  T extends { generatedAt: number; departures: D[] } & OfflineCopy,
>(copies: ReadonlyArray<T | null | undefined>, nowMs: number): T | null {
  const cutoff = nowMs / 1000
  const usable = copies
    .filter((c): c is T => !!c && Array.isArray(c.departures))
    .sort((x, y) => Number(!!x.deviceStamped) - Number(!!y.deviceStamped) || y.generatedAt - x.generatedAt)
  const base = usable[0]
  if (!base) return null
  const last = base.departures.reduce((m, d) => Math.max(m, d.schedDep), Number.NEGATIVE_INFINITY)
  let extension: D[] = []
  for (const c of usable.slice(1)) {
    const later = c.departures.filter((d) => d.schedDep >= cutoff && d.schedDep > last)
    if (later.length > extension.length) extension = later
  }
  return extension.length ? { ...base, departures: [...base.departures, ...extension] } : base
}

/** Rows that left more than a minute ago are dropped while live. */
export const DEPARTED_GRACE_S = 60

/**
 * Remove rows that have already left. While live a row stays for a minute as "Departing"; when the data isn't live
 * (offline, stale) a row is gone once its time has passed, since nothing can confirm it is still at the stop.
 */
export function dropDeparted<T>(rows: T[], departsAt: (row: T) => number, nowMs: number, live: boolean): T[] {
  const cutoff = nowMs / 1000 - (live ? DEPARTED_GRACE_S : 0)
  return rows.filter((r) => departsAt(r) >= cutoff)
}

/**
 * Header each Worker adds to a page or loader-data response rendered in a visitor's demo session (?fixtures=1 and
 * its cookie, R7-B1): the service worker never keeps such a response (skipDemoResponses), and neither does
 * savePageCopy, so a demo page can never come back later under an ordinary visit's URL.
 */
export const DEMO_HEADER = 'x-bft-demo'

/**
 * Message a page sends its service workers after the one-off demo clean-up dropped runtime caches (R9): each saves its
 * install-time pages and the sending page again (startServiceWorker).
 */
export const RESAVE_PAGES = 'bft-resave-pages'

/**
 * Web Lock ordering the one-off demo clean-up against Cache Storage writers, across pages and service workers of this
 * origin (R9, Codex reviews r2, r3): the clean-up holds it exclusively from its listing of the caches until it has
 * settled, and every page-copy and cache write holds it shared until its put has settled, so no write lands while the
 * clean-up decides what to delete. Nothing releases it on a timer. Without Web Locks (or if a request fails) writers
 * go ahead at once, and the clean-up doesn't touch Cache Storage at all: it can't hold the writers back.
 */
export const CACHE_WRITE_LOCK = 'bft-cache-writes'

/**
 * Takes CACHE_WRITE_LOCK; resolves once granted with its release, or with null when it wasn't granted: held and
 * `ifAvailable`, no Web Locks here, or the request failed. Only a release means the lock is held.
 */
export function holdCacheLock(
  mode: 'shared' | 'exclusive',
  ifAvailable = false,
): Promise<(() => void) | null> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return Promise.resolve(null)
  return new Promise((granted) => {
    locks
      .request(CACHE_WRITE_LOCK, { mode, ifAvailable }, (lock) =>
        lock ? new Promise<void>((release) => granted(() => release())) : granted(null),
      )
      .catch(() => granted(null))
  })
}

/** Runs a cache write while no clean-up runs (CACHE_WRITE_LOCK, shared, until the write has settled). */
export async function whileNoCleanup<T>(write: () => Promise<T>): Promise<T> {
  const release = await holdCacheLock('shared')
  try {
    return await write()
  } finally {
    release?.()
  }
}

/**
 * Saves the page at `url` into the service worker's page cache (the first page view, and transit's client
 * navigations): fetched again from the network, kept only if it is an ordinary HTML page (not an error, not demo).
 */
export async function savePageCopy(cacheName: string, url: string): Promise<boolean> {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (
    !res.ok ||
    res.headers.has(DEMO_HEADER) ||
    !(res.headers.get('content-type') ?? '').includes('text/html')
  )
    return false
  await whileNoCleanup(async () => (await caches.open(cacheName)).put(url, res))
  return true
}
