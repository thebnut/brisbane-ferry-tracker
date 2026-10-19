// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  asOfflineCopy,
  dropDeparted,
  isNetworkAnswer,
  isOnline,
  LIVE_REFRESH_MAX_AGE_MS,
  LIVE_REQUEST_TIMEOUT_MS,
  liveState,
  markCacheHits,
  noteCacheCopy,
  replacesBoard,
  reportOffline,
  reportOnline,
  SW_CACHE_HEADER,
  serverStamp,
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
  it('a live request unanswered for LIVE_REQUEST_TIMEOUT_MS marks offline (lie-fi)', async () => {
    vi.useFakeTimers()
    browser()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))
    void trackedFetch('/v1/bus/stops/1/departures')
    expect(isOnline()).toBe(true)
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS)
    expect(isOnline()).toBe(false)
  })

  /** A fetch that hangs until its signal aborts, like the browser's (R8-F1: bft-api held requests for minutes). */
  const hangingFetch = () =>
    vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )

  it('R8-F1: a live request that never answers is abandoned at LIVE_REQUEST_TIMEOUT_MS, so its query settles', async () => {
    vi.useFakeTimers()
    browser()
    const fetch = hangingFetch()
    vi.stubGlobal('fetch', fetch)
    const result = trackedFetch('/v1/ferry/stops/317584/departures?to=317590').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS - 1)
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await result
    // A network failure (isOfflineFailure, getJson's 'network' kind), not the caller's abort.
    expect(error).toBeInstanceOf(TypeError)
    expect(String(error)).toMatch(/^TypeError: Failed to fetch/)
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(isOnline()).toBe(false)
    // The next answer clears it at once.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":1}')))
    const res = await trackedFetch('/v1/ferry/stops/317584/departures?to=317590')
    expect(await res.json()).toEqual({ ok: 1 })
    expect(isOnline()).toBe(true)
  })

  it('R8-F1: the deadline covers the body too (headers arrive, the body never does)', async () => {
    vi.useFakeTimers()
    browser()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string, init?: RequestInit) => {
        const body = new ReadableStream({
          start(c) {
            init?.signal?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')))
          },
        })
        return new Response(body, { headers: { 'content-type': 'application/json' } })
      }),
    )
    const result = trackedFetch('/v1/train/stops/central/departures').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS)
    expect(await result).toBeInstanceOf(TypeError)
    expect(isOnline()).toBe(false)
  })

  it("the caller's abort still reaches the request, and isn't a connection failure", async () => {
    vi.useFakeTimers()
    browser()
    const fetch = hangingFetch()
    vi.stubGlobal('fetch', fetch)
    const ctrl = new AbortController()
    const result = trackedFetch('/v1/bus/stops/1/departures', { signal: ctrl.signal }).catch(
      (e: unknown) => e,
    )
    ctrl.abort()
    expect(((await result) as DOMException).name).toBe('AbortError')
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(LIVE_REQUEST_TIMEOUT_MS)
    expect(isOnline()).toBe(true)
  })

  it('keeps status and headers, and a no-body status works', async () => {
    browser()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"e":1}', { status: 503, headers: { 'x-a': '1' } })),
    )
    const res = await trackedFetch('/v1/ferry/stops/1/departures')
    expect([res.status, res.headers.get('x-a'), await res.text()]).toEqual([503, '1', '{"e":1}'])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    expect((await trackedFetch('/v1/ferry/stops/1/departures')).status).toBe(204)
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
    const copy = asOfflineCopy(body(), null)
    expect(liveState(copy, { offline: false, nowMs: NOW })).toBe('offline')
    expect(liveState(body(), { offline: false, nowMs: NOW })).toBeNull()
  })
})

describe('replacesBoard compares server times only (release review C2, L4)', () => {
  const at = (generatedAt: number) => ({ generatedAt })
  it('R6-B1: never back to a body older than the server board on screen', () => {
    expect(replacesBoard(at(NOW - 1), at(NOW))).toBe(false)
    expect(replacesBoard(at(NOW), at(NOW))).toBe(true)
    expect(replacesBoard(at(NOW), undefined)).toBe(true)
  })
  it('a board built on the device (device-clock stamp, no server time) never holds an answer back', () => {
    const fast = asOfflineCopy(at(NOW + 5 * 60_000), null)
    expect(serverStamp(fast)).toBeNull()
    expect(replacesBoard(at(NOW), fast)).toBe(true)
  })
  it('an offline copy keeps the server time of the board it replaced, across copies', () => {
    const first = asOfflineCopy(at(NOW + 5 * 60_000), at(NOW - 10_000))
    const second = asOfflineCopy(at(NOW + 6 * 60_000), first)
    expect(serverStamp(second)).toBe(NOW - 10_000)
    expect(replacesBoard(at(NOW - 20_000), second)).toBe(false)
    expect(replacesBoard(at(NOW - 5_000), second)).toBe(true)
  })
  it('a cached copy is never a replacement, whatever its time', () => {
    const cached = noteCacheCopy(new Response('{}', { headers: { [SW_CACHE_HEADER]: 'sw' } }), at(NOW + 1))
    expect(replacesBoard(cached, at(NOW))).toBe(false)
  })
})
