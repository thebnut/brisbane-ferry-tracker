/**
 * TanStack Query hooks: 15 s polling while the page is visible (paused when hidden), offline fallback to the saved
 * full-day timetable of a favourite ("Offline · scheduled").
 */
import type { DeparturesResponse } from '@bft/core/contract'
import {
  asOfflineCopy,
  bestOfflineCopy,
  isOnline,
  type OfflineCopy,
  pollEvery,
  replacesBoard,
  seedUpdatedAt,
} from '@bft/ui/connectivity'
import { QueryClient, type QueryFunctionContext, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  ApiError,
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
/** Live data polling, backing off while calls fail (@bft/ui pollEvery). */
const poll = pollEvery(POLL_MS)
const pollAlerts = pollEvery(60_000)

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
  /** "Depart from" (epoch s, the board's Now ▾ chip, THE-118 PR 5): trains from then; null is now. */
  at: number | null = null,
) {
  const queryKey = ['train', 'departures', mode.fixtures, mode.rt, from, to, limit, at] as const
  type Board = DeparturesResponse & OfflineCopy
  /** The saved full-day timetable as a board of scheduled times. */
  const savedDay = (nowMs: number): Board | null => {
    const day = readOfflineDay(from, to)
    if (!day) return null
    return {
      schemaVersion: 1,
      staticGeneration: null,
      serviceDates: [day.serviceDate],
      rtSourceTimestamp: null,
      rtState: 'unavailable',
      generatedAt: day.savedAt,
      mode: 'train',
      stop: { key: from, name: from, stopIds: [] },
      to: to ? { key: to, name: to } : null,
      departures: offlineRows(day.departures, Math.max(Math.floor(nowMs / 1000), at ?? 0), limit),
      offline: true,
      deviceStamped: true,
    }
  }
  return {
    queryKey,
    queryFn: async ({ signal, client }: QueryFunctionContext<typeof queryKey>): Promise<Board> => {
      // Offline, the board on screen may be fresher than the service worker's cached answer (maybe hours old) or the
      // saved day: show whichever has the most trains to come (R2-B6). The board drops live claims offline.
      const offlineCopy = (...more: Array<Board | null | undefined>) => {
        const nowMs = Date.now()
        return bestOfflineCopy([client.getQueryData<Board>(queryKey), ...more, savedDay(nowMs)], nowMs)
      }
      const shown = client.getQueryData<Board>(queryKey)
      try {
        const res = await fetchDepartures(fetcher, from, to, { limit, at, signal })
        // Judged on this response, not only on the connection flag another request may have just cleared, and never
        // older than the server board on screen (R6-B1). A board built from the saved day carries no server time (its
        // `generatedAt` is the device's savedAt), so it never holds a network answer back (release review).
        return replacesBoard(res, shown) ? res : asOfflineCopy(offlineCopy(res) ?? res, shown)
      } catch (error) {
        // Offline: the board on screen, or the saved full-day timetable as scheduled times.
        const copy = isOffline() ? offlineCopy() : null
        if (!copy) throw error
        return asOfflineCopy(copy, shown)
      }
    },
    initialData: initial ?? undefined,
    initialDataUpdatedAt: seedUpdatedAt(initial),
    refetchInterval: poll,
  }
}

export function useDepartures(
  fetcher: ApiFetcher,
  mode: DataMode,
  from: string,
  to: string | null,
  initial: DeparturesResponse | null,
  limit = DEPARTURE_LIMIT,
  at: number | null = null,
) {
  return useQuery(departuresOptions(fetcher, mode, from, to, limit, initial, at))
}

const gone = (error: unknown) => error instanceof ApiError && error.status === 404

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
    initialDataUpdatedAt: seedUpdatedAt(initial),
    // When the WebSocket prototype pushes updates, polling is off (see useTripSocket). A service that has gone (404)
    // stays gone: the page says so.
    refetchInterval: (q) => (enabled && !gone(q.state.error) ? poll(q) : false),
    retry: (n, error) => !gone(error) && n < 1,
  })
}

export function useVehicles(fetcher: ApiFetcher, mode: DataMode, enabled: boolean) {
  return useQuery({
    queryKey: ['train', 'vehicles', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchVehicles(fetcher, signal),
    enabled,
    refetchInterval: poll,
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
    initialDataUpdatedAt: seedUpdatedAt(initial),
    refetchInterval: pollAlerts,
  })
}
