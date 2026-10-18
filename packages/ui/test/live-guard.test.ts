// @vitest-environment jsdom
/** R2-B6 (offline copy choice) and R2-T7 (a cached render never claims LIVE before freshness is known). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bestOfflineCopy,
  confirmLive,
  LIVE_REFRESH_MAX_AGE_MS,
  LIVE_UNCONFIRMED_ATTR,
  liveGuardScript,
  markCachedPages,
  reportOffline,
  reportOnline,
  trackedFetch,
} from '../src/connectivity.ts'

const NOW = Date.UTC(2026, 9, 18, 12, 40)
const html = document.documentElement
const run = (script: string) => new Function(script)()

afterEach(() => {
  html.removeAttribute(LIVE_UNCONFIRMED_ATTR)
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
  it('only a good live answer from the network confirms freshness (Codex review: a 503 does not)', async () => {
    html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
    reportOffline()
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }))
    await trackedFetch('/v1/bus/stops/1/departures')
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
    vi.stubGlobal('fetch', async () => new Response('{}', { headers: { 'x-bft-cache': 'sw' } }))
    await trackedFetch('/v1/bus/stops/1/departures')
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
    // Static data files say nothing about live freshness.
    vi.stubGlobal('fetch', async () => new Response('{}'))
    await trackedFetch('/data/bus/stops.json')
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
    await trackedFetch('/v1/bus/stops/1/departures')
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(false)
    html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
    confirmLive()
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(false)
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
  it('prefers the copy with more departures to come, then the newest', () => {
    const short = copy(NOW - 60_000, [120])
    const saved = copy(NOW - 3 * 3600_000, [120, 600, 1200, 1800])
    expect(bestOfflineCopy([short, saved], NOW)).toBe(saved)
    const older = copy(NOW - 120_000, [120, 600])
    const newer = copy(NOW - 60_000, [120, 600])
    expect(bestOfflineCopy([older, newer], NOW)).toBe(newer)
    expect(bestOfflineCopy([newer, older], NOW)).toBe(newer)
  })
  it('returns an empty copy rather than nothing, and null with no copies', () => {
    const gone = copy(NOW - 60_000, [-60])
    expect(bestOfflineCopy([null, gone, undefined], NOW)).toBe(gone)
    expect(bestOfflineCopy([null, undefined], NOW)).toBeNull()
  })
})
