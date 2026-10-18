/** TanStack Query hooks: 15 s polling while the page is visible (paused when hidden), offline fallback. */
import type { DeparturesResponse } from '@bft/core/contract'
import { bestOfflineCopy, isOnline } from '@bft/ui/connectivity'
import { QueryClient, type QueryFunctionContext, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type ApiFetcher, browserFetcher, fetchDepartures, fetchTrip, fetchVehicles } from './api.ts'
import { readOffline, writeOffline } from './storage.ts'

export const POLL_MS = 15_000

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Polling stops while the tab is hidden (TanStack's focus manager watches visibilitychange).
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 10_000,
        // Let the service worker's cache answer when the network is down.
        networkMode: 'offlineFirst',
      },
    },
  })
}

export interface DataMode {
  fixtures: boolean
  rt: string | null
}

export function useFetcher(mode: DataMode): ApiFetcher {
  return useMemo(() => browserFetcher(mode), [mode])
}

export function departuresOptions(
  fetcher: ApiFetcher,
  mode: DataMode,
  from: string,
  to: string,
  at: number | null,
  initial: DeparturesResponse | null,
) {
  const queryKey = ['ferry', 'departures', mode.fixtures, mode.rt, from, to, at] as const
  return {
    queryKey,
    queryFn: async ({ signal, client }: QueryFunctionContext<typeof queryKey>) => {
      // Offline, the board on screen may be fresher than the service worker's cached answer or the kept copy: show
      // whichever has the most departures to come (R2-B6). The board marks it offline and drops live claims.
      // Copies were contract-checked by the proxy when first fetched.
      const offlineCopy = (...more: Array<DeparturesResponse | null | undefined>) =>
        bestOfflineCopy(
          [
            client.getQueryData<DeparturesResponse>(queryKey),
            ...more,
            readOffline(from, to) as DeparturesResponse | null,
          ],
          Date.now(),
        )
      try {
        const res = await fetchDepartures(fetcher, from, to, { at, signal })
        if (isOnline()) {
          if (!at) writeOffline(from, to, res)
          return res
        }
        // The service worker answered from its cache (maybe hours old).
        return offlineCopy(res) ?? res
      } catch (error) {
        // Offline with no cached response from the service worker: the board on screen or the last copy we kept.
        const cached = isOnline() ? null : offlineCopy()
        if (cached) return cached
        throw error
      }
    },
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    refetchInterval: POLL_MS,
  }
}

export function useDepartures(
  fetcher: ApiFetcher,
  mode: DataMode,
  from: string,
  to: string,
  at: number | null,
  initial: DeparturesResponse | null,
) {
  return useQuery(departuresOptions(fetcher, mode, from, to, at, initial))
}

export function useTrip(fetcher: ApiFetcher, mode: DataMode, tripInstance: string | null) {
  return useQuery({
    queryKey: ['ferry', 'trip', mode.fixtures, mode.rt, tripInstance],
    queryFn: ({ signal }) => fetchTrip(fetcher, tripInstance as string, signal),
    enabled: !!tripInstance,
    refetchInterval: POLL_MS,
  })
}

export function useVehicles(fetcher: ApiFetcher, mode: DataMode, enabled: boolean) {
  return useQuery({
    queryKey: ['ferry', 'vehicles', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchVehicles(fetcher, signal),
    enabled,
    refetchInterval: POLL_MS,
  })
}
