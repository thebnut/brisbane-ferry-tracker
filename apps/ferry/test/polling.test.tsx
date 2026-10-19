// @vitest-environment jsdom
import type { DeparturesResponse } from '@bft/core/contract'
import { useRefetchOnReconnect } from '@bft/ui/connectivity'
import { focusManager, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiFetcher } from '../app/lib/api.ts'
import { makeQueryClient, POLL_MS, useDepartures } from '../app/lib/queries.ts'

const body: DeparturesResponse = {
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261018'],
  rtSourceTimestamp: 1,
  rtState: 'live',
  generatedAt: 1,
  mode: 'ferry',
  stop: { key: 'a', name: 'A', stopIds: ['a'] },
  to: { key: 'b', name: 'B' },
  departures: [],
}

function Probe({ fetcher, initial = null }: { fetcher: ApiFetcher; initial?: DeparturesResponse | null }) {
  useDepartures(fetcher, { fixtures: false, rt: null }, 'a', 'b', null, initial)
  return null
}

/** The board with the root's reconnect handling, re-rendered every `tick` ms as the real board is (its clock). */
function Board({
  fetcher,
  tick,
  initial,
}: {
  fetcher: ApiFetcher
  tick: number
  initial?: DeparturesResponse | null
}) {
  useRefetchOnReconnect(useQueryClient())
  const [, setN] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), tick)
    return () => clearInterval(id)
  }, [tick])
  return <Probe fetcher={fetcher} initial={initial} />
}

/** When each call was made (ms of fake time since the start), and how long since the start it is now. */
function timedFetcher(answer: (call: number) => Response) {
  const start = Date.now()
  const at: number[] = []
  const fetcher = vi.fn<ApiFetcher>(async () => {
    at.push(Date.now() - start)
    return answer(at.length)
  })
  return { fetcher, at, elapsed: () => Date.now() - start }
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

describe('departure polling', () => {
  it('polls every 15 s while visible and pauses while the page is hidden', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn<ApiFetcher>(async () => Response.json(body))
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Probe fetcher={fetcher} />
      </QueryClientProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)

    // Hidden tab: TanStack's focus manager reports unfocused, refetchIntervalInBackground is false.
    act(() => focusManager.setFocused(false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    })
    expect(fetcher).toHaveBeenCalledTimes(2)

    // Visible again: refetch on focus, then polling resumes.
    await act(async () => {
      focusManager.setFocused(true)
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(fetcher).toHaveBeenCalledTimes(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
})

describe('offline backoff (smoke round 9, Codex r1)', () => {
  it('HTTP errors back off (15 s up to 60 s) through re-renders, and one good answer brings back 15 s polls', async () => {
    vi.useFakeTimers()
    let failing = true
    const { fetcher, at } = timedFetcher(() =>
      failing ? new Response('busy', { status: 503 }) : Response.json(body),
    )
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Board fetcher={fetcher} tick={5_000} />
      </QueryClientProvider>,
    )
    await advance(240_000)
    // Each failed poll is retried once, a second later (retry: 1); the polls themselves spread out.
    const polls = at.filter((t, i) => i === 0 || t - (at[i - 1] as number) > 2_000)
    const gaps = polls.slice(1).map((t, i) => t - (polls[i] as number))
    expect(gaps.length).toBeGreaterThanOrEqual(4)
    expect(gaps.length).toBeLessThanOrEqual(8)
    for (let i = 1; i < gaps.length; i++)
      expect(gaps[i] as number).toBeGreaterThanOrEqual((gaps[i - 1] as number) * 0.8)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(61_000 + 1_000)
    expect(Math.max(...gaps)).toBeGreaterThan(45_000)

    failing = false
    await advance(62_000)
    const n = at.length
    await advance(POLL_MS)
    expect(at.length).toBe(n + 1)
    await advance(POLL_MS)
    expect(at.length).toBe(n + 2)
  })

  it('offline after a good poll: no polls at all, even with no re-render (the timer already set is dropped), then one at once on online', async () => {
    vi.useFakeTimers()
    const { fetcher, at } = timedFetcher(() => Response.json(body))
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Board fetcher={fetcher} tick={600_000} />
      </QueryClientProvider>,
    )
    await advance(POLL_MS + 10)
    expect(at.length).toBe(2)
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    await advance(120_000)
    expect(at.length).toBe(2)
    onLine.mockRestore()
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await advance(100)
    expect(at.length).toBe(3)
    await advance(POLL_MS)
    expect(at.length).toBe(4)
  })

  /** The polls of a run (a failed poll's retry, a second later, folded into it) and the gaps between them. */
  const pollGaps = (at: number[], from = 0) => {
    const polls = at.filter((t, i) => t >= from && (i === 0 || t - (at[i - 1] as number) > 2_000))
    return polls.slice(1).map((t, i) => t - (polls[i] as number))
  }

  it('backs off on HTTP errors even when the server clock is ahead of the device (Codex r2)', async () => {
    vi.useFakeTimers()
    const { fetcher, at } = timedFetcher(() => new Response('busy', { status: 503 }))
    // The server-rendered board, generated five minutes "later" than this device's clock.
    const initial = { ...body, generatedAt: Date.now() + 300_000 }
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Board fetcher={fetcher} tick={5_000} initial={initial} />
      </QueryClientProvider>,
    )
    await advance(240_000)
    const gaps = pollGaps(at)
    expect(Math.max(...gaps)).toBeGreaterThan(45_000)
    expect(at.length).toBeLessThanOrEqual(16)
  })

  // Where the backed-off polls fall depends on the backoff's jitter (errorUpdatedAt % 1000), so on the fake clock's
  // start: from these offsets past a whole second, a failed poll's retry is (or isn't) still due at the 200 s mark.
  // Pinned so both paths run every time; before #95, +19, +28 and +37 ms failed (47 of 1,000 offsets).
  it.each([
    { offset: 0, retryDue: false },
    { offset: 19, retryDue: true },
    { offset: 28, retryDue: true },
    { offset: 37, retryDue: true },
  ])(
    "starts the HTTP-error backoff over at the browser's online event, even when its own attempt fails (Codex r2), start +$offset ms",
    async ({ offset, retryDue }) => {
      vi.useFakeTimers()
      vi.setSystemTime(Date.UTC(2026, 9, 20) + offset)
      const { fetcher, at, elapsed } = timedFetcher(() => new Response('busy', { status: 503 }))
      render(
        <QueryClientProvider client={makeQueryClient()}>
          <Board fetcher={fetcher} tick={600_000} />
        </QueryClientProvider>,
      )
      await advance(200_000)
      expect(Math.max(...pollGaps(at))).toBeGreaterThan(45_000)
      expect(elapsed() - (at.at(-1) as number) <= 1_100).toBe(retryDue)
      // The event comes between polls: a board already fetching keeps its request (useRefetchOnReconnect), so a failed
      // poll's retry still due (a second later) would stand in for the attempt. Wait out any retry.
      for (let i = 0; i < 30 && elapsed() - (at.at(-1) as number) <= 1_100; i++) await advance(100)
      expect(elapsed() - (at.at(-1) as number)).toBeGreaterThan(1_100)
      const n = at.length
      await act(async () => {
        window.dispatchEvent(new Event('online'))
      })
      await advance(3_000)
      // An attempt at once (and its retry), both failing; the next comes at the first wait, not the longest.
      expect(at.length).toBe(n + 2)
      await advance(16_000)
      expect(at.length).toBeGreaterThan(n + 2)
    },
  )
})
