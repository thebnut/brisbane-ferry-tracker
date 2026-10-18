// @vitest-environment jsdom
/** R2-B6 (offline copy choice) and R2-T7 (a cached render never claims LIVE before freshness is known). */
import { render, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bestOfflineCopy,
  LIVE_REFRESH_MAX_AGE_MS,
  LIVE_UNCONFIRMED_ATTR,
  liveGuardScript,
  liveState,
  markCachedPages,
  RENDER_MARGIN_MS,
  reportOnline,
  resetUnconfirmedBefore,
  useLiveGuardRelease,
  useUnconfirmedBefore,
} from '../src/connectivity.ts'

const NOW = Date.UTC(2026, 9, 18, 12, 40)
const html = document.documentElement
const run = (script: string) => new Function(script)()

afterEach(() => {
  html.removeAttribute(LIVE_UNCONFIRMED_ATTR)
  resetUnconfirmedBefore()
  delete (window as { __bftRenderedAt?: number }).__bftRenderedAt
  reportOnline()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('liveGuardScript (R2-T7)', () => {
  it('leaves a freshly rendered page alone while online', () => {
    vi.useFakeTimers({ now: NOW })
    run(liveGuardScript(NOW - 2_000))
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(false)
  })
  it('marks HTML rendered over a minute ago (a service-worker copy) as unconfirmed', () => {
    vi.useFakeTimers({ now: NOW })
    run(liveGuardScript(NOW - LIVE_REFRESH_MAX_AGE_MS - 1))
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
  })
  it('marks any page loaded while the browser is offline', () => {
    vi.useFakeTimers({ now: NOW })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    run(liveGuardScript(NOW))
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
  })
  it('records the render time for the per-board cutoff', () => {
    vi.useFakeTimers({ now: NOW })
    run(liveGuardScript(NOW - 2_000))
    expect((window as { __bftRenderedAt?: number }).__bftRenderedAt).toBe(NOW - 2_000)
  })
  it('the CSS guard lifts once the app has rendered its own judgement', async () => {
    html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
    function App() {
      useLiveGuardRelease()
      return null
    }
    render(createElement(App))
    await vi.waitFor(() => expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(false))
  })
  it('a page served from the service worker cache arrives marked, whatever its age (serialised plugin)', async () => {
    const source = String(markCachedPages.cachedResponseWillBeUsed).replace(/\s*\n\s*/g, ' ')
    const fn = new Function(`return (${source})`)() as typeof markCachedPages.cachedResponseWillBeUsed
    const page =
      '<!DOCTYPE html><html lang="en-AU" class="dark"><head></head><body><span data-live-claim="">LIVE</span></body></html>'
    const marked = await fn({
      cachedResponse: new Response(page, {
        status: 200,
        headers: {
          'content-type': 'text/html',
          'content-length': String(page.length),
          'content-encoding': 'gzip',
        },
      }),
    })
    const text = (await marked?.text()) ?? ''
    expect(text).toContain('<html data-live-unconfirmed="" lang="en-AU" class="dark">')
    expect(text.match(/data-live-unconfirmed/g)).toHaveLength(1)
    expect(marked?.headers.get('content-type')).toBe('text/html')
    expect(marked?.headers.get('content-length')).toBeNull()
    expect(marked?.headers.get('content-encoding')).toBeNull()
    expect(await fn({})).toBeUndefined()
  })
  it('is a constant expression of numbers (no injected text)', () => {
    expect(liveGuardScript(NOW + 0.7)).toContain(`Date.now()-${NOW}>`)
  })
})

describe('per-board confirmation after a cached page (R2-T7, Codex review rounds 2 and 3)', () => {
  const RENDERED = NOW - 20_000
  const board = (generatedAt: number) => ({
    rtState: 'live',
    rtSourceTimestamp: NOW / 1000 - 10,
    generatedAt,
  })
  const cachedPage = () => {
    ;(window as { __bftRenderedAt?: number }).__bftRenderedAt = RENDERED
    html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
    resetUnconfirmedBefore()
  }

  it('a fresh page has no cutoff; a cached one cuts off what came with its render', () => {
    resetUnconfirmedBefore()
    expect(renderHook(() => useUnconfirmedBefore()).result.current).toBeNull()
    cachedPage()
    expect(renderHook(() => useUnconfirmedBefore()).result.current).toBe(RENDERED + RENDER_MARGIN_MS)
    // Read once at load: lifting the CSS guard later doesn't change it.
    html.removeAttribute(LIVE_UNCONFIRMED_ATTR)
    expect(renderHook(() => useUnconfirmedBefore()).result.current).toBe(RENDERED + RENDER_MARGIN_MS)
  })

  it('a 20-second-old cached board is an offline copy, whatever other calls answer; its own fresh data is live', () => {
    cachedPage()
    const cutoff = renderHook(() => useUnconfirmedBefore()).result.current
    // Both boards came with the cached HTML (one generated a few seconds after the root's clock read).
    const a = board(RENDERED - 300)
    const b = board(RENDERED + 3_000)
    expect(liveState(a, { offline: false, nowMs: NOW, unconfirmedBefore: cutoff })).toBe('offline')
    expect(liveState(b, { offline: false, nowMs: NOW, unconfirmedBefore: cutoff })).toBe('offline')
    // Board A's own answer arrives (generated now); board B is still the cached copy.
    expect(liveState(board(NOW - 200), { offline: false, nowMs: NOW, unconfirmedBefore: cutoff })).toBeNull()
    expect(liveState(b, { offline: false, nowMs: NOW, unconfirmedBefore: cutoff })).toBe('offline')
    // On a fresh page the same 20-second-old data is live (the usual one-minute rule).
    expect(liveState(a, { offline: false, nowMs: NOW, unconfirmedBefore: null })).toBeNull()
  })

  it('an unmarked page without a recorded render time still cuts off everything already on hand', () => {
    html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
    resetUnconfirmedBefore()
    expect(renderHook(() => useUnconfirmedBefore()).result.current).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('bestOfflineCopy (R2-B6)', () => {
  const nowS = NOW / 1000
  const copy = (generatedAt: number, offsets: number[]) => ({
    generatedAt,
    departures: offsets.map((o) => ({ schedDep: nowS + o })),
  })
  it('keeps the board on screen over an hours-old service-worker answer whose rows have all gone', () => {
    const shown = copy(NOW - 60_000, [120, 600, 1200])
    const sw = copy(NOW - 94 * 60_000, [-5000, -4000, -3000, -2000])
    expect(bestOfflineCopy([shown, sw], NOW)).toBe(shown)
  })
  it('never goes back to an older body; a longer older copy only extends it (R6-B1)', () => {
    const short = copy(NOW - 60_000, [120])
    const saved = copy(NOW - 3 * 3600_000, [120, 600, 1200, 1800])
    const merged = bestOfflineCopy([short, saved], NOW)
    expect(merged?.generatedAt).toBe(short.generatedAt)
    expect(merged?.departures.map((d) => d.schedDep - nowS)).toEqual([120, 600, 1200, 1800])
    // Codex review: an hour-old answer with more rows must not replace a newer one-row board.
    const board = copy(NOW - 30_000, [300])
    const old = copy(NOW - 3600_000, [120, 300])
    expect(bestOfflineCopy([old, board], NOW)).toBe(board)
    const older = copy(NOW - 120_000, [120, 600])
    const newer = copy(NOW - 60_000, [120, 600])
    expect(bestOfflineCopy([older, newer], NOW)).toBe(newer)
    expect(bestOfflineCopy([newer, older], NOW)).toBe(newer)
  })
  it('a newer board whose rows ran out keeps its body and Updated time; an older timetable only adds rows (Codex review)', () => {
    const gone = copy(NOW - 30_000, [-120])
    const saved = copy(NOW - 3600_000, [-600, 120, 600])
    const out = bestOfflineCopy([saved, gone], NOW)
    expect(out?.generatedAt).toBe(gone.generatedAt)
    expect(out?.departures.map((d) => d.schedDep - nowS)).toEqual([-120, 120, 600])
    const empty = copy(NOW - 30_000, [])
    expect(bestOfflineCopy([saved, empty], NOW)?.generatedAt).toBe(empty.generatedAt)
  })
  it('returns an empty copy rather than nothing, and null with no copies', () => {
    const gone = copy(NOW - 60_000, [-60])
    expect(bestOfflineCopy([null, gone, undefined], NOW)).toBe(gone)
    expect(bestOfflineCopy([null, undefined], NOW)).toBeNull()
  })
})
