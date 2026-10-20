/**
 * Nearby geohash tiles, for the map and nearby pages only, so the boards don't load them.
 */
import { useQueries } from '@tanstack/react-query'
import { ApiError, type ApiFetcher, getJson, listOf } from './api.ts'
import type { GeoTileFile } from './data-contract.ts'
import type { DataMode } from './queries.ts'

/** A geohash-5 tile; a cell with no stops has no file (404), which is an empty tile, not an error. */
export async function fetchGeoTile(fetcher: ApiFetcher, geohash: string, signal?: AbortSignal) {
  try {
    return await getJson(fetcher, `/data/bus/geo/${geohash}.json`, listOf<GeoTileFile>('stops'), signal)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

/**
 * Geohash tiles (own + neighbours) for nearby. Missing tiles (no stops) resolve to null. A tile that failed to load
 * counts as empty, so the rest still show; `error` says some failed and `retry` refetches just those.
 */
export function useGeoTiles(fetcher: ApiFetcher, mode: DataMode, geohashes: string[]) {
  const results = useQueries({
    queries: geohashes.map((gh) => ({
      queryKey: ['bus', 'geo', mode.fixtures, gh],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchGeoTile(fetcher, gh, signal),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const loading = results.some((r) => r.isPending)
  const error = results.find((r) => r.error)?.error ?? null
  const tiles = results.map((r) => r.data).filter((t): t is GeoTileFile => !!t)
  const retry = () => {
    for (const r of results) if (r.isError) r.refetch()
  }
  return { tiles, loading, error, retry }
}
