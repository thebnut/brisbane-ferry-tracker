/** TanStack Query hooks for the transit pages: 15 s polling while visible, tiles kept for the session. */
import type { AlertsResponse, Departure, DeparturesResponse } from '@bft/core/contract'
import { isOnline } from '@bft/ui/connectivity'
import { useQueries, useQuery } from '@tanstack/react-query'
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
  return {
    queryKey: ['transit', 'saved', mode.fixtures, mode.rt, item.id],
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<DeparturesResponse> => {
      try {
        const res = await fetchDepartures(fetcher, item.mode, item.key, { to: item.to, limit: 20, signal })
        if (!isOffline()) {
          if (res.departures.length) writeSavedCopy(item, res)
          return res
        }
        return asOffline(item, res)
      } catch (error) {
        if (isOffline()) {
          const copy = offlineRows(item, Date.now())
          if (copy) return asOffline(item, null, copy)
        }
        throw error
      }
    },
    refetchInterval: POLL_MS,
  }
}

/** A card's data as "Offline · scheduled": the device's copy (or the last response) as timetable only. */
export function asOffline(item: SavedItem, res: DeparturesResponse | null, copy?: Departure[]) {
  const rows = copy ?? offlineRows(item, Date.now()) ?? asScheduled(res?.departures ?? [], Date.now())
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
  return { ...base, rtState: 'unavailable' as const, rtSourceTimestamp: null, departures: rows }
}

export function useSavedDepartures(fetcher: ApiFetcher, mode: DataMode, items: SavedItem[]) {
  return useQueries({ queries: items.map((i) => savedOptions(fetcher, mode, i)) })
}
