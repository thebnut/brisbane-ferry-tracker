// @vitest-environment node
/**
 * R32-RT1: awaitingSeedAnswer against a real TanStack QueryClient, configured as every board's query is (a non-live
 * seed with seedUpdatedAt, retry 1): the board waits while its mount refetch is out and is judged once it answers.
 */
import { awaitingSeedAnswer, pagePending, seedUpdatedAt } from '@bft/ui/connectivity'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

const seed = { generatedAt: 5_000, rtState: 'stale' }

function observe(queryFn: () => Promise<typeof seed>, key = 'board', initial: typeof seed | null = seed) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 10_000, networkMode: 'offlineFirst' } },
  })
  const observer = new QueryObserver(client, {
    queryKey: [key],
    queryFn,
    initialData: initial ?? undefined,
    initialDataUpdatedAt: seedUpdatedAt(initial),
  })
  // Subscribing is the board mounting: a seed updated at 0 is stale, so it refetches at once.
  const off = observer.subscribe(() => {})
  return { observer, off }
}

const waiting = (o: QueryObserver<typeof seed>) => awaitingSeedAnswer(o.getCurrentResult(), 'stale')

afterEach(() => vi.useRealTimers())

describe('a non-live seed and its own first answer (R32-RT1)', () => {
  it('waits while the mount refetch is in flight, the server render included', () => {
    const { observer, off } = observe(() => new Promise(() => {}))
    expect(observer.getCurrentResult().isFetching).toBe(true)
    expect(waiting(observer)).toBe(true)
    off()
  })

  it('is judged on its own answer once it arrives, live or not', async () => {
    for (const rtState of ['live', 'stale']) {
      let answer: (v: typeof seed) => void = () => {}
      const { observer, off } = observe(() => new Promise((r) => (answer = r)))
      answer({ generatedAt: 6_000, rtState })
      await vi.waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(false))
      expect(observer.getCurrentResult().data?.rtState).toBe(rtState)
      expect(waiting(observer)).toBe(false)
      off()
    }
  })

  it('stops waiting at the first failure, while TanStack retries', async () => {
    vi.useFakeTimers()
    const { observer, off } = observe(() => Promise.reject(new TypeError('Failed to fetch')))
    await vi.advanceTimersByTimeAsync(10)
    // Retrying (retry 1, a second's delay): still fetching, but the board is judged on its seed: not pending.
    expect(observer.getCurrentResult().isFetching).toBe(true)
    expect(waiting(observer)).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(observer.getCurrentResult().isError).toBe(true)
    expect(waiting(observer)).toBe(false)
    off()
  })

  it("a waiting seed never hides another board's HTTP failure (Codex r1)", async () => {
    vi.useFakeTimers()
    const waits = observe(() => new Promise(() => {}))
    // Another board without a seed whose request fails with an HTTP error (the connection flag stays online).
    const fails = observe(() => Promise.reject(new Error('HTTP 503')), 'other', null)
    const page = () =>
      pagePending([
        { q: waits.observer.getCurrentResult(), state: 'stale' },
        { q: fails.observer.getCurrentResult(), state: null },
      ])
    expect(page()).toBe(true)
    // The first failure, while TanStack retries, and then the error.
    await vi.advanceTimersByTimeAsync(10)
    expect(page()).toBe(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fails.observer.getCurrentResult().isError).toBe(true)
    expect(page()).toBe(false)
    waits.off()
    fails.off()
  })
})
