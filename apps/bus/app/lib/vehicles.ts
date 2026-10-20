/**
 * Live bus positions, for the stop map (loaded when opened) and route pages only, so the boards don't load them.
 */
import type { VehiclesResponse } from '@bft/core/contract'
import { useQuery } from '@tanstack/react-query'
import { type ApiFetcher, getJson } from './api.ts'
import { type DataMode, poll } from './queries.ts'

export const fetchVehicles = (fetcher: ApiFetcher, route: string | null, signal?: AbortSignal) =>
  getJson<VehiclesResponse>(
    fetcher,
    `/v1/bus/vehicles${route ? `?route=${encodeURIComponent(route)}` : ''}`,
    undefined,
    signal,
  )

export function useVehicles(fetcher: ApiFetcher, mode: DataMode, route: string | null, enabled = true) {
  return useQuery({
    queryKey: ['bus', 'vehicles', mode.fixtures, mode.rt, route],
    queryFn: ({ signal }) => fetchVehicles(fetcher, route, signal),
    enabled,
    refetchInterval: poll,
  })
}
