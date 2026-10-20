// @vitest-environment jsdom
/**
 * R15-S1: a fresh page must never look offline, delayed or live because of the device clock. Ages are measured
 * server time against server time and device time against device time; data in the page's HTML is aged from when
 * the page was requested (PageCheck.arrivedAt), an upper bound on its real age. Also the useNow false LIVE: "now" is
 * read at each judgement, never a tick that can be 15 s old.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isOnline,
  LIVE_REFRESH_MAX_AGE_MS,
  LIVE_UNCONFIRMED_ATTR,
  liveState,
  noteCacheCopy,
  RENDER_MARGIN_MS,
  reportOnline,
  resetNavigationStamps,
  resetUnconfirmedBefore,
  sourceAgeS,
  sourceTimeS,
  stampNavigation,
  usePageCheck,
} from '../src/connectivity.ts'

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

/**
 * A page requested `sinceRequestMs` ago (monotonic) on a device whose clock is `skewMin` off the server's. Returns
 * its PageCheck as the app sees it after hydration.
 */
function loadPage({ skewMin = 0, sinceRequestMs = 1_500, cached = false } = {}) {
  vi.useFakeTimers({ now: NOW + skewMin * 60_000 + sinceRequestMs })
  vi.spyOn(performance, 'now').mockReturnValue(sinceRequestMs)
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
    vi.advanceTimersByTime(LIVE_REFRESH_MAX_AGE_MS + 1)
    expect(liveState(polled, { offline: false, nowMs: Date.now(), ...page })).toBe('stale')
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
    vi.advanceTimersByTime(70_000)
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
    const sent = Date.now()
    const departures = board({ generatedAt: NOW + 30_000 })
    const alerts = { generatedAt: NOW + 30_000, alerts: [] }
    await stampNavigation(
      {},
      nav({ renderedAt: NOW + 30_500, departures, alerts, stopId: '1', saved: { a: board() } }),
    )
    expect(departures).toMatchObject({ receivedAt: sent })
    expect(alerts).toMatchObject({ receivedAt: sent })
    expect(isOnline()).toBe(true)
  })

  it('stamps records of live responses (saved cards) too', async () => {
    loadPage()
    const card = board({ generatedAt: NOW + 30_000 })
    await stampNavigation({}, nav({ renderedAt: NOW + 30_500, initial: { a: card, b: null } }))
    expect(card).toHaveProperty('receivedAt')
  })

  it('a stored copy (rendered no later than something this page has seen) is an offline copy', async () => {
    loadPage()
    // Rendered before this page: a copy from an earlier visit.
    const old = board({ generatedAt: NOW - 120_000 })
    await stampNavigation({}, nav({ renderedAt: NOW - 119_000, departures: old }))
    expect(old).toMatchObject({ offline: true })
    expect(old).not.toHaveProperty('receivedAt')
    expect(liveState(old, { offline: false, nowMs: Date.now(), ...loadPageCheck() })).toBe('offline')
    expect(isOnline()).toBe(false)
  })

  it('a copy fetched by an earlier navigation of this page is recognised when it comes back', async () => {
    loadPage()
    const first = { renderedAt: NOW + 20_000, departures: board({ generatedAt: NOW + 19_000 }) }
    await stampNavigation({}, nav(first))
    expect(first.departures).toHaveProperty('receivedAt')
    // The service worker hands back the very same render later.
    const again = { renderedAt: NOW + 20_000, departures: board({ generatedAt: NOW + 19_000 }) }
    await stampNavigation({}, nav(again))
    expect(again.departures).toMatchObject({ offline: true })
  })

  it('a copy older than a /v1 answer this page has had is recognised', async () => {
    loadPage()
    noteCacheCopy(new Response('{}'), board({ generatedAt: NOW + 60_000 }))
    reportOnline()
    const copy = { renderedAt: NOW + 30_000, departures: board({ generatedAt: NOW + 29_000 }) }
    await stampNavigation({}, nav(copy))
    expect(copy.departures).toMatchObject({ offline: true })
  })

  it('in a page that is itself a stored copy, nothing is fresh until a network answer', async () => {
    loadPage({ cached: true })
    const copy = { renderedAt: NOW + 600_000, departures: board({ generatedAt: NOW + 600_000 }) }
    await stampNavigation({}, nav(copy))
    expect(copy.departures).toMatchObject({ offline: true })
    // A network answer arrives (the connection is back): later navigations rendered after it are fresh.
    noteCacheCopy(new Response('{}'), board({ generatedAt: NOW + 3_600_000 }))
    reportOnline()
    const fresh = { renderedAt: NOW + 3_601_000, departures: board({ generatedAt: NOW + 3_601_000 }) }
    await stampNavigation({}, nav(fresh))
    expect(fresh.departures).toHaveProperty('receivedAt')
    expect(fresh.departures).not.toHaveProperty('offline')
  })

  it('nothing is fresh while the connection is known to be down, or without a render time', async () => {
    loadPage()
    window.dispatchEvent(new Event('offline'))
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const down = { renderedAt: NOW + 30_000, departures: board() }
    await stampNavigation({}, nav(down))
    expect(down.departures).toMatchObject({ offline: true })
    vi.restoreAllMocks()
    loadPage()
    const unknown = { departures: board() }
    await stampNavigation({}, nav(unknown))
    expect(unknown.departures).toMatchObject({ offline: true })
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
