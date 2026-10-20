/**
 * The map stop picker's logic, without MapLibre or React (`@bft/ui/stop-picker`): stops on screen, grid clustering,
 * the selection and the per-device "last used the map" flag. Small and dependency-free, so a search panel can read
 * the flag on its first load while the map itself (`@bft/ui/stop-picker-map`) stays lazy.
 */

export interface PickerStop {
  id: string
  name: string
  lat: number
  lon: number
  /** Bus stop number, or the ferry terminal's stop id. */
  code?: string
  /** Platform or other secondary line ("Platforms 1–4"). */
  detail?: string
}

export interface PickerBounds {
  west: number
  south: number
  east: number
  north: number
}

export interface PickerCluster {
  id: string
  lat: number
  lon: number
  count: number
  /** Where a tap zooms to: the cluster's members' bounds. */
  bounds: PickerBounds
}

/** Brisbane CBD (Queen Street Mall), the centre when the device position isn't already known. */
export const CBD_CENTRE: [number, number] = [153.0235, -27.4705]

/** At this zoom and closer every stop shows on its own. */
export const CLUSTER_MAX_ZOOM = 16
/** Grid cell for clustering, in screen pixels. */
export const CLUSTER_CELL_PX = 56

export const inBounds = (s: { lat: number; lon: number }, b: PickerBounds) =>
  s.lat >= b.south && s.lat <= b.north && s.lon >= b.west && s.lon <= b.east

/** Web Mercator world pixel coordinates at a zoom (256 px tiles), as MapLibre draws them. */
export function worldPixel(lat: number, lon: number, zoom: number): [number, number] {
  const scale = 256 * 2 ** zoom
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999)
  return [((lon + 180) / 360) * scale, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale]
}

/**
 * The stops in view, grouped on a screen-pixel grid: a cell with one stop shows the stop, a cell with more shows a
 * cluster at their average position. From `CLUSTER_MAX_ZOOM` every stop shows on its own. Cells are anchored to the
 * world grid (not the view), so panning doesn't reshuffle the clusters.
 */
export function clusterStops(
  stops: readonly PickerStop[],
  bounds: PickerBounds,
  zoom: number,
  cellPx = CLUSTER_CELL_PX,
): { stops: PickerStop[]; clusters: PickerCluster[] } {
  const visible = stops.filter((s) => inBounds(s, bounds))
  if (zoom >= CLUSTER_MAX_ZOOM) return { stops: visible, clusters: [] }
  const z = Math.floor(zoom)
  const cells = new Map<string, PickerStop[]>()
  for (const s of visible) {
    const [x, y] = worldPixel(s.lat, s.lon, z)
    const key = `${z}:${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`
    const cell = cells.get(key)
    if (cell) cell.push(s)
    else cells.set(key, [s])
  }
  const out = { stops: [] as PickerStop[], clusters: [] as PickerCluster[] }
  for (const [key, members] of cells) {
    const first = members[0] as PickerStop
    if (members.length === 1) {
      out.stops.push(first)
      continue
    }
    let lat = 0
    let lon = 0
    const b = { west: first.lon, south: first.lat, east: first.lon, north: first.lat }
    for (const m of members) {
      lat += m.lat
      lon += m.lon
      b.west = Math.min(b.west, m.lon)
      b.east = Math.max(b.east, m.lon)
      b.south = Math.min(b.south, m.lat)
      b.north = Math.max(b.north, m.lat)
    }
    out.clusters.push({
      id: `c:${key}`,
      lat: lat / members.length,
      lon: lon / members.length,
      count: members.length,
      bounds: b,
    })
  }
  return out
}

/**
 * The keyboard and screen-reader alternative to the map: the stops in view, nearest the centre first, then by name.
 */
export function visibleStops(stops: readonly PickerStop[], bounds: PickerBounds, limit = 40): PickerStop[] {
  const cLat = (bounds.south + bounds.north) / 2
  const cLon = (bounds.west + bounds.east) / 2
  const k = Math.cos((cLat * Math.PI) / 180)
  const d = (s: PickerStop) => (s.lat - cLat) ** 2 + ((s.lon - cLon) * k) ** 2
  return stops
    .filter((s) => inBounds(s, bounds))
    .sort((a, b) => d(a) - d(b) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * What is picked. P3 is single-select (a tap opens that stop's card); the multi-select tray (P4) adds
 * `{ mode: 'multi', ids: string[] }` with `add`/`remove` actions, and the same `active` card.
 */
export type PickerSelection = { mode: 'single'; active: string | null }

export type PickerAction = { type: 'tap'; id: string } | { type: 'close' }

export const initialSelection = (): PickerSelection => ({ mode: 'single', active: null })

export function selectionReducer(state: PickerSelection, action: PickerAction): PickerSelection {
  switch (action.type) {
    case 'tap':
      return state.active === action.id ? state : { ...state, active: action.id }
    case 'close':
      return state.active == null ? state : { ...state, active: null }
  }
}

export { MAP_PREF_KEY, readMapPref, writeMapPref } from './map-pref.ts'
