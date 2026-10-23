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
 * Live data older than this is shown as timetable: four missed 15 s refreshes. Measured from when the answer reached
 * the device (Received), or from its `generatedAt` when it has no arrival time. A copy from the service worker's
 * cache, or a page reloaded from it, is flagged as such (noteCacheCopy, unconfirmedBefore) and never stamped.
 */
export const LIVE_REFRESH_MAX_AGE_MS = 60_000

let unreachable = false
/** Browser online, offline and visibilitychange events so far. */
let events = 0
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

/** deviceNow's last reading and the two device clocks then (monotonic, wall). */
let clock: { at: number; monotonic: number; wall: number } | undefined
/**
 * The device's own clock for arrival times and ages (Received, PageCheck.arrivedAt, stampNavigation, liveState):
 * epoch milliseconds that never go back. Each reading moves on by the time passed since the last one: the monotonic
 * clock's step, or the wall clock's if that is larger (a sleep the monotonic clock didn't count, Codex r2), never a
 * wall clock going back (a correction, Codex r1). Every step is measured afresh, so a sleep after a correction counts
 * too (Codex r4), and answers stamped after a sleep are fresh on the same clock (Codex r3).
 */
export function deviceNow(): number {
  const monotonic = performance.timeOrigin + performance.now()
  const wall = Date.now()
  // The first reading is the monotonic clock's own: the wall clock's distance from it says nothing (Chrome's
  // timeOrigin + now() can drift minutes from Date.now(); a page with a skewed clock is fresh, R15-S1). Only steps count.
  const last = clock ?? { at: monotonic, monotonic, wall }
  const step = Math.max(monotonic - last.monotonic, wall - last.wall, 0)
  clock = { at: last.at + step, monotonic, wall }
  return clock.at
}

/** The question a page asks its service worker, and its answer: a worker from an older build doesn't answer. */
export const MARKS_DATA = 'bft-marks-data'
/** A service worker that hasn't answered this long after being asked is taken not to mark its copies. */
export const MARKS_DATA_WAIT_MS = 1_000
const marking = new WeakMap<ServiceWorker, { answer: Promise<boolean>; marks: boolean }>()
/**
 * Does this service worker mark the `.data` copies it serves (markCachedData)? Asked once per worker (at load, on a
 * new controller, or at the first navigation), and answered within MARKS_DATA_WAIT_MS: no answer by then means no.
 * An answer that comes later still counts for the navigations after it.
 */
export function marksCopies(worker: ServiceWorker): Promise<boolean> {
  let known = marking.get(worker)
  if (!known) {
    const entry = { answer: Promise.resolve(false), marks: false }
    entry.answer = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), MARKS_DATA_WAIT_MS)
      const channel = new MessageChannel()
      channel.port1.onmessage = (e) => {
        clearTimeout(timer)
        entry.marks = e.data === MARKS_DATA
        resolve(entry.marks)
      }
      worker.postMessage({ type: MARKS_DATA }, [channel.port2])
    })
    marking.set(worker, entry)
    known = entry
  }
  return known.marks ? Promise.resolve(true) : known.answer
}
/** Asks the page's current service worker (marksCopies) ahead of the first navigation. */
const askServiceWorker = () => {
  const worker = navigator.serviceWorker?.controller
  if (worker) void marksCopies(worker)
}

/**
 * What liveState needs to know about this page once it has hydrated (R15-S1). `arrivedAt` is when this page was
 * requested (navigation start, on deviceNow's clock). Its HTML, and the data in it, was rendered after that, so data
 * without its own arrival time (Received) is at most `now - arrivedAt` old, whatever the device clock's offset from
 * the server's. Never younger than it is: an upper bound, so it can't make old data look live.
 */
export interface PageCheck {
  unconfirmedBefore: number | null
  arrivedAt: number
}
let pageCheck: PageCheck | undefined
const getPageCheck = (): PageCheck =>
  (pageCheck ??= {
    unconfirmedBefore: getUnconfirmedBefore(),
    arrivedAt: performance.timeOrigin,
  })
if (typeof document !== 'undefined') getPageCheck()

/**
 * The PageCheck for liveState (spread into its options), as React state: null during SSR and hydration, so the first
 * client render judges the data exactly as the server did (no hydration mismatch); the page's own after mount.
 */
export function usePageCheck(): PageCheck | null {
  return useSyncExternalStore(noSubscribe, getPageCheck, () => null)
}

/** Tests: forget the cutoff read at load. */
export function resetUnconfirmedBefore(): void {
  unconfirmedBefore = undefined
  pageCheck = undefined
  clock = undefined
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
 * and it paints before the app hydrates and judges the data. Pages the service worker serves from its cache arrive
 * already marked (markCachedPages); before first paint this also marks any page loaded while the browser says it is
 * offline. Either way LIVE_UNCONFIRMED_ATTR hides the live claims until the app has rendered its own judgement
 * (useLiveGuardRelease); then data that came with this HTML still can't claim LIVE (usePageCheck). It also records
 * the render time for that cutoff. Never the device clock (R15-S1): a clock minutes fast made every fresh page
 * "unconfirmed", so it showed OFFLINE until the first poll. Pages are `no-store`, so no other cache hands back an old
 * copy, and the app ages this page's data from when it was requested (PageCheck.arrivedAt). A fresh online page is
 * untouched, and React never sees a difference (an attribute on <html>, which the layouts render with
 * suppressHydrationWarning).
 */
export function liveGuardScript(renderedAt: number): string {
  const at = Math.floor(renderedAt)
  return `try{window.__bftRenderedAt=${at};if(navigator.onLine===false)document.documentElement.setAttribute('${LIVE_UNCONFIRMED_ATTR}','')}catch(e){}`
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
  // Any of them starts the boards' HTTP-error backoff over (pollEvery).
  events++
  for (const l of listeners) l(e)
}
if (typeof window !== 'undefined') {
  // A page restored from the back/forward cache (Chrome keeps no-store pages there too) shows whatever it last
  // rendered, with no service worker mark. Its live claims are hidden as it is put away (pagehide), so they never
  // show on restore, and it is loaded afresh (Codex r1, r2).
  window.addEventListener('pagehide', () => document.documentElement.setAttribute(LIVE_UNCONFIRMED_ATTR, ''))
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload()
  })
  // deviceNow's first reading: time passed from here on counts, a sleep included.
  deviceNow()
  // Which service worker marks the `.data` copies it serves (stampNavigation): asked once per controller.
  askServiceWorker()
  navigator.serviceWorker?.addEventListener('controllerchange', askServiceWorker)
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
  // The online event and the store change it causes arrive together: refetch once. A second reconnect within that
  // second runs at its end, instead of never: a board whose request failed in between was otherwise left offline until
  // its own 15 s poll, because another call's answer had cancelled the probe (staging R6-B1: LIVE back after 17 s).
  // One pending at most, dropped if the connection goes down first. Each one within 15 s of the last waits twice as
  // long (1, 2, 4, 8, then 15 s, the board's own poll): a board failing at every attempt while other calls get through
  // can't refetch every board each second, and a failed board is still asked again in time (Codex r2, r3).
  let last = 0
  let streak = 0
  let trailedAt = Number.NEGATIVE_INFINITY
  let later: ReturnType<typeof setTimeout> | undefined
  const refetch = () => {
    const now = Date.now()
    if (now - last >= 1_000) {
      clearTimeout(later)
      later = undefined
      last = now
      onBack()
      return
    }
    if (now - trailedAt > 15_000) streak = 0
    later ??= setTimeout(
      () => {
        later = undefined
        trailedAt = Date.now()
        streak++
        last = 0
        refetch()
      },
      last + Math.min(15_000, 1_000 * 2 ** streak) - now,
    )
  }
  // Store changes and the browser's events (`e`): online, refetch even if nothing had failed; shown again, refetch if
  // the connection was or is down.
  const check = (e?: Event) => {
    const now = isOnline()
    if (!now) {
      clearTimeout(later)
      later = undefined
    }
    if (
      e?.type === 'visibilitychange'
        ? !document.hidden && !(wasOnline && now)
        : now && (!wasOnline || e?.type === 'online')
    )
      refetch()
    wasOnline = now
  }
  const off = subscribe(check)
  return () => {
    off()
    clearTimeout(later)
  }
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

/**
 * `initialDataUpdatedAt` for a live query seeded with its page's loader data: its `generatedAt` when it was live, so
 * the first poll comes 15 s later as before. Otherwise 0, so the board asks again the moment it mounts (R27-RT1):
 * a cold API isolate answers scheduled rows (`unavailable`) once its realtime wait runs out (RT_WAIT_MS), and the
 * board then showed OFFLINE until its first poll while a warm answer was a few hundred ms away. Never makes data
 * look live: the new answer is judged like any other (liveState).
 */
export function seedUpdatedAt(initial: { generatedAt: number; rtState: string } | null | undefined) {
  if (!initial) return undefined
  return initial.rtState === 'live' ? initial.generatedAt : 0
}

/** The parts of a TanStack query result awaitingSeedAnswer reads. */
export interface SeededQuery {
  data: unknown
  dataUpdatedAt: number
  errorUpdateCount: number
  failureCount: number
}

/**
 * Is this board still showing a non-live seed (its page's loader data, seedUpdatedAt 0) while its own first request
 * is in flight (R32-RT1)? A cold API isolate answers `stale` or `unavailable` after RT_WAIT_MS, and the board's own
 * request, a second later, is usually live: until it answers the board is pending ("Connecting…", no banner), never
 * OFFLINE and never LIVE (its rows stay the seed's, as Scheduled). Pass the board's liveState: an offline board
 * (offline browser, a copy from the service worker, a cached page's seed: R2-T7, R6-B1) is never pending. Once the
 * board has an answer of its own (dataUpdatedAt), or its request failed (failureCount, errorUpdateCount), it is judged
 * as usual. Bounded by trackedFetch: a request unanswered after LIVE_REQUEST_TIMEOUT_MS fails and reports offline.
 * Server and hydration renders hold the seed with dataUpdatedAt 0 too, so the HTML says the same.
 */
export function awaitingSeedAnswer(q: SeededQuery, state: LiveState): boolean {
  return (
    q.data != null &&
    q.dataUpdatedAt === 0 &&
    q.errorUpdateCount === 0 &&
    q.failureCount === 0 &&
    state != null &&
    state !== 'offline'
  )
}

/**
 * Is a page of several boards pending (R32-RT1)? Yes while at least one board is waiting (no answer yet, or a
 * non-live seed's refetch still out: awaitingSeedAnswer) and every other board is waiting too or confirmed live. A
 * failed request (isError, or a first failure while TanStack retries) or an own answer that isn't live wins: a board
 * still waiting never hides another board's failure, whether or not the connection flag noticed it (an HTTP error
 * leaves it online).
 */
export function pagePending(
  boards: Array<{ q: SeededQuery & { isError: boolean }; state: LiveState }>,
): boolean {
  const waiting = ({ q, state }: (typeof boards)[number]) =>
    !q.isError && q.failureCount === 0 && (q.data == null || awaitingSeedAnswer(q, state))
  return boards.some(waiting) && boards.every((b) => waiting(b) || (b.q.data != null && b.state == null))
}

/** A page's loader seed as its board's query holds it before any request of its own (for awaitingSeedAnswer). */
export function asSeed(initial: { generatedAt: number; rtState: string }): SeededQuery {
  return { data: initial, dataUpdatedAt: seedUpdatedAt(initial) ?? 0, errorUpdateCount: 0, failureCount: 0 }
}

/** The polled (live) queries of a TanStack QueryClient: what a reconnect refetches. Static data stays cached. */
export interface RefetchableClient {
  refetchQueries(
    filters: { type: 'active'; predicate(query: PolledQuery): boolean },
    options: { cancelRefetch: boolean },
  ): Promise<unknown>
  getQueryCache(): { getAll(): PolledQuery[] }
}
/**
 * The part of a TanStack Query this reads: its observers' options (where `refetchInterval` lives), which setOptions
 * applies again (the observer then reads its refetchInterval afresh).
 */
interface PolledQuery {
  observers: ReadonlyArray<{ options: object; setOptions(options: object): void }>
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
 * Per query: the browser-event count and its errorUpdateCount when its HTTP-error backoff last started over (its last
 * good answer, or the browser's last online, offline or visibilitychange event).
 */
const backoffFrom = new WeakMap<object, [number, number]>()

/**
 * A live query's `refetchInterval` (TanStack reads it after each fetch, and on every render): every `ms` while API
 * calls get through, as before. After failed fetches that got an answer from the network (HTTP errors), `ms` doubling
 * with each failure in a row, up to BACKOFF_MAX_MS, up to a fifth shorter. Counted on this device (TanStack's
 * errorUpdateCount), never from a server time (Codex r2); started over by a good answer and by the browser's online,
 * offline and visibilitychange events. The same for every read of one failure (the jitter comes from its time): a
 * value that changed would restart the timer. None while the browser says it is offline: its `online` event refetches
 * every board (onReconnect). While calls fail with the browser online (lie-fi), probeWhileUnreachable refetches every
 * board on its backoff, so the board's own timer only backs that up, at the longest wait.
 */
export const pollEvery = (ms: number) => (query: QueryState) => {
  const { status, errorUpdateCount, errorUpdatedAt } = query.state
  let from = backoffFrom.get(query)
  // A query with no data yet goes back to 'pending' while it asks again: only a good answer starts over.
  if (status === 'success' || from?.[0] !== events) {
    from = [events, errorUpdateCount]
    backoffFrom.set(query, from)
  }
  const failures = errorUpdateCount - from[1]
  return isOnline()
    ? failures
      ? Math.min(BACKOFF_MAX_MS, ms * 2 ** (failures - 1)) * (1 - (errorUpdatedAt % 1000) / 5000)
      : ms
    : navigator.onLine !== false && BACKOFF_MAX_MS
}

/** The part of a TanStack Query that pollEvery reads. */
interface QueryState {
  state: { status: string; errorUpdateCount: number; errorUpdatedAt: number }
}

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
    // Offline, a poll timed before then would still fire: the boards read their refetchInterval (pollEvery) again.
    const offOffline = subscribe((e) => {
      if (e?.type === 'offline')
        for (const q of client.getQueryCache().getAll()) for (const o of q.observers) o.setOptions(o.options)
    })
    return () => {
      offReconnect()
      offProbe()
      offOffline()
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
  if (typeof body === 'object' && body !== null) {
    if (res.headers.get(SW_CACHE_HEADER)) cacheCopies.add(body)
    // A network answer in the browser is stamped with the device time it arrived (see Received). Never on the server:
    // a server-rendered board has no device arrival time.
    else if (typeof window !== 'undefined') (body as Received).receivedAt = deviceNow()
  }
  return body
}

/**
 * When a network answer reached this device, by the device clock (noteCacheCopy). liveState measures a board's age
 * from it, so a device clock that is minutes off never makes live data read as "delayed" (R13-B1): server times are
 * only compared with server times, device times with device times. An enumerable field, so it survives TanStack's
 * structural sharing and a board's offline copy.
 */
export interface Received {
  receivedAt?: number
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

/** The parts of a response its age is measured from. */
type AgedResponse = { rtSourceTimestamp: number | null; generatedAt: number } & Received
/** The parts of a response liveState reads. */
type LiveResponse = AgedResponse & { rtState: string } & OfflineCopy

/** The clock options liveState and sourceAgeS share. */
interface AgeClock {
  nowMs: number
  /**
   * PageCheck.arrivedAt (usePageCheck), null during SSR and hydration: device time by which data without its own
   * arrival time had reached this page.
   */
  arrivedAt?: number | null
}

/**
 * How old a response's TransLink source is now, in seconds, skew-free (R13-B1, R15-S1): its age when the server
 * answered (server clock only), plus the time since the answer reached this device (device clock only). A board
 * without its own arrival time came with this page's HTML: it is aged from when the page was requested
 * (`arrivedAt`), an upper bound. Server times are never compared with device times, except during SSR and hydration
 * (`arrivedAt` null), where `nowMs` is the server's render time and the result matches the HTML. Once hydrated, "now"
 * is the device's own clock read at every call (deviceNow), never `nowMs` (a useNow tick can be 15 s old): a render
 * after a reconnect judges age as of that render (R15, the useNow false LIVE). Infinity without a source time.
 */
export function sourceAgeS(res: AgedResponse, clock: AgeClock): number {
  return res.rtSourceTimestamp == null
    ? Infinity
    : res.generatedAt / 1000 - res.rtSourceTimestamp + elapsedMs(res, clock) / 1000
}

/** Time since the response reached the device (or its server time, during SSR and hydration). See sourceAgeS. */
function elapsedMs(res: AgedResponse, { nowMs, arrivedAt = null }: AgeClock): number {
  if (arrivedAt == null) return nowMs - (res.receivedAt ?? res.generatedAt)
  // Both device times: the arrival time (Received, or this page's) and now, read at this call. Never `nowMs`: a useNow
  // tick can be 15 s old, and the first render after hydration still has the server's render time. deviceNow counts a
  // sleep and ignores a wall clock set back; arrivals are stamped on the same clock.
  return deviceNow() - (res.receivedAt ?? arrivedAt)
}

/**
 * The source time to show as "updated 12 s ago" (formatAge, against `clock.nowMs`): the skew-free source age
 * (sourceAgeS) back from now, so a device clock minutes off doesn't add minutes to it (R15-S1). Null without one.
 */
export function sourceTimeS(res: AgedResponse | null | undefined, clock: AgeClock): number | null {
  return res?.rtSourceTimestamp == null ? null : clock.nowMs / 1000 - sourceAgeS(res, clock)
}

/**
 * What a board can honestly claim. null = live. Otherwise the banner to show, and the rows fall back to timetable
 * times: offline, the API's own rtState, or 'stale' when the TransLink source is over 5 min old or the response
 * reached the device over a minute ago (sourceAgeS: never by the device clock against a server time).
 */
export function liveState(
  res: LiveResponse | undefined,
  {
    offline,
    unconfirmedBefore = null,
    ...clock
  }: AgeClock & {
    offline: boolean
    /** usePageCheck(): data generated up to then came with an unconfirmed (cached) page. */
    unconfirmedBefore?: number | null
  },
): LiveState {
  // A board built offline stays offline until its own network answer replaces it, even if the connection flag says
  // otherwise meanwhile (another request got through): it is a cached copy, never live or "delayed" (R6-B1).
  if (offline || res?.offline === true) return 'offline'
  if (!res) return null
  // Came with a cached page (the service worker's copy, or one loaded offline): a copy kept on the device, shown as
  // the offline timetable until this board's own network answer arrives (R2-T7). Never 'stale': an offline reload can
  // start with navigator.onLine true, and then "Live times delayed" with that copy's departed rows gone ("No buses
  // due") and its old "Updated" time showed before the first poll failed (R6-B1).
  if (unconfirmedBefore != null && res.generatedAt <= unconfirmedBefore) return 'offline'
  if (res.rtState !== 'live') {
    return res.rtState === 'stale' || res.rtState === 'reloading' || res.rtState === 'unavailable'
      ? res.rtState
      : 'unavailable'
  }
  if (sourceAgeS(res, clock) > LIVE_SOURCE_MAX_AGE_S || elapsedMs(res, clock) > LIVE_REFRESH_MAX_AGE_MS)
    return 'stale'
  return null
}

/** The route results of a client navigation, as React Router's client middleware gets them from `next()`. */
type NavigationResults = Record<string, { type: string; result?: unknown }> | undefined

/**
 * Root `clientMiddleware` for every app (R15-S1): data from a client navigation (`<path>.data`) has no arrival time,
 * and judging it by the device clock against its server `generatedAt` made it "delayed" with a fast clock and, with a
 * slow one, let an old copy look live. Its live responses are stamped (stampResults), or kept as an offline copy.
 */
export async function stampNavigation<R extends NavigationResults>(
  _args: unknown,
  next: () => Promise<R>,
): Promise<R> {
  // Both read before the request is sent.
  const sentBy = deviceNow()
  const worker = navigator.serviceWorker?.controller ?? null
  // Without a service worker a `.data` answer (`no-store`) can only come from the network; under one, only if it is
  // a worker that marks the copies it serves (marksCopies, asked alongside the request).
  const trusted = worker == null ? true : marksCopies(worker)
  const results = await next()
  stampResults(results, sentBy, await trusted)
  return results
}

/**
 * Set by every loader with live data (`via: VIA_NETWORK`, next to its `renderedAt`). The service worker rewrites it
 * to VIA_CACHE in a `.data` response it serves from its cache (markCachedData): the page itself can't see that
 * response's headers (React Router reads it), so the body says where it came from, as markCachedPages does for HTML.
 * Same length, so nothing else in the body moves, and unlike anything in transit data.
 */
export const VIA_NETWORK = 'bft-via-net-q8z'
export const VIA_CACHE = 'bft-via-swc-q8z'

/**
 * Workbox runtime-caching plugin for the `.data` (client navigation) cache: a copy served from the cache says so
 * (VIA_NETWORK becomes VIA_CACHE in its body), so stampNavigation keeps its live data as an offline copy. The body is
 * rewritten, so the length and encoding headers of the stored copy no longer apply.
 */
export const markCachedData = {
  cachedResponseWillBeUsed: async ({ cachedResponse }: { cachedResponse?: Response }) =>
    cachedResponse &&
    new Response((await cachedResponse.text()).replaceAll(`"${VIA_NETWORK}"`, `"${VIA_CACHE}"`), {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers: new Headers(
        [...cachedResponse.headers].filter(([k]) => k !== 'content-length' && k !== 'content-encoding'),
      ),
    }),
}

/**
 * Each live response (anything with a `generatedAt`) in a route's loader data is stamped as Received at `sentBy`,
 * the device time before its request was sent: an upper bound on its age, whatever the device clock's offset.
 *
 * Only a network answer: one whose body says so (`via`, which the service worker rewrites in a copy it serves from
 * its cache, markCachedData), under a worker known to rewrite it (`trusted`). A worker from an older build doesn't,
 * so under it, until the new one takes over (at once: skipWaiting, clientsClaim), nothing is stamped (Codex r2).
 * Anything else, including live data without `via`, is an offline copy (OfflineCopy.offline: the offline timetable
 * until a network answer replaces it), and the connection is reported down, as for a /v1 answer from the cache. A
 * network answer reports it back up: the connection flag is never what decides (Codex r1). No server time is compared
 * with another: a page Worker's and the API's clocks needn't agree (Codex r2).
 */
function stampResults(results: NavigationResults, sentBy: number, trusted: boolean): void {
  let copy = false
  let fresh = false
  for (const r of Object.values(results ?? {})) {
    const data = r.type === 'data' ? (r.result as Record<string, unknown> | null) : null
    if (typeof data !== 'object' || data === null) continue
    const network = trusted && data.via === VIA_NETWORK
    for (const live of liveParts(data)) {
      if (network) live.receivedAt = sentBy
      else copy = live.offline = true
      fresh ||= network
    }
  }
  if (copy) reportOffline()
  else if (fresh) reportOnline()
}

/** The live responses in a route's loader data: values with a `generatedAt`, and in records of them (saved cards). */
function liveParts(data: Record<string, unknown>): Array<Received & OfflineCopy> {
  const out: Array<Received & OfflineCopy> = []
  const add = (v: unknown, depth: number) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return
    if (typeof (v as { generatedAt?: unknown }).generatedAt === 'number') out.push(v)
    else if (depth) for (const w of Object.values(v)) add(w, depth - 1)
  }
  for (const v of Object.values(data)) add(v, 1)
  return out
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
