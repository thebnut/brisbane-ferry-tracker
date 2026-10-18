/** TanStack Query hooks for the transit pages: 15 s polling while visible, tiles kept for the session. */
import type { AlertsResponse, Departure, DeparturesResponse, GeoTileFile, Mode } from '@bft/core/contract'
import { QueryClient, useQueries, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { useRouteLoaderData } from 'react-router'
import { type ApiFetcher, browserFetcher, fetchAlerts, fetchDepartures, fetchGeoTile } from './api.ts'
import { NEARBY_MODES, type NearbyMode } from './nearby.ts'
import { asScheduled, offlineRows, type SavedItem, writeSavedCopy } from './saved.ts'

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

const LIVE: DataMode = { fixtures: false, rt: null }

/** Data mode from the root loader, and the browser fetcher for it. */
export function useApi(): { mode: DataMode; fetcher: ApiFetcher } {
  const root = useRouteLoaderData('root') as { mode?: DataMode } | undefined
  const mode = root?.mode ?? LIVE
  const fetcher = useMemo(() => browserFetcher(mode), [mode])
  return { mode, fetcher }
}

// Browser only: workerd has a `navigator` without `onLine`, which must not read as offline during SSR.
export const isOffline = () => typeof window !== 'undefined' && navigator.onLine === false

export function useAlerts(fetcher: ApiFetcher, mode: DataMode, initial: AlertsResponse | null = null) {
  return useQuery({
    queryKey: ['alerts', 'all', mode.fixtures, mode.rt],
    queryFn: ({ signal }) => fetchAlerts(fetcher, { signal }),
    initialData: initial ?? undefined,
    initialDataUpdatedAt: initial?.generatedAt,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

/** Own cell + 8 neighbours for every mode. Missing tiles (no stops there) resolve to null. */
export function useGeoTiles(fetcher: ApiFetcher, mode: DataMode, cells: string[]) {
  const pairs = NEARBY_MODES.flatMap((m) => cells.map((gh) => [m, gh] as const))
  const results = useQueries({
    queries: pairs.map(([m, gh]) => ({
      queryKey: ['geo', mode.fixtures, m, gh],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchGeoTile(fetcher, m, gh, signal),
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 30 * 60_000,
    })),
  })
  const loading = results.some((r) => r.isPending)
  const error = results.find((r) => r.error)?.error ?? null
  // Stable identity while nothing changed, so the nearby sort doesn't rerun every render.
  const key = results.map((r) => r.dataUpdatedAt).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` tracks the results' data.
  const tiles = useMemo(() => {
    const out = { ferry: [], train: [], bus: [] } as Record<NearbyMode, Array<GeoTileFile | null>>
    results.forEach((r, i) => {
      const [m] = pairs[i] as readonly [NearbyMode, string]
      if (r.data !== undefined) out[m].push(r.data)
    })
    return out
  }, [key])
  return { tiles, loading, error }
}

/** Next departures for a list of stops (Nearby rows): 3 each, polled. */
export function useStopDepartures(
  fetcher: ApiFetcher,
  mode: DataMode,
  stops: Array<{ mode: Mode; key: string }>,
  limit = 3,
) {
  return useQueries({
    queries: stops.map((s) => ({
      queryKey: ['departures', mode.fixtures, mode.rt, s.mode, s.key, null, limit],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchDepartures(fetcher, s.mode, s.key, { limit, signal }),
      refetchInterval: POLL_MS,
    })),
  })
}

/** Saved cards: live while online (keeping a 20-row copy for offline), scheduled copies when offline. */
export function savedOptions(fetcher: ApiFetcher, mode: DataMode, item: SavedItem) {
  return {
    queryKey: ['saved', mode.fixtures, mode.rt, item.id],
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

function asOffline(item: SavedItem, res: DeparturesResponse | null, copy?: Departure[]) {
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
