// @vitest-environment jsdom
/**
 * THE-118 PR 3: the ferry board's alert count (modes/ferry-alerts.tsx) counts what the Alerts page's Ferry chip would,
 * links there, and keeps polling while the board stays open (Codex r1).
 */
import type { Alert, AlertsResponse } from '@bft/core/contract'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '../app/lib/query-client.ts'
import FerryAlerts from '../app/modes/ferry-alerts.tsx'

const alert = (over: Partial<Alert>): Alert => ({
  id: 'a',
  header: 'Notice',
  activePeriods: [],
  routes: [],
  stops: [],
  modes: ['ferry'],
  ...over,
})

const answer = (alerts: Alert[]): AlertsResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261020'],
  rtSourceTimestamp: 1,
  rtState: 'live',
  generatedAt: Date.now(),
  alerts,
})

afterEach(() => vi.useRealTimers())

function mount(fetcher: (path: string) => Promise<Response>) {
  const Stub = createRoutesStub([
    {
      path: '/ferry',
      Component: () => <FerryAlerts fetcher={fetcher} mode={{ fixtures: false, rt: null }} />,
    },
  ])
  render(
    <QueryClientProvider client={makeQueryClient()}>
      <Stub initialEntries={['/ferry']} />
    </QueryClientProvider>,
  )
}

describe('ferry board alert count', () => {
  it('counts ferry and network-wide alerts that are not over, links to Alerts on the Ferry chip, and polls', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const now = Date.now() / 1000
    let alerts = [
      alert({ id: 'f' }),
      alert({ id: 'all', modes: [] }),
      alert({ id: 'bus', modes: ['bus'] }),
      alert({ id: 'over', activePeriods: [{ start: now - 7200, end: now - 3600 }] }),
    ]
    const fetcher = vi.fn(async (path: string) => {
      expect(path).toBe('/v1/alerts')
      return new Response(JSON.stringify(answer(alerts)), { status: 200 })
    })
    mount(fetcher)
    const link = await screen.findByRole('link', { name: '2 alerts' })
    expect(link).toHaveAttribute('href', '/alerts?mode=ferry')
    alerts = [...alerts, alert({ id: 'new' })]
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    expect(await screen.findByRole('link', { name: '3 alerts' })).toBeInTheDocument()
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('a failed answer leaves a plain "Alerts" link', async () => {
    mount(async () => new Response('nope', { status: 503 }))
    expect(await screen.findByRole('link', { name: 'Alerts' })).toHaveAttribute('href', '/alerts?mode=ferry')
  })
})
