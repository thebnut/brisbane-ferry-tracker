/** TanStack Query hooks: 15 s polling while the page is visible (paused when hidden), offline fallback. */
import type { DeparturesResponse } from '@bft/core/contract'
import { asOfflineCopy, bestOfflineCopy, isOnline, replacesBoard } from '@bft/ui/connectivity'
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
  /** Demo data for everyone (FIXTURES=1) or a fallback answer, not a visitor's demo session. */
  forced?: boolean
  /** ALLOW_FIXTURES: visitors may switch demo mode on (never in production). */
  allowed?: boolean
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
      const shown = client.getQueryData<DeparturesResponse>(queryKey)
      try {
        const res = await fetchDepartures(fetcher, from, to, { at, signal })
        // Judged on this response, not only on the connection flag another request may have just cleared, and never
        // older than the server board on screen (R6-B1). Not against the kept copy: a network answer from the edge
        // cache can be a little older than it, and the board then stayed "Offline" for a poll (release review).
        if (replacesBoard(res, shown)) {
          // The kept copy only moves forward.
          const kept = at ? null : (readOffline(from, to) as DeparturesResponse | null)
          if (!at && !(kept && res.generatedAt < kept.generatedAt)) writeOffline(from, to, res)
          return res
        }
        // The service worker answered from its cache (maybe hours old): an offline board until a network answer.
        return asOfflineCopy(offlineCopy(res) ?? res, shown)
      } catch (error) {
        // Offline with no cached response from the service worker: the board on screen or the last copy we kept.
        const cached = isOnline() ? null : offlineCopy()
        if (cached) return asOfflineCopy(cached, shown)
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

/** Bumped by another tab's storage writes (the event never fires for this tab's own). */
let stored = 0
globalThis.addEventListener?.('storage', () => stored++)

/**
 * The data a board shows: offline (`hold`), the best of its data and the copy kept on this device (bestOfflineCopy,
 * by the time `now`). The kept copy is read once per change of the data, pair or hold, or on the next render after
 * another tab writes to storage (this tab's own writes come with new data), not on every clock tick: offline, the
 * board re-renders with the countdown (L8).
 */
export function useShownData(
  data: DeparturesResponse | undefined,
  from: string,
  to: string,
  hold: boolean,
  now: number,
): DeparturesResponse | undefined {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `stored` reads again after another tab's write (Codex review).
  const kept = useMemo(
    () => (data && hold ? (readOffline(from, to) as DeparturesResponse | null) : null),
    [data, from, to, hold, stored],
  )
  // Never null here: the board's own data is a copy.
  return data && hold ? (bestOfflineCopy([data, kept], now) as DeparturesResponse) : data
}
