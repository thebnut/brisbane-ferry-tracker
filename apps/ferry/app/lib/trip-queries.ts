/**
 * A ferry trip's stops and vessel, for the trip page only (THE-118 PR 6; kept out of queries.ts and api.ts, which every
 * board loads). Server-rendered from /v1/ferry/trips/:id, then polled. A 404 is a trip that has run or never was: the
 * page says so, and polling stops.
 */
import type { TripResponse } from '@bft/core/contract'
import { seedUpdatedAt } from '@bft/ui/connectivity'
import { useQuery } from '@tanstack/react-query'
import { ApiError, type ApiFetcher, getJson, type Validate } from './api.ts'
import { type DataMode, poll } from './queries.ts'

export const fetchTrip = (
  fetcher: ApiFetcher,
  tripInstance: string,
  opts: { signal?: AbortSignal; validate?: Validate<TripResponse> } = {},
) => getJson(fetcher, `/v1/ferry/trips/${encodeURIComponent(tripInstance)}`, opts.validate, opts.signal)

export const isGone = (error: unknown) => error instanceof ApiError && error.status === 404

export function useTrip(fetcher: ApiFetcher, mode: DataMode, tripInstance: string, initial: TripResponse | null) {
  return useQuery({
    queryKey: ['ferry', 'trip', mode.fixtures, mode.rt, tripInstance],
    queryFn: ({ signal }) => fetchTrip(fetcher, tripInstance, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: seedUpdatedAt(initial),
    refetchInterval: (q) => (isGone(q.state.error) ? false : poll(q)),
    retry: (n, error) => !isGone(error) && n < 1,
  })
}
