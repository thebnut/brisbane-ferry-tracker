// @vitest-environment jsdom
/**
 * THE-118 PR 3 (Codex r4): a board header counts alerts only from a current answer, so an old, open-ended alert never
 * stays up as "1 alert" while its refetches fail. Otherwise the link says plain "Alerts".
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AlertCountLink, isCurrentAlerts, useCurrentAlerts } from '../src/AlertCountLink.tsx'
import {
  noteCacheCopy,
  type PageCheck,
  reportOffline,
  reportOnline,
  SW_CACHE_HEADER,
} from '../src/connectivity.ts'

const NOW = Date.UTC(2026, 9, 23, 9, 0)
const answer = (over: Partial<{ rtState: string; generatedAt: number; offline: boolean }> = {}) => ({
  rtState: 'live',
  generatedAt: NOW,
  ...over,
})
const page: PageCheck = { unconfirmedBefore: null, arrivedAt: 0 }
const ok = { isError: false, online: true, page }

afterEach(() => reportOnline())

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

  it('not for a service-worker copy, an offline copy, or while offline', () => {
    const cached = noteCacheCopy(new Response('{}', { headers: { [SW_CACHE_HEADER]: 'sw' } }), answer())
    expect(isCurrentAlerts(cached, ok)).toBe(false)
    expect(isCurrentAlerts(answer({ offline: true }), ok)).toBe(false)
    expect(isCurrentAlerts(answer(), { ...ok, online: false })).toBe(false)
    reportOffline()
    expect(isCurrentAlerts(answer(), ok)).toBe(false)
  })

  it('not for data that came with a page loaded from a cache, nor before hydration', () => {
    const unconfirmed = { ...ok, page: { unconfirmedBefore: NOW + 10_000, arrivedAt: 0 } }
    expect(isCurrentAlerts(answer(), unconfirmed)).toBe(false)
    expect(isCurrentAlerts(answer({ generatedAt: NOW + 20_000 }), unconfirmed)).toBe(true)
    expect(isCurrentAlerts(answer(), { ...ok, page: null })).toBe(false)
    expect(isCurrentAlerts(undefined, ok)).toBe(false)
  })
})

function Count({ data, isError }: { data?: ReturnType<typeof answer> & { n: number }; isError: boolean }) {
  const current = useCurrentAlerts({ data, isError })
  return <AlertCountLink count={current ? current.n : null} href="/alerts" />
}

describe('useCurrentAlerts', () => {
  it('a number only while the answer is current, else plain "Alerts", linking to the alerts either way', () => {
    const { rerender } = render(<Count data={{ ...answer(), n: 1 }} isError={false} />)
    expect(screen.getByRole('link', { name: '1 alert' })).toHaveAttribute('href', '/alerts')
    rerender(<Count data={{ ...answer(), n: 1 }} isError />)
    expect(screen.getByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts')
    rerender(<Count data={{ ...answer({ rtState: 'unavailable' }), n: 1 }} isError={false} />)
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
  })
})
