/**
 * A trip's stopping pattern, for the trip page only (kept out of queries.ts and api.ts, which every board loads).
 */
import type { TripResponse } from '@bft/core/contract'
import { seedUpdatedAt } from '@bft/ui/connectivity'
import { useQuery } from '@tanstack/react-query'
import { type ApiFetcher, getJson, type Validate } from './api.ts'
import { type DataMode, poll } from './queries.ts'

export const fetchTrip = (
  fetcher: ApiFetcher,
  tripInstance: string,
  opts: { signal?: AbortSignal; validate?: Validate<TripResponse> } = {},
) => getJson(fetcher, `/v1/bus/trips/${encodeURIComponent(tripInstance)}`, opts.validate, opts.signal)

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
    refetchInterval: poll,
  })
}
