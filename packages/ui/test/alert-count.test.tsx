// @vitest-environment jsdom
/**
 * THE-118 PR 3 (Codex r4): a board header counts alerts only from a current answer, so an old, open-ended alert never
 * stays up as "1 alert" while its refetches fail. Otherwise the link says plain "Alerts".
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALERTS_MAX_AGE_MS,
  AlertCountLink,
  isCurrentAlerts,
  useCurrentAlerts,
} from '../src/AlertCountLink.tsx'
import {
  deviceNow,
  noteCacheCopy,
  type PageCheck,
  reportOnline,
  SW_CACHE_HEADER,
} from '../src/connectivity.ts'

const NOW = Date.UTC(2026, 9, 23, 9, 0)
const answer = (
  over: Partial<{ rtState: string; generatedAt: number; offline: boolean; receivedAt: number }> = {},
) => ({
  rtState: 'live',
  generatedAt: NOW,
  // Stamped on arrival (noteCacheCopy): a network answer.
  receivedAt: 1,
  ...over,
})
const page: PageCheck = { unconfirmedBefore: null, arrivedAt: 0 }
// Just after the answer arrived, on the device's clock.
const ok = { isError: false, online: true, page, now: 1 }

afterEach(() => {
  reportOnline()
  vi.useRealTimers()
})

describe('isCurrentAlerts', () => {
  it('counts a live network answer whose latest fetch succeeded', () => {
    expect(isCurrentAlerts(answer(), ok)).toBe(true)
  })

  it('not when the latest fetch failed, even with the old answer still held (the stale seed, then a failed refetch)', () => {
    expect(isCurrentAlerts(answer(), { ...ok, isError: true })).toBe(false)
  })

  it('not when the answer is not live', () => {
    for (const rtState of ['stale', 'reloading', 'unavailable', 'scheduled'])
      expect(isCurrentAlerts(answer({ rtState }), ok), rtState).toBe(false)
  })

  it('not for a service-worker copy (or any copy of one), an offline copy, or while offline', () => {
    const { receivedAt: _, ...unstamped } = answer()
    const cached = noteCacheCopy(new Response('{}', { headers: { [SW_CACHE_HEADER]: 'sw' } }), unstamped)
    expect(isCurrentAlerts(cached, ok)).toBe(false)
    // TanStack's structural sharing may store a copy of it: still not counted (Codex r5).
    expect(isCurrentAlerts({ ...cached }, ok)).toBe(false)
    // A network answer is stamped, and so is the copy TanStack keeps.
    const network = noteCacheCopy(new Response('{}'), { ...unstamped })
    expect(isCurrentAlerts({ ...network }, { ...ok, now: deviceNow() })).toBe(true)
    expect(isCurrentAlerts(answer({ offline: true }), ok)).toBe(false)
    expect(isCurrentAlerts(answer(), { ...ok, online: false })).toBe(false)
  })

  it('not for data that came with a page loaded from a cache, nor before hydration', () => {
    const unconfirmed = { ...ok, page: { unconfirmedBefore: NOW + 10_000, arrivedAt: 0 } }
    expect(isCurrentAlerts(answer(), unconfirmed)).toBe(false)
    expect(isCurrentAlerts(answer({ generatedAt: NOW + 20_000 }), unconfirmed)).toBe(true)
    expect(isCurrentAlerts(answer(), { ...ok, page: null })).toBe(false)
    expect(isCurrentAlerts(undefined, ok)).toBe(false)
  })

  it("a page's own loader answer counts without an arrival stamp", () => {
    const { receivedAt: _, ...seed } = answer()
    expect(isCurrentAlerts(seed, ok)).toBe(false)
    expect(isCurrentAlerts(seed, { ...ok, seeded: true })).toBe(true)
    expect(isCurrentAlerts(seed, { ...ok, seeded: true, isError: true })).toBe(false)
  })

  it('only while recent: up to ALERTS_MAX_AGE_MS after it reached the device, on the device clock', () => {
    const at = { ...ok, now: 1 + ALERTS_MAX_AGE_MS }
    expect(isCurrentAlerts(answer(), at)).toBe(true)
    expect(isCurrentAlerts(answer(), { ...at, now: at.now + 1 })).toBe(false)
    // The Codex release review's case: a four-minute-old answer.
    expect(isCurrentAlerts(answer(), { ...ok, now: 1 + 4 * 60_000 })).toBe(false)
    // Never by a server time: an answer generated long ago but just received counts; one generated "in the future" by
    // a skewed server clock but received long ago doesn't.
    expect(isCurrentAlerts(answer({ generatedAt: 0 }), ok)).toBe(true)
    expect(isCurrentAlerts(answer({ generatedAt: 1e15 }), { ...ok, now: 1e6 })).toBe(false)
  })

  it("a page's loader seed is aged from when the page was requested (PageCheck.arrivedAt)", () => {
    const { receivedAt: _, ...seed } = answer()
    const seeded = { ...ok, seeded: true, page: { unconfirmedBefore: null, arrivedAt: 5_000 } }
    expect(isCurrentAlerts(seed, { ...seeded, now: 5_000 + ALERTS_MAX_AGE_MS })).toBe(true)
    expect(isCurrentAlerts(seed, { ...seeded, now: 5_001 + ALERTS_MAX_AGE_MS })).toBe(false)
    // Its own arrival stamp (a client navigation's, stampNavigation) wins.
    expect(
      isCurrentAlerts({ ...seed, receivedAt: 200_000 }, { ...seeded, now: 200_000 + ALERTS_MAX_AGE_MS }),
    ).toBe(true)
  })
})

function Count({ data, isError }: { data?: ReturnType<typeof answer> & { n: number }; isError: boolean }) {
  const current = useCurrentAlerts({ data, isError })
  return <AlertCountLink count={current ? current.n : null} href="/alerts" />
}

describe('useCurrentAlerts', () => {
  it('a number only while the answer is current, else plain "Alerts", linking to the alerts either way', () => {
    const fresh = { ...answer({ receivedAt: deviceNow() }), n: 1 }
    const { rerender } = render(<Count data={fresh} isError={false} />)
    expect(screen.getByRole('link', { name: '1 alert' })).toHaveAttribute('href', '/alerts')
    rerender(<Count data={fresh} isError />)
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts')
    rerender(<Count data={{ ...fresh, rtState: 'unavailable' }} isError={false} />)
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
  })

  it('goes back to "Alerts" as the answer gets too old, without a poll or any other render', () => {
    vi.useFakeTimers()
    const data = { ...answer({ receivedAt: deviceNow() }), n: 2 }
    render(<Count data={data} isError={false} />)
    expect(screen.getByRole('link', { name: '2 alerts' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(ALERTS_MAX_AGE_MS - 1_000))
    expect(screen.getByRole('link', { name: '2 alerts' })).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1_001))
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
  })

  it('checks again when the tab is shown, whose timers ran late while hidden', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    render(<Count data={{ ...answer({ receivedAt: deviceNow() }), n: 1 }} isError={false} />)
    expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()
    // Four minutes pass with no timer run (a hidden tab).
    vi.setSystemTime(Date.now() + 4 * 60_000)
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
  })
})
