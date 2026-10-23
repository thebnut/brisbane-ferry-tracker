// @vitest-environment jsdom
/**
 * THE-118 PR 3 (Codex r6): the bus stop's alert count starts from the page's loader answer. A service-worker copy equal
 * to it makes TanStack keep the seed object, so the seed counts only until the query's first fetch.
 */
import { AlertCountLink, useCurrentAlerts } from '@bft/ui/alert-count'
import { noteCacheCopy, reportOnline, SW_CACHE_HEADER } from '@bft/ui/connectivity'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

const answer = () => ({ rtState: 'live', generatedAt: Date.now(), n: 1 })

afterEach(() => reportOnline())

describe('useCurrentAlerts with a seeded query (Codex r6)', () => {
  it("a service-worker copy equal to the page's loader answer is not counted once the connection is back", async () => {
    const seed = answer()
    let cached = false
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function Board() {
      const q = useQuery({
        queryKey: ['alerts'],
        queryFn: async () => {
          const body = JSON.stringify(seed)
          // The seed again from the service worker's cache (equal to it, so TanStack keeps the seed object), or a
          // network answer (stamped).
          const res = new Response(body, cached ? { headers: { [SW_CACHE_HEADER]: 'sw' } } : {})
          return noteCacheCopy(res, await res.json())
        },
        initialData: seed,
        staleTime: Infinity,
      })
      const current = useCurrentAlerts(q, seed)
      return <AlertCountLink count={current ? current.n : null} href="/alerts" />
    }
    render(
      <QueryClientProvider client={client}>
        <Board />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('link', { name: '1 alert' })).toBeInTheDocument()
    cached = true
    await act(() => client.refetchQueries({ queryKey: ['alerts'] }))
    expect(client.getQueryData(['alerts'])).toBe(seed)
    expect(await screen.findByRole('link', { name: 'Alerts' })).toBeInTheDocument()
    // Another request reached the network: still not counted.
    act(() => reportOnline())
    expect(screen.getByRole('link', { name: 'Alerts' })).toBeInTheDocument()
    // A network answer counts again.
    cached = false
    await act(() => client.refetchQueries({ queryKey: ['alerts'] }))
    expect(await screen.findByRole('link', { name: '1 alert' })).toBeInTheDocument()
  })
})
