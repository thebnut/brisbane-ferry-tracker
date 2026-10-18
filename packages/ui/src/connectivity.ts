/**
 * Connectivity and live-data freshness, shared by every app so they all say "offline" at the same moment.
 *
 * "Online" means the browser says so (navigator.onLine and its online/offline events) AND the last API call reached
 * the network. A call counts as failed when fetch() throws, when the service worker answered from its cache (its data
 * caches mark those responses, see `markCacheHits`), or when it is still unanswered after `SLOW_REQUEST_MS` (lie-fi).
 * The next call that reaches the network clears it, and so does the browser's own "online" event.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'

/** Header the service worker adds to /v1 responses it serves from its cache instead of the network. */
export const SW_CACHE_HEADER = 'x-bft-cache'

/** A request still unanswered after this long marks the connection as down until a request succeeds. */
export const SLOW_REQUEST_MS = 8_000

/** Live data whose TransLink source is older than this is shown as timetable times. */
export const LIVE_SOURCE_MAX_AGE_S = 300
/**
 * Live data generated longer ago than this is shown as timetable. Judged on the response's own `generatedAt`, never
 * on when it was fetched: a copy from the service worker's cache (or a page reloaded from it) is fetched "now" but
 * generated minutes ago. Polling is every 15 s, so this is four missed refreshes.
 */
export const LIVE_REFRESH_MAX_AGE_MS = 60_000

let unreachable = false
const listeners = new Set<() => void>()

function setUnreachable(value: boolean) {
  if (unreachable === value) return
  unreachable = value
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

/** The browser says it is back online: trust it until a request fails again (the next poll checks at once). */
const onBrowserOnline = () => setUnreachable(false)

function subscribe(onChange: () => void) {
  if (listeners.size === 0) window.addEventListener('online', onBrowserOnline)
  listeners.add(onChange)
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) window.removeEventListener('online', onBrowserOnline)
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
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
  const live = LIVE_PATH.test(input)
  const slow = live ? setTimeout(reportOffline, SLOW_REQUEST_MS) : undefined
  try {
    const res = await fetch(input, init)
    if (res.headers.get(SW_CACHE_HEADER)) reportOffline()
    else if (live) reportOnline()
    return res
  } catch (error) {
    if (!init?.signal?.aborted) reportOffline()
    throw error
  } finally {
    clearTimeout(slow)
  }
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
  res: { rtState: string; rtSourceTimestamp: number | null; generatedAt: number } | undefined,
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
  if (offline) return 'offline'
  if (!res) return null
  if (res.rtState !== 'live') {
    return res.rtState === 'stale' || res.rtState === 'reloading' || res.rtState === 'unavailable'
      ? res.rtState
      : 'unavailable'
  }
  // Came with a cached page: not live until this board's own fresh answer arrives (R2-T7).
  if (unconfirmedBefore != null && res.generatedAt <= unconfirmedBefore) return 'stale'
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
 * Offline, the copy of a board worth showing. Of the copies on hand (the data already on screen, the service
 * worker's cached response, a timetable saved on the device), the one with the most departures still to come by
 * timetable time; a tie goes to the newest. A service-worker copy can be hours old (its last network answer), so it
 * must never replace a fresher board that still has rows (R2-B6). Null when there is no copy at all.
 */
export function bestOfflineCopy<
  D extends { schedDep: number },
  T extends { generatedAt: number; departures: D[] },
>(copies: ReadonlyArray<T | null | undefined>, nowMs: number): T | null {
  const cutoff = nowMs / 1000
  let best: T | null = null
  let bestCount = -1
  for (const c of copies) {
    if (!c || !Array.isArray(c.departures)) continue
    const count = c.departures.filter((d) => d.schedDep >= cutoff).length
    if (count > bestCount || (count === bestCount && best != null && c.generatedAt > best.generatedAt)) {
      best = c
      bestCount = count
    }
  }
  return best
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
