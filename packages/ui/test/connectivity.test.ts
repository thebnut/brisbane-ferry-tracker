// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asOfflineCopy,
  dropDeparted,
  isNetworkAnswer,
  isOnline,
  LIVE_REFRESH_MAX_AGE_MS,
  liveState,
  markCacheHits,
  noteCacheCopy,
  reportOffline,
  reportOnline,
  SLOW_REQUEST_MS,
  SW_CACHE_HEADER,
  timetableStatus,
  trackedFetch,
  tripAsTimetable,
} from '../src/connectivity.ts'

const NOW = Date.UTC(2026, 9, 18, 11, 0)

afterEach(() => {
  reportOnline()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A browser-ish global: `window` present and navigator.onLine as given. */
function browser(onLine = true) {
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('navigator', { onLine })
}

describe('liveState (F3/T5/B3/X4)', () => {
  const res = (over: Record<string, unknown> = {}) => ({
    rtState: 'live',
    rtSourceTimestamp: NOW / 1000 - 20,
    generatedAt: NOW - 5_000,
    ...over,
  })
  it('live only while online and the data itself is fresh', () => {
    expect(liveState(res(), { offline: false, nowMs: NOW })).toBeNull()
    expect(liveState(res(), { offline: true, nowMs: NOW })).toBe('offline')
    expect(liveState(undefined, { offline: false, nowMs: NOW })).toBeNull()
  })
  it('judges age on the response itself, not when it was fetched', () => {
    const old = res({ generatedAt: NOW - LIVE_REFRESH_MAX_AGE_MS - 1 })
    expect(liveState(old, { offline: false, nowMs: NOW })).toBe('stale')
    expect(liveState(res({ rtSourceTimestamp: NOW / 1000 - 301 }), { offline: false, nowMs: NOW })).toBe(
      'stale',
    )
    expect(liveState(res({ rtSourceTimestamp: null }), { offline: false, nowMs: NOW })).toBe('stale')
  })
  it("passes the API's own state through", () => {
    expect(liveState(res({ rtState: 'reloading' }), { offline: false, nowMs: NOW })).toBe('reloading')
    expect(liveState(res({ rtState: 'unavailable' }), { offline: false, nowMs: NOW })).toBe('unavailable')
  })
})

describe('dropDeparted', () => {
  const rows = [NOW / 1000 - 90, NOW / 1000 - 30, NOW / 1000 + 60]
  it('keeps a minute of "Departing" while live, nothing past when not', () => {
    expect(dropDeparted(rows, (s) => s, NOW, true)).toEqual(rows.slice(1))
    expect(dropDeparted(rows, (s) => s, NOW, false)).toEqual(rows.slice(2))
  })
})

describe('trackedFetch', () => {
  it('SSR (no window) is always online', () => {
    expect(isOnline()).toBe(true)
  })
  it('navigator.onLine false is offline', () => {
    browser(false)
    expect(isOnline()).toBe(false)
  })
  it('a failed request marks offline; the next live /v1 response clears it', async () => {
    browser()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')))
    await expect(trackedFetch('/v1/ferry/stops/1/departures')).rejects.toThrow()
    expect(isOnline()).toBe(false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    // A static data file (stale-while-revalidate cache) says nothing about being online.
    await trackedFetch('/data/bus/stops.json')
    expect(isOnline()).toBe(false)
    await trackedFetch('/__fixtures/v1/ferry/stops/1/departures')
    expect(isOnline()).toBe(true)
  })
  it('a response the service worker served from its cache counts as offline', async () => {
    browser()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { headers: { [SW_CACHE_HEADER]: 'sw' } })),
    )
    await trackedFetch('/v1/train/stops/central/departures')
    expect(isOnline()).toBe(false)
  })
  it('an aborted request is not a connection failure', async () => {
    browser()
    const ctrl = new AbortController()
    ctrl.abort()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))
    await expect(trackedFetch('/v1/x', { signal: ctrl.signal })).rejects.toThrow()
    expect(isOnline()).toBe(true)
  })
  it('a live request unanswered for SLOW_REQUEST_MS marks offline (lie-fi)', async () => {
    vi.useFakeTimers()
    browser()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    void trackedFetch('/v1/bus/stops/1/departures')
    expect(isOnline()).toBe(true)
    await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS)
    expect(isOnline()).toBe(false)
  })
})

describe('markCacheHits (service worker plugin)', () => {
  it('still works after workbox-build serialises it into sw.js (newlines joined with spaces)', async () => {
    const source = String(markCacheHits.cachedResponseWillBeUsed).replace(/\s*\n\s*/g, ' ')
    const fn = new Function(`return (${source})`)() as typeof markCacheHits.cachedResponseWillBeUsed
    const marked = await fn({ cachedResponse: new Response('x', { status: 200, headers: { a: '1' } }) })
    expect(marked?.headers.get(SW_CACHE_HEADER)).toBe('sw')
    expect(marked?.headers.get('a')).toBe('1')
    expect(await marked?.text()).toBe('x')
    expect(await fn({})).toBeUndefined()
  })
})

describe("dropping live claims keeps what can't be boarded (Codex review)", () => {
  it('only live becomes scheduled', () => {
    expect(['live', 'scheduled', 'cancelled', 'skipped', 'unknown'].map(timetableStatus)).toEqual([
      'scheduled',
      'scheduled',
      'cancelled',
      'skipped',
      'unknown',
    ])
  })
  it('a trip loses its vehicle and estimates', () => {
    const trip = {
      status: 'live',
      vehicle: { id: 'v' },
      stops: [
        { status: 'live', estArr: 1, estDep: 2 },
        { status: 'skipped', estArr: null, estDep: null },
      ],
    }
    expect(tripAsTimetable(trip)).toEqual({
      status: 'scheduled',
      vehicle: null,
      stops: [
        { status: 'scheduled', estArr: null, estDep: null },
        { status: 'skipped', estArr: null, estDep: null },
      ],
    })
  })
})

describe('a board judges its own response, not the connection flag (R6-B1)', () => {
  const body = () => ({ rtState: 'live', rtSourceTimestamp: NOW / 1000, generatedAt: NOW })
  it('a body from the service worker cache is never a network answer, even once the flag says online again', () => {
    browser()
    const cached = noteCacheCopy(new Response('{}', { headers: { [SW_CACHE_HEADER]: 'sw' } }), body())
    reportOffline()
    // Another request (alerts) reaches the network before the board checks.
    reportOnline()
    expect(isOnline()).toBe(true)
    expect(isNetworkAnswer(cached)).toBe(false)
    expect(isNetworkAnswer(noteCacheCopy(new Response('{}'), body()))).toBe(true)
  })
  it('a network body still is not one while the connection is down', () => {
    browser(false)
    expect(isNetworkAnswer(noteCacheCopy(new Response('{}'), body()))).toBe(false)
  })
  it('an offline copy stays offline in liveState whatever the flag says, until replaced', () => {
    const copy = asOfflineCopy(body())
    expect(liveState(copy, { offline: false, nowMs: NOW })).toBe('offline')
    expect(liveState(body(), { offline: false, nowMs: NOW })).toBeNull()
  })
})
