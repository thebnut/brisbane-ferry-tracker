/**
 * Nearby helpers for the bus app. The geohash and distance code lives in @bft/core/geo (shared with BrisbaneTransit's
 * "Around you" and identical to the pipeline's encoder); formatDistance in @bft/ui.
 */
export * from '@bft/core/geo'
export { formatDistance } from '@bft/ui/format'

/** `?lat=&lon=` fixes the position for /nearby and /map (links from the map, tests). */
export function positionFromParams(params: URLSearchParams): { lat: number; lon: number } | null {
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  return params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)
    ? { lat, lon }
    : null
}
