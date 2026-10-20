/**
 * The Nearby tab's last position, in its own module so the pages that never use it (every mode tab) don't carry it
 * on first load with the helpers in storage.ts.
 */
import { safe } from './storage.ts'

/** Last position the Nearby tab used (rounded to ~100 m), so a revisit shows results before GPS answers. */
export const NEARBY_KEY = 'bft-transit-nearby'

export interface Place {
  lat: number
  lon: number
  /** "gps", or the stop the user picked instead ("Use a stop"). */
  source: 'gps' | 'stop'
  label?: string
}

export function readPlace(): Place | null {
  const v = safe(() => JSON.parse(localStorage.getItem(NEARBY_KEY) ?? 'null') as Place | null, null)
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null
}

export function writePlace(p: Place): void {
  const r = (x: number) => Math.round(x * 1000) / 1000
  safe(
    () => localStorage.setItem(NEARBY_KEY, JSON.stringify({ ...p, lat: r(p.lat), lon: r(p.lon) })),
    undefined,
  )
}
