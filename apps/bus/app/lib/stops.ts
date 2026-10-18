/** Stop naming helpers for SEQ bus stops. */

/**
 * The public stop number. In the SEQ feed every numeric stop_id's stop_code is the id zero-padded to six digits
 * ("10802" → "010802"; checked for all 12,863 numeric stops on the 17 Oct 2026 feed), so pages can show it without
 * loading the stop index.
 */
export function stopCode(stopId: string): string | null {
  return /^\d{1,6}$/.test(stopId) ? stopId.padStart(6, '0') : null
}

/** Digits of a stop number without leading zeros ("010802" → "10802"), for exact matching. */
export const normaliseCode = (s: string) => s.replace(/^0+(?=\d)/, '')

export function stopMeta(stopId: string, platform?: string | null): string {
  const code = stopCode(stopId)
  const parts = [code ? `Stop ${code}` : null, platform ? `platform ${platform}` : null].filter(Boolean)
  return parts.join(' · ')
}

export const stopPath = (stopId: string) => `/stop/${encodeURIComponent(stopId)}`
export const routePath = (route: string) => `/route/${encodeURIComponent(route)}`
export const tripPath = (tripInstance: string, from?: string | null) =>
  `/trip/${encodeURIComponent(tripInstance)}${from ? `?from=${encodeURIComponent(from)}` : ''}`

/** Route short name of a GTFS route_id ("M2-4949" → "M2"). */
export const routeShortOf = (routeId: string) => routeId.split('-')[0] ?? routeId
