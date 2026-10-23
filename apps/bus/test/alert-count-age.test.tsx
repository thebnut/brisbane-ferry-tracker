// @vitest-environment jsdom
/**
 * The board's alert count shows a number only while the answer is recent (ALERTS_MAX_AGE_MS, Codex release review of
 * f943ff5): an answer kept while polling paused (a hidden tab) or in the query cache (a board mounted again) says
 * "Alerts" until a fresh one arrives, instead of its old number while the refetch is pending.
 */
import type { AlertsResponse } from '@bft/core/contract'
import { AlertCountLink, useCurrentAlerts } from '@bft/ui/alert-count'
import { reportOnline } from '@bft/ui/connectivity'
import { focusManager, type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiFetcher } from '../app/lib/api.ts'
import { makeQueryClient, useAlerts } from '../app/lib/queries.ts'

const body = (n: number) =>
  ({
    schemaVersion: 1,
    staticGeneration: 'g',
    rtSourceTimestamp: 1,
    rtState: 'live',
    generatedAt: Date.now(),
    alerts: Array.from({ length: n }, (_, i) => ({ id: `a${i}` })),
  }) as unknown as AlertsResponse

/** A fetcher whose next answers are held until `release()`. */
function heldFetcher() {
  let hold: Promise<void> | null = null
  let release = () => {}
  const calls = vi.fn()
  const fetcher: ApiFetcher = async () => {
    calls()
    if (hold) await hold
    return Response.json(body(1))
  }
  return {
    fetcher,
    calls,
    holdNext() {
      hold = new Promise((r) => {
        release = r
      })
    },
    release: () => {
      hold = null
      release()
    },
  }
}

function Board({ fetcher }: { fetcher: ApiFetcher }) {
  const current = useCurrentAlerts(useAlerts(fetcher, { fixtures: false, rt: null }))
  return <AlertCountLink count={current ? current.alerts.length : null} href="/alerts" />
}

let visibility: DocumentVisibilityState = 'visible'
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
function setVisibility(v: DocumentVisibilityState) {
  visibility = v
  // As a browser fires it: bubbling to window, where TanStack's focus manager listens.
  document.dispatchEvent(new Event('visibilitychange', { bubbles: true }))
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(10))
const mount = (client: QueryClient, fetcher: ApiFetcher) =>
  render(
    <QueryClientProvider client={client}>
      <Board fetcher={fetcher} />
    </QueryClientProvider>,
  )

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  visibility = 'visible'
  focusManager.setFocused(undefined)
  reportOnline()
})

describe('alert count age limit (real QueryClient)', () => {
  it('a tab shown again after four minutes hidden says "Alerts" while its refetch is pending, then the number', async () => {
    vi.useFakeTimers()
    const api = heldFetcher()
    mount(makeQueryClient(), api.fetcher)
    await settle()
    expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()

    // Hidden: polling pauses (refetchIntervalInBackground false).
    act(() => setVisibility('hidden'))
    const before = api.calls.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(4 * 60_000))
    expect(api.calls).toHaveBeenCalledTimes(before)

    // Shown again: TanStack refetches on focus; until that answer lands the old one is too old to count.
    api.holdNext()
    act(() => setVisibility('visible'))
    await settle()
    expect(api.calls).toHaveBeenCalledTimes(before + 1)
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()

    api.release()
    await settle()
    expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()
  })

  it('a board mounted again on a cached answer three minutes old says "Alerts" until its refetch lands', async () => {
    vi.useFakeTimers()
    const api = heldFetcher()
    const client = makeQueryClient()
    const first = mount(client, api.fetcher)
    await settle()
    expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()
    first.unmount()

    // Another page for three minutes; the answer stays in the query cache (gcTime 5 min).
    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000))
    api.holdNext()
    mount(client, api.fetcher)
    await settle()
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()

    api.release()
    await settle()
    expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()
  })

  it('a board polling as usual keeps its number from one answer to the next', async () => {
    vi.useFakeTimers()
    const api = heldFetcher()
    mount(makeQueryClient(), api.fetcher)
    await settle()
    for (let i = 0; i < 5; i++) {
      // Each answer slow to arrive (the 8 s request timeout's worth): the number stays.
      api.holdNext()
      await act(() => vi.advanceTimersByTimeAsync(60_000))
      await act(() => vi.advanceTimersByTimeAsync(7_990))
      expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()
      api.release()
      await settle()
    }
    expect(screen.getByRole('link', { name: '1 alert' })).toBeInTheDocument()
  })
})
