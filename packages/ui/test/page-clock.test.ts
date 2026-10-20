// @vitest-environment jsdom
/**
 * R15-S1: a fresh page must never look offline, delayed or live because of the device clock. Ages are measured
 * server time against server time and device time against device time; data in the page's HTML is aged from when
 * the page was requested (PageCheck.arrivedAt), an upper bound on its real age. Also the useNow false LIVE: "now" is
 * read at each judgement, never a tick that can be 15 s old.
 */
import { renderHook } from '@testing-library/react'
import { act, createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deviceNow,
  isOnline,
  LIVE_REFRESH_MAX_AGE_MS,
  LIVE_UNCONFIRMED_ATTR,
  liveState,
  markCachedData,
  noteCacheCopy,
  RENDER_MARGIN_MS,
  reportOffline,
  reportOnline,
  resetNavigationStamps,
  resetUnconfirmedBefore,
  sourceAgeS,
  sourceTimeS,
  stampNavigation,
  usePageCheck,
  VIA_CACHE,
  VIA_NETWORK,
} from '../src/connectivity.ts'
import { formatAge } from '../src/format.ts'

/** Server time of the render. */
const NOW = Date.UTC(2026, 9, 20, 11, 24)
const SKEWS = [-30, -5, -2, 2, 5, 30]
const html = document.documentElement
const win = window as { __bftRenderedAt?: number }

const board = (o: Partial<{ generatedAt: number; rtSourceTimestamp: number; receivedAt: number }> = {}) => ({
  rtState: 'live',
  rtSourceTimestamp: NOW / 1000 - 20,
  generatedAt: NOW,
  ...o,
})

/** The device's monotonic clock (performance.now), moved by `pass`. */
let mono = 0
/** `ms` of time pass on the device: its wall clock (Date) and its monotonic clock both move. */
const pass = (ms: number) => {
  mono += ms
  vi.advanceTimersByTime(ms)
}

/**
 * A page requested `sinceRequestMs` ago (monotonic) on a device whose clock is `skewMin` off the server's. Returns
 * its PageCheck as the app sees it after hydration.
 */
function loadPage({ skewMin = 0, sinceRequestMs = 1_500, cached = false } = {}) {
  const origin = NOW + skewMin * 60_000
  vi.useFakeTimers({ now: origin + sinceRequestMs })
  mono = sinceRequestMs
  vi.spyOn(performance, 'now').mockImplementation(() => mono)
  vi.spyOn(performance, 'timeOrigin', 'get').mockReturnValue(origin)
  win.__bftRenderedAt = NOW
  if (cached) html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
  resetUnconfirmedBefore()
  resetNavigationStamps()
  const page = renderHook(() => usePageCheck()).result.current
  if (!page) throw new Error('no page check')
  return page
}

afterEach(() => {
  html.removeAttribute(LIVE_UNCONFIRMED_ATTR)
  delete win.__bftRenderedAt
  resetUnconfirmedBefore()
  resetNavigationStamps()
  reportOnline()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('data in a fresh page (R15-S1)', () => {
  it.each(SKEWS)('is live at once with the device clock %i min off', (min) => {
    const page = loadPage({ skewMin: min })
    expect(page.unconfirmedBefore).toBeNull()
    expect(liveState(board(), { offline: false, nowMs: Date.now(), ...page })).toBeNull()
  })

  it.each(SKEWS)('is aged from when the page was requested: an upper bound (%i min)', (min) => {
    // Requested 61 s ago (the tab sat in the background): the data is at least that old, whatever the clock says.
    const page = loadPage({ skewMin: min, sinceRequestMs: LIVE_REFRESH_MAX_AGE_MS + 1_000 })
    expect(liveState(board(), { offline: false, nowMs: Date.now(), ...page })).toBe('stale')
    // A source that was 290 s old at render is over the 300 s limit 11 s later.
    const page2 = loadPage({ skewMin: min, sinceRequestMs: 11_000 })
    const old = board({ rtSourceTimestamp: NOW / 1000 - 290 })
    expect(liveState(old, { offline: false, nowMs: Date.now(), ...page2 })).toBe('stale')
  })

  it.each(SKEWS)(
    'a service-worker copy stays offline whatever the clock (%i min); its own answer is live',
    (min) => {
      const page = loadPage({ skewMin: min, cached: true })
      expect(page.unconfirmedBefore).toBe(NOW + RENDER_MARGIN_MS)
      expect(liveState(board(), { offline: false, nowMs: Date.now(), ...page })).toBe('offline')
      // Its board's own network answer, generated now (the copy is an hour old) and stamped on arrival.
      const fresh = board({
        generatedAt: NOW + 3_600_000,
        rtSourceTimestamp: (NOW + 3_590_000) / 1000,
        receivedAt: Date.now(),
      })
      expect(liveState(fresh, { offline: false, nowMs: Date.now(), ...page })).toBeNull()
    },
  )

  it.each(SKEWS)('a polled answer is aged from its arrival (%i min)', (min) => {
    const page = loadPage({ skewMin: min })
    const polled = noteCacheCopy(new Response('{}'), board())
    expect(liveState(polled, { offline: false, nowMs: Date.now(), ...page })).toBeNull()
    pass(LIVE_REFRESH_MAX_AGE_MS + 1)
    expect(liveState(polled, { offline: false, nowMs: Date.now(), ...page })).toBe('stale')
  })

  it('a device clock corrected backwards never makes data younger (monotonic arrival times)', () => {
    const page = loadPage()
    const polled = noteCacheCopy(new Response('{}'), board())
    pass(70_000)
    // The device clock is set back 5 minutes (a correction): the data is still 70 s old.
    vi.setSystemTime(Date.now() - 5 * 60_000)
    expect(liveState(polled, { offline: false, nowMs: Date.now(), ...page })).toBe('stale')
    expect(polled.receivedAt).toBeLessThanOrEqual(deviceNow() - 70_000)
  })

  it('the source age shown ("updated 20 s ago") ignores the device clock', () => {
    for (const min of SKEWS) {
      const page = loadPage({ skewMin: min, sinceRequestMs: 0 })
      const clock = { nowMs: Date.now(), ...page }
      expect(sourceAgeS(board(), clock)).toBe(20)
      expect(Date.now() / 1000 - (sourceTimeS(board(), clock) ?? 0)).toBe(20)
    }
    expect(sourceTimeS(board({ rtSourceTimestamp: undefined }) as never, { nowMs: NOW })).toBeNull()
  })
})

describe('server render and hydration', () => {
  it.each(SKEWS)(
    'a real SSR + hydrateRoot of a board matches its HTML, then judges by the page (%i min)',
    async (min) => {
      const res = board({ generatedAt: NOW, rtSourceTimestamp: NOW / 1000 - 12 })
      function Board() {
        const page = usePageCheck()
        const state = liveState(res, { offline: false, nowMs: NOW + 300, ...page })
        return createElement(
          'p',
          null,
          `${state ?? 'LIVE'} ${formatAge(sourceTimeS(res, { nowMs: NOW + 300, ...page }), NOW + 300)}`,
        )
      }
      // The server renders with no PageCheck; the browser's device clock is `min` off.
      const markup = renderToString(createElement(Board))
      expect(markup).toContain('LIVE updated 12 s ago')
      loadPage({ skewMin: min, sinceRequestMs: 400 })
      const container = document.createElement('div')
      container.innerHTML = markup
      document.body.append(container)
      const errors: unknown[] = []
      await act(async () => {
        hydrateRoot(container, createElement(Board), { onRecoverableError: (e) => errors.push(e) })
      })
      expect(errors).toEqual([])
      // After hydration it judges by the page: requested 0.4 s ago, so still live, and no minutes of skew in the age.
      expect(container.textContent).toMatch(/^LIVE updated 1[23] s ago$/)
      container.remove()
    },
  )

  it.each(SKEWS)('judge with the server render time only, never the device clock (%i min)', (min) => {
    vi.useFakeTimers({ now: NOW + min * 60_000 })
    // No PageCheck (usePageCheck is null until hydrated): nowMs is the server's render time, as in the HTML.
    expect(liveState(board(), { offline: false, nowMs: NOW + 500 })).toBeNull()
    expect(liveState(board(), { offline: false, nowMs: NOW + 500, arrivedAt: null })).toBeNull()
  })
})

describe('"now" never lags (R15, the useNow false LIVE)', () => {
  it('a render after a reconnect judges age as of that render, not the last tick', () => {
    const page = loadPage()
    const polled = noteCacheCopy(new Response('{}'), board())
    const tick = Date.now() + 50_000
    // 70 s after the answer arrived; the board's last useNow tick was 20 s ago.
    pass(70_000)
    expect(liveState(polled, { offline: false, nowMs: tick, ...page })).toBe('stale')
  })

  it('the device "now" is only ever set against device times (receivedAt, arrivedAt)', () => {
    // Device clock 30 min fast. Hydrating (no arrivedAt), the server rule holds: Date.now() is not read against the
    // server's generatedAt, or this would be 'stale'.
    vi.useFakeTimers({ now: NOW + 30 * 60_000 })
    expect(liveState(board(), { offline: false, nowMs: NOW })).toBeNull()
    // After hydration: arrivedAt and receivedAt are device times, so 30 min of skew changes nothing.
    const page = loadPage({ skewMin: 30 })
    expect(liveState(board(), { offline: false, nowMs: NOW, ...page })).toBeNull()
    expect(liveState(board({ receivedAt: Date.now() }), { offline: false, nowMs: NOW, ...page })).toBeNull()
  })
})

describe('client navigations (stampNavigation)', () => {
  const nav =
    (data: object, type = 'data') =>
    async () => ({ 'routes/stop': { type, result: data } })

  it.each(SKEWS)('a network answer is stamped with the time its request was sent (%i min)', async (min) => {
    loadPage({ skewMin: min })
    const sent = deviceNow()
    const departures = board({ generatedAt: NOW + 30_000 })
    const alerts = { generatedAt: NOW + 30_000, alerts: [] }
    await stampNavigation(
      {},
      nav({
        renderedAt: NOW + 30_500,
        via: VIA_NETWORK,
        departures,
        alerts,
        stopId: '1',
        saved: { a: board() },
      }),
    )
    expect(departures).toMatchObject({ receivedAt: sent })
    expect(alerts).toMatchObject({ receivedAt: sent })
    expect(isOnline()).toBe(true)
  })

  it('stamps records of live responses (saved cards) too', async () => {
    loadPage()
    const card = board({ generatedAt: NOW + 30_000 })
    await stampNavigation(
      {},
      nav({ renderedAt: NOW + 30_500, via: VIA_NETWORK, initial: { a: card, b: null } }),
    )
    expect(card).toHaveProperty('receivedAt')
  })

  it('a stored copy (rendered no later than something this page has seen) is an offline copy', async () => {
    loadPage()
    // Rendered before this page: a copy from an earlier visit.
    const old = board({ generatedAt: NOW - 120_000 })
    await stampNavigation({}, nav({ renderedAt: NOW - 119_000, via: VIA_NETWORK, departures: old }))
    expect(old).toMatchObject({ offline: true })
    expect(old).not.toHaveProperty('receivedAt')
    expect(liveState(old, { offline: false, nowMs: Date.now(), ...loadPageCheck() })).toBe('offline')
    expect(isOnline()).toBe(false)
  })

  it('a copy fetched by an earlier navigation of this page is recognised when it comes back', async () => {
    loadPage()
    const first = {
      renderedAt: NOW + 20_000,
      via: VIA_NETWORK,
      departures: board({ generatedAt: NOW + 19_000 }),
    }
    await stampNavigation({}, nav(first))
    expect(first.departures).toHaveProperty('receivedAt')
    // The service worker hands back the very same render later.
    const again = {
      renderedAt: NOW + 20_000,
      via: VIA_NETWORK,
      departures: board({ generatedAt: NOW + 19_000 }),
    }
    await stampNavigation({}, nav(again))
    expect(again.departures).toMatchObject({ offline: true })
  })

  it('a copy older than a /v1 answer this page has had is recognised', async () => {
    loadPage()
    noteCacheCopy(new Response('{}'), board({ generatedAt: NOW + 60_000 }))
    reportOnline()
    const copy = {
      renderedAt: NOW + 30_000,
      via: VIA_NETWORK,
      departures: board({ generatedAt: NOW + 29_000 }),
    }
    await stampNavigation({}, nav(copy))
    expect(copy.departures).toMatchObject({ offline: true })
  })

  it('in a page that is itself a stored copy, nothing is fresh until a network answer', async () => {
    loadPage({ cached: true })
    const copy = {
      renderedAt: NOW + 600_000,
      via: VIA_NETWORK,
      departures: board({ generatedAt: NOW + 600_000 }),
    }
    await stampNavigation({}, nav(copy))
    expect(copy.departures).toMatchObject({ offline: true })
    // A network answer arrives (the connection is back): later navigations rendered after it are fresh.
    noteCacheCopy(new Response('{}'), board({ generatedAt: NOW + 3_600_000 }))
    reportOnline()
    const fresh = {
      renderedAt: NOW + 3_601_000,
      via: VIA_NETWORK,
      departures: board({ generatedAt: NOW + 3_601_000 }),
    }
    await stampNavigation({}, nav(fresh))
    expect(fresh.departures).toHaveProperty('receivedAt')
    expect(fresh.departures).not.toHaveProperty('offline')
  })

  it("another tab's copy, rendered after anything this page has seen, is still a copy (its body says so)", async () => {
    // Codex r1: tab B stored this .data at T+30 s; tab A navigates at T+150 s and the service worker falls back to it.
    loadPage()
    const copy = {
      renderedAt: NOW + 30_000,
      via: VIA_CACHE,
      departures: board({ generatedAt: NOW + 29_000 }),
    }
    pass(150_000)
    await stampNavigation({}, nav(copy))
    expect(copy.departures).toMatchObject({ offline: true })
    expect(copy.departures).not.toHaveProperty('receivedAt')
    expect(isOnline()).toBe(false)
  })

  it('a network answer after a copy is fresh and brings the connection back (no /v1 call between)', async () => {
    loadPage()
    reportOffline()
    expect(isOnline()).toBe(false)
    const fresh = {
      renderedAt: NOW + 40_000,
      via: VIA_NETWORK,
      departures: board({ generatedAt: NOW + 39_000 }),
    }
    await stampNavigation({}, nav(fresh))
    expect(fresh.departures).toHaveProperty('receivedAt')
    expect(fresh.departures).not.toHaveProperty('offline')
    expect(isOnline()).toBe(true)
  })

  it('live data without `via` or without a render time is a copy', async () => {
    loadPage()
    const noVia = { renderedAt: NOW + 30_000, departures: board() }
    await stampNavigation({}, nav(noVia))
    expect(noVia.departures).toMatchObject({ offline: true })
    const noTime = { via: VIA_NETWORK, departures: board() }
    await stampNavigation({}, nav(noTime))
    expect(noTime.departures).toMatchObject({ offline: true })
  })

  it('the service worker plugin marks a stored copy, and only the token changes', async () => {
    const body = `[{"_1":2,"_3":4},"via","${VIA_NETWORK}","renderedAt",${NOW}]`
    const out = await markCachedData.cachedResponseWillBeUsed({
      cachedResponse: new Response(body, {
        headers: { 'content-type': 'text/x-script', 'content-length': '99' },
      }),
    })
    expect(await out?.text()).toBe(body.replace(VIA_NETWORK, VIA_CACHE))
    expect(out?.headers.get('content-length')).toBeNull()
    expect(VIA_CACHE).toHaveLength(VIA_NETWORK.length)
    expect(await markCachedData.cachedResponseWillBeUsed({})).toBeUndefined()
  })

  it('leaves errors and data without live responses alone', async () => {
    loadPage()
    const about = { renderedAt: NOW - 1, siteUrl: 'x', mode: { fixtures: false, rt: null } }
    await stampNavigation({}, nav(about))
    expect(about).toEqual({ renderedAt: NOW - 1, siteUrl: 'x', mode: { fixtures: false, rt: null } })
    await stampNavigation({}, nav(new Error('x'), 'error'))
    expect(isOnline()).toBe(true)
  })
})

const loadPageCheck = () => renderHook(() => usePageCheck()).result.current
