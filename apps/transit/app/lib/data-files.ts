/**
 * /data reads for the Nearby page and "Use a stop" only, kept out of api.ts so they're on no other page's first load.
 * A file without its list (or any failed read) throws ApiError, which those pages show as "Couldn't load" with a
 * Try again: never data whose `.map` would crash a render. Static files can reach the browser without the server's
 * contract check.
 */
import type { GeoTileFile, Mode, StopIndexFile } from '@bft/core/contract'
import { ApiError, type ApiFetcher, getJson } from './api.ts'

const withStops = <T>(body: unknown): T => {
  if (!Array.isArray((body as { stops?: unknown } | null)?.stops))
    throw new ApiError('contract', 'No stops list in the file')
  return body as T
}

/** A geohash-5 tile; a cell with no stops has no file (404), which is an empty tile, not an error. */
export async function fetchGeoTile(fetcher: ApiFetcher, mode: Mode, geohash: string, signal?: AbortSignal) {
  try {
    return await getJson(fetcher, `/data/${mode}/geo/${geohash}.json`, withStops<GeoTileFile>, signal)
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

export const fetchStopIndex = (fetcher: ApiFetcher, mode: Mode, signal?: AbortSignal) =>
  getJson(fetcher, `/data/${mode}/stops.json`, withStops<StopIndexFile>, signal)
