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

function Probe({ fetcher }: { fetcher: ApiFetcher }) {
  useDepartures(fetcher, { fixtures: false, rt: null }, 'a', null)
  return null
}

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
