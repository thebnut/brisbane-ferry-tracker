/** TanStack Query hooks for the transit pages: 15 s polling while visible, tiles kept for the session. */
import type { AlertsResponse, Departure, DeparturesResponse } from '@bft/core/contract'
import {
  asOfflineCopy,
  bestOfflineCopy,
  isOnline,
  type OfflineCopy,
  replacesBoard,
} from '@bft/ui/connectivity'
import { type QueryFunctionContext, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useRouteLoaderData } from 'react-router'
import { type ApiFetcher, browserFetcher, fetchAlerts, fetchDepartures } from './api.ts'
import { asScheduled, offlineRows, type SavedItem, writeSavedCopy } from './saved.ts'

export const POLL_MS = 15_000

export { makeQueryClient } from './query-client.ts'

export interface DataMode {
  fixtures: boolean
  rt: string | null
}

const LIVE: DataMode = { fixtures: false, rt: null }

/** Data mode from the root loader, and the browser fetcher for it. */
export function useApi(): { mode: DataMode; fetcher: ApiFetcher } {
  const root = useRouteLoaderData('root') as { mode?: DataMode } | undefined
  const mode = root?.mode ?? LIVE
  const fetcher = useMemo(() => browserFetcher(mode), [mode])
  return { mode, fetcher }
}

// Browser only: workerd has a `navigator` without `onLine`, which must not read as offline during SSR.
/** Offline, or API calls failing / answered from the service worker's cache (@bft/ui connectivity). */
export const isOffline = () => !isOnline()

export function useAlerts(fetcher: ApiFetcher, mode: DataMode, initial: AlertsResponse | null = null) {
  return useQuery({
    queryKey: ['transit', 'alerts', 'all', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchAlerts(fetcher, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

/** Saved cards: live while online (keeping a 20-row copy for offline), scheduled copies when offline. */
export function savedOptions(fetcher: ApiFetcher, mode: DataMode, item: SavedItem) {
  const queryKey = ['transit', 'saved', mode.fixtures, mode.rt, item.id] as const
  return {
    queryKey,
    queryFn: async ({
      signal,
      client,
    }: QueryFunctionContext<typeof queryKey>): Promise<DeparturesResponse & OfflineCopy> => {
      // Offline, the card on screen may be fresher than the service worker's cached answer (R2-B6).
      const shown = client.getQueryData<DeparturesResponse>(queryKey)
      try {
        const res = await fetchDepartures(fetcher, item.mode, item.key, { to: item.to, limit: 20, signal })
        // Judged on this response, not only on the connection flag another request may have just cleared, and never
        // older than the card on screen (R6-B1).
        if (replacesBoard(res, shown)) {
          if (res.departures.length) writeSavedCopy(item, res)
          return res
        }
        return asOffline(item, bestOfflineCopy([shown, res], Date.now()))
      } catch (error) {
        if (isOffline()) {
          if (shown) return asOffline(item, shown)
          const copy = offlineRows(item, Date.now())
          if (copy) return asOffline(item, null, copy)
        }
        throw error
      }
    },
    refetchInterval: POLL_MS,
  }
}

/** A card's data as "Offline · scheduled": the device's copy or the last response, as timetable only. */
export function asOffline(item: SavedItem, res: DeparturesResponse | null, copy?: Departure[]) {
  // The device's copy or the response, whichever has more departures to come (an old cached response can be empty).
  const own = res ? asScheduled(res.departures, Date.now()) : []
  const kept = copy ?? offlineRows(item, Date.now())
  const rows = kept && kept.length >= own.length ? kept : own
  const base: DeparturesResponse = res ?? {
    schemaVersion: 1,
    staticGeneration: 'offline',
    serviceDates: [],
    rtSourceTimestamp: null,
    rtState: 'unavailable',
    generatedAt: Date.now(),
    mode: item.mode,
    stop: { key: item.key, name: item.title, stopIds: [item.key] },
    to: null,
    departures: [],
  }
  return asOfflineCopy({
    ...base,
    rtState: 'unavailable' as const,
    rtSourceTimestamp: null,
    departures: rows,
  })
}

export function useSavedDepartures(fetcher: ApiFetcher, mode: DataMode, items: SavedItem[]) {
  return useQueries({ queries: items.map((i) => savedOptions(fetcher, mode, i)) })
}
