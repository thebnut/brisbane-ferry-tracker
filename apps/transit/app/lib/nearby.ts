/**
 * "Around you" across modes (Phase 9): the geohash-5 tile you are in plus its 8 neighbours for each of ferry, train
 * and bus (data/{mode}/geo/), merged and sorted by haversine distance, then grouped by mode. The neighbours are what
 * keep a stop 30 m away across a cell edge from being missed. Exit criterion: < 100 ms from tiles loaded to sorted
 * groups; `computeNearby` reports its own time so the page and the tests can check it.
 */

import type { GeoTileFile } from '@bft/core/contract'
import { geohashEncode, geohashNeighbourhood, nearest } from '@bft/core/geo'

export const NEARBY_MODES = ['ferry', 'train', 'bus'] as const
export type NearbyMode = (typeof NEARBY_MODES)[number]

/** Walking radius for "around you"; the closest stop of each mode is always kept even if further away. */
export const NEARBY_RADIUS_M = 1200
/** Stops listed per mode. */
export const PER_MODE = { ferry: 2, train: 2, bus: 5 } satisfies Record<NearbyMode, number>

export interface NearStop {
  mode: NearbyMode
  key: string
  name: string
  code?: string
  lat: number
  lon: number
  metres: number
}

export interface NearbyResult {
  /** All listed stops, nearest first. */
  stops: NearStop[]
  byMode: Record<NearbyMode, NearStop[]>
  /** Time to merge, sort and group, in ms (performance.now). */
  ms: number
}

/** Geohash cells to load for a position: own cell first, then the 8 neighbours. */
export const cellsFor = (lat: number, lon: number) => geohashNeighbourhood(geohashEncode(lat, lon, 5))

export function computeNearby(
  lat: number,
  lon: number,
  tiles: Partial<Record<NearbyMode, Array<GeoTileFile | null>>>,
  opts: { radius?: number; perMode?: Record<NearbyMode, number> } = {},
): NearbyResult {
  const t0 = performance.now()
  const radius = opts.radius ?? NEARBY_RADIUS_M
  const per = opts.perMode ?? PER_MODE
  const byMode = { ferry: [], train: [], bus: [] } as Record<NearbyMode, NearStop[]>
  for (const mode of NEARBY_MODES) {
    const all = (tiles[mode] ?? []).flatMap((t) => (t ? t.stops : []))
    const sorted = nearest(lat, lon, all, { limit: per[mode] })
    // Within walking distance, but never an empty mode when the tiles have a stop of it.
    const near = sorted.filter((s, i) => i === 0 || s.metres <= radius)
    byMode[mode] = near.map((s) => ({ ...s, mode }))
  }
  const stops = NEARBY_MODES.flatMap((m) => byMode[m]).sort((a, b) => a.metres - b.metres)
  return { stops, byMode, ms: performance.now() - t0 }
}

/** About 80 m a minute, rounded up: "3 min walk". */
export const walkMinutes = (metres: number) => Math.max(1, Math.ceil(metres / 80))

/** X-Map cue for a departure: can you make it on foot? */
export function cue(
  departsInMin: number,
  walkMin: number,
): { text: string; tone: 'late' | 'hurry' | 'good' } {
  if (departsInMin < walkMin) return { text: 'Too late', tone: 'late' }
  if (departsInMin < walkMin + 3) return { text: 'Hurry', tone: 'hurry' }
  if (departsInMin < walkMin + 10) return { text: 'On your way', tone: 'good' }
  return { text: 'Plenty of time', tone: 'good' }
}
