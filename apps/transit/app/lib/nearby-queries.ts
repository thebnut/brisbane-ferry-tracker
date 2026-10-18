/** Query hooks only the Nearby page uses (kept out of the shared module so geo code isn't on other pages). */
import type { GeoTileFile, Mode } from '@bft/core/contract'
import { useQueries } from '@tanstack/react-query'
import { useMemo } from 'react'
import { type ApiFetcher, fetchDepartures, fetchGeoTile } from './api.ts'
import { NEARBY_MODES, type NearbyMode } from './nearby.ts'
import { type DataMode, POLL_MS } from './queries.ts'

/** Own cell + 8 neighbours for every mode. Missing tiles (no stops there) resolve to null. */
export function useGeoTiles(fetcher: ApiFetcher, mode: DataMode, cells: string[]) {
  const pairs = NEARBY_MODES.flatMap((m) => cells.map((gh) => [m, gh] as const))
  const results = useQueries({
    queries: pairs.map(([m, gh]) => ({
      queryKey: ['transit', 'geo', mode.fixtures, m, gh],
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
      queryKey: ['transit', 'departures', mode.fixtures, mode.rt, s.mode, s.key, null, limit],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        fetchDepartures(fetcher, s.mode, s.key, { limit, signal }),
      refetchInterval: POLL_MS,
    })),
  })
}
