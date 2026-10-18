/**
 * TanStack Query hooks: 15 s polling while the page is visible (paused when hidden), offline fallback to the saved
 * full-day timetable of a favourite ("Offline · scheduled").
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { isOnline } from '@bft/ui/connectivity'
import { QueryClient, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  type ApiFetcher,
  browserFetcher,
  DEPARTURE_LIMIT,
  fetchAlerts,
  fetchDepartures,
  fetchTrip,
  fetchVehicles,
} from './api.ts'
import { offlineRows } from './departures.ts'
import { readOfflineDay } from './storage.ts'

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

/** Is the browser offline, or are API calls failing? (false during SSR). */
const isOffline = () => !isOnline()

export function departuresOptions(
  fetcher: ApiFetcher,
  mode: DataMode,
  from: string,
  to: string | null,
  limit: number,
  initial: DeparturesResponse | null,
) {
  return {
    queryKey: ['train', 'departures', mode.fixtures, mode.rt, from, to, limit] as const,
    queryFn: async ({
      signal,
    }: {
      signal: AbortSignal
    }): Promise<DeparturesResponse & { offline?: boolean }> => {
      try {
        return await fetchDepartures(fetcher, from, to, { limit, signal })
      } catch (error) {
        // Offline: rebuild the board from the saved full-day timetable, as scheduled times.
        const day = isOffline() ? readOfflineDay(from, to) : null
        if (!day) throw error
        const nowMs = Date.now()
        return {
          schemaVersion: 1,
          staticGeneration: null,
          serviceDates: [day.serviceDate],
          rtSourceTimestamp: null,
          rtState: 'unavailable',
          generatedAt: nowMs,
          mode: 'train',
          stop: { key: from, name: from, stopIds: [] },
          to: to ? { key: to, name: to } : null,
          departures: offlineRows(day.departures, Math.floor(nowMs / 1000), limit),
          offline: true,
        }
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
  to: string | null,
  initial: DeparturesResponse | null,
  limit = DEPARTURE_LIMIT,
) {
  return useQuery(departuresOptions(fetcher, mode, from, to, limit, initial))
}

export function useTrip(
  fetcher: ApiFetcher,
  mode: DataMode,
  tripInstance: string,
  initial: Awaited<ReturnType<typeof fetchTrip>> | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['train', 'trip', mode.fixtures, mode.rt, tripInstance],
    queryFn: ({ signal }) => fetchTrip(fetcher, tripInstance, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    // When the WebSocket prototype pushes updates, polling is off (see useTripSocket).
    refetchInterval: enabled ? POLL_MS : false,
  })
}

export function useVehicles(fetcher: ApiFetcher, mode: DataMode, enabled: boolean) {
  return useQuery({
    queryKey: ['train', 'vehicles', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchVehicles(fetcher, signal),
    enabled,
    refetchInterval: POLL_MS,
  })
}

export function useAlerts(
  fetcher: ApiFetcher,
  mode: DataMode,
  initial: Awaited<ReturnType<typeof fetchAlerts>> | null,
) {
  return useQuery({
    queryKey: ['train', 'alerts', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchAlerts(fetcher, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    refetchInterval: 60_000,
  })
}
