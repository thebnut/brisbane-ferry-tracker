// @vitest-environment jsdom
import type { DeparturesResponse } from '@bft/core/contract'
import { focusManager, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
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
  mode: 'bus',
  stop: { key: 'a', name: 'A', stopIds: ['a'] },
  to: null,
  departures: [],
}

function Probe({ fetcher, initial = null }: { fetcher: ApiFetcher; initial?: DeparturesResponse | null }) {
  useDepartures(fetcher, { fixtures: false, rt: null }, 'a', initial)
  return null
}

afterEach(() => {
  vi.useRealTimers()
  focusManager.setFocused(undefined)
})

describe('departure polling', () => {
  it('polls every 15 s while visible and pauses while the page is hidden', async () => {
    vi.useFakeTimers()
    const polls = vi.fn()
    // Every viewed stop also keeps a longer offline copy (limit=100, at most every 3 h): not a poll.
    const fetcher: ApiFetcher = async (path) => {
      if (!path.includes('limit=100')) polls()
      return Response.json(body)
    }
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Probe fetcher={fetcher} />
      </QueryClientProvider>,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(polls).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(polls).toHaveBeenCalledTimes(2)

    // Hidden tab: TanStack's focus manager reports unfocused, refetchIntervalInBackground is false.
    act(() => focusManager.setFocused(false))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS * 4)
    })
    expect(polls).toHaveBeenCalledTimes(2)

    // Visible again: refetch on focus, then polling resumes.
    await act(async () => {
      focusManager.setFocused(true)
      await vi.advanceTimersByTimeAsync(10)
    })
    expect(polls).toHaveBeenCalledTimes(3)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_MS)
    })
    expect(polls).toHaveBeenCalledTimes(4)
  })

  // R27-RT1: a cold API isolate's SSR answer is scheduled-only (`unavailable`) once its realtime wait runs out. The
  // board must ask again at once, not show OFFLINE until its first poll 15 s later.
  for (const [rtState, atMount] of [
    ['live', 0],
    ['unavailable', 1],
    ['stale', 1],
    ['reloading', 1],
  ] as const) {
    it(`a board seeded ${rtState} by the page ${atMount ? 'asks again at mount' : 'polls 15 s later'}`, async () => {
      vi.useFakeTimers()
      const polls = vi.fn()
      const fetcher: ApiFetcher = async (path) => {
        if (!path.includes('limit=100')) polls()
        return Response.json(body)
      }
      const initial = { ...body, rtState, generatedAt: Date.now() }
      render(
        <QueryClientProvider client={makeQueryClient()}>
          <Probe fetcher={fetcher} initial={initial} />
        </QueryClientProvider>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10)
      })
      expect(polls).toHaveBeenCalledTimes(atMount)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_MS)
      })
      expect(polls).toHaveBeenCalledTimes(atMount + 1)
    })
  }
})
