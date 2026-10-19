// @vitest-environment jsdom
/**
 * R8-T1 (Codex review): with nothing saved, a home from the device's copy confirms itself with its own network answer,
 * and needs a new one after every disconnect: a browser `online` event alone never restores LIVE.
 */
import { reportOnline } from '@bft/ui/connectivity'
import { act, render, screen, waitFor } from '@testing-library/react'
import { createRoutesStub } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReachedNetwork } from '../app/routes/saved.tsx'

function Probe() {
  return <p data-testid="reached">{String(useReachedNetwork(true))}</p>
}

const setOnLine = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
  window.dispatchEvent(new Event(value ? 'online' : 'offline'))
}

afterEach(() => {
  setOnLine(true)
  reportOnline()
  vi.unstubAllGlobals()
})

describe('useReachedNetwork', () => {
  it('needs its own network answer, again after every disconnect', async () => {
    let answering = true
    const fetch = vi.fn(async () => {
      if (!answering) throw new TypeError('Failed to fetch')
      return Response.json({ alerts: [] })
    })
    vi.stubGlobal('fetch', fetch)
    const Stub = createRoutesStub([{ path: '/', Component: Probe }])
    render(<Stub initialEntries={['/']} />)
    await waitFor(() => expect(screen.getByTestId('reached').textContent).toBe('true'))
    const calls = fetch.mock.calls.length

    // Offline, then the browser says online while the API still can't be reached: not confirmed.
    answering = false
    act(() => setOnLine(false))
    await waitFor(() => expect(screen.getByTestId('reached').textContent).toBe('false'))
    act(() => setOnLine(true))
    await waitFor(() => expect(fetch.mock.calls.length).toBeGreaterThan(calls))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByTestId('reached').textContent).toBe('false')

    // The API answers again: confirmed at the next reconnect (onReconnect refetches at most once a second).
    answering = true
    await new Promise((r) => setTimeout(r, 1_100))
    act(() => setOnLine(true))
    await waitFor(() => expect(screen.getByTestId('reached').textContent).toBe('true'))
  })
})
