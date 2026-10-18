// @vitest-environment jsdom
/** R2-B6 (offline copy choice) and R2-T7 (a cached render never claims LIVE before freshness is known). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  bestOfflineCopy,
  LIVE_REFRESH_MAX_AGE_MS,
  LIVE_UNCONFIRMED_ATTR,
  liveGuardScript,
  reportOffline,
  reportOnline,
} from '../src/connectivity.ts'

const NOW = Date.UTC(2026, 9, 18, 12, 40)
const html = document.documentElement
const run = (script: string) => new Function(script)()

afterEach(() => {
  html.removeAttribute(LIVE_UNCONFIRMED_ATTR)
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
  it('a live API call that reaches the network confirms freshness; a failed one does not', () => {
    html.setAttribute(LIVE_UNCONFIRMED_ATTR, '')
    reportOffline()
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(true)
    reportOnline()
    expect(html.hasAttribute(LIVE_UNCONFIRMED_ATTR)).toBe(false)
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
