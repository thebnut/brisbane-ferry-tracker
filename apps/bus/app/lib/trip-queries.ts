/**
 * A trip's stopping pattern, for the trip page only (kept out of queries.ts and api.ts, which every board loads).
 */
import type { TripResponse } from '@bft/core/contract'
import { seedUpdatedAt } from '@bft/ui/connectivity'
import { useQuery } from '@tanstack/react-query'
import { ApiError, type ApiFetcher, getJson, type Validate } from './api.ts'
import { type DataMode, POLL_MS, poll } from './queries.ts'

export const fetchTrip = (
  fetcher: ApiFetcher,
  tripInstance: string,
  opts: { signal?: AbortSignal; validate?: Validate<TripResponse> } = {},
) => getJson(fetcher, `/v1/bus/trips/${encodeURIComponent(tripInstance)}`, opts.validate, opts.signal)

/** A 404: the trip has run, or never was. The page says so, and polling stops. */
export const isGone = (error: unknown) => error instanceof ApiError && error.status === 404

export function useTrip(
  fetcher: ApiFetcher,
  mode: DataMode,
  tripInstance: string,
  initial: TripResponse | null,
) {
  return useQuery({
    queryKey: ['bus', 'trip', mode.fixtures, mode.rt, tripInstance],
    queryFn: ({ signal }) => fetchTrip(fetcher, tripInstance, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: seedUpdatedAt(initial),
    // Fresh until the next poll: the panel and its full page (THE-118 PR 7) mount it again without a fetch.
    staleTime: POLL_MS,
    refetchInterval: (q) => (isGone(q.state.error) ? false : poll(q)),
    retry: (n, error) => !isGone(error) && n < 1,
  })
}
