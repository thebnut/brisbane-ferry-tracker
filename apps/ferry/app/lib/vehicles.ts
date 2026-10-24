/**
 * Live vehicle positions for the ferry maps. Only the map page and the board's idle panel map (both lazy) use them, so
 * they stay off the boards' first load.
 */
import type { VehiclesResponse } from '@bft/core/contract'
import { useQuery } from '@tanstack/react-query'
import { type ApiFetcher, getJson } from './api.ts'
import { type DataMode, poll } from './queries.ts'

export const fetchVehicles = (fetcher: ApiFetcher, signal?: AbortSignal) =>
  getJson<VehiclesResponse>(fetcher, '/v1/ferry/vehicles', undefined, signal)

export function useVehicles(fetcher: ApiFetcher, mode: DataMode, enabled: boolean) {
  return useQuery({
    queryKey: ['ferry', 'vehicles', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchVehicles(fetcher, signal),
    enabled,
    refetchInterval: poll,
  })
}
