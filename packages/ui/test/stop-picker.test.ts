import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLUSTER_CELL_PX,
  CLUSTER_MAX_ZOOM,
  clusterStops,
  initialSelection,
  MAP_PREF_KEY,
  type PickerStop,
  readMapPref,
  selectionReducer,
  visibleStops,
  worldPixel,
  writeMapPref,
} from '../src/stop-picker.ts'

const BRISBANE = { west: 152.9, south: -27.6, east: 153.2, north: -27.3 }
const stop = (id: string, lat: number, lon: number, name = `Stop ${id}`): PickerStop => ({
  id,
  name,
  lat,
  lon,
})

// Two stops ~30 m apart (King George Square), one ~3 km away (Bulimba), one outside the view (Gold Coast).
const STOPS = [
  stop('a', -27.4685, 153.0235, 'King George Square A'),
  stop('b', -27.4688, 153.0237, 'King George Square B'),
  stop('c', -27.4419, 153.0582, 'Bulimba'),
  stop('far', -28.0, 153.4),
]

describe('worldPixel', () => {
  it("matches MapLibre's Web Mercator (512 px tiles): (0, 0) is the middle of the world at every zoom", () => {
    expect(worldPixel(0, 0, 0)).toEqual([256, 256])
    const [x, y] = worldPixel(0, 0, 10.5)
    expect(x).toBeCloseTo(256 * 2 ** 10.5)
    expect(y).toBeCloseTo(256 * 2 ** 10.5)
  })
})

describe('clusterStops', () => {
  it('groups nearby stops into one cluster with their count, centre and bounds, and drops stops out of view', () => {
    const { stops, clusters } = clusterStops(STOPS, BRISBANE, 12)
    expect(stops.map((s) => s.id)).toEqual(['c'])
    expect(clusters).toHaveLength(1)
    const [c] = clusters
    expect(c?.count).toBe(2)
    expect(c?.lat).toBeCloseTo(-27.46865)
    expect(c?.bounds).toEqual({ west: 153.0235, south: -27.4688, east: 153.0237, north: -27.4685 })
  })

  it('shows every stop on its own from the cluster zoom', () => {
    const { stops, clusters } = clusterStops(STOPS, BRISBANE, CLUSTER_MAX_ZOOM)
    expect(clusters).toEqual([])
    expect(stops.map((s) => s.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('zoomed right out, everything in view is one cluster', () => {
    const { stops, clusters } = clusterStops(STOPS, BRISBANE, 4)
    expect(stops).toEqual([])
    expect(clusters.map((c) => c.count)).toEqual([3])
  })

  it('keeps the same clusters when the view pans (cells are anchored to the world, not the view)', () => {
    const shifted = { west: 152.95, south: -27.55, east: 153.25, north: -27.25 }
    expect(clusterStops(STOPS, shifted, 12).clusters.map((c) => c.id)).toEqual(
      clusterStops(STOPS, BRISBANE, 12).clusters.map((c) => c.id),
    )
  })

  it('cells are screen pixels at the fractional zoom: stops two cells apart never share a cluster', () => {
    for (const zoom of [12, 13.4, 14.5, 15.9]) {
      // Longitude per screen pixel at this zoom (MapLibre: 512 * 2^zoom px around the world).
      const perPx = 360 / (512 * 2 ** zoom)
      const pair = [stop('p', -27.47, 153.02), stop('q', -27.47, 153.02 + 2.2 * CLUSTER_CELL_PX * perPx)]
      const { clusters } = clusterStops(pair, BRISBANE, zoom)
      expect(clusters, `zoom ${zoom}`).toEqual([])
    }
    // At zoom 15.9 a cell is 56 px: stops 202 px apart (Codex probe) stay apart, stops 1 px apart group.
    const perPx = 360 / (512 * 2 ** 15.9)
    expect(
      clusterStops([stop('p', -27.47, 153.02), stop('q', -27.47, 153.02 + 202 * perPx)], BRISBANE, 15.9)
        .clusters,
    ).toEqual([])
  })

  it('handles 12,000 stops quickly enough to run on every map move', () => {
    const many = Array.from({ length: 12_000 }, (_, i) =>
      stop(String(i), -27.6 + (i % 120) * 0.0025, 152.9 + Math.floor(i / 120) * 0.003),
    )
    const t0 = performance.now()
    const { stops, clusters } = clusterStops(many, BRISBANE, 12)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(stops.length + clusters.reduce((n, c) => n + c.count, 0)).toBe(12_000)
    expect(clusters.length).toBeLessThan(1_500)
  })
})

describe('visibleStops (the keyboard list)', () => {
  it('lists only stops in view, nearest the centre first, capped', () => {
    const view = { west: 153.0, south: -27.49, east: 153.05, north: -27.45 }
    expect(visibleStops(STOPS, view).map((s) => s.id)).toEqual(['b', 'a'])
    expect(visibleStops(STOPS, BRISBANE, 2)).toHaveLength(2)
    expect(visibleStops(STOPS, BRISBANE).map((s) => s.id)).not.toContain('far')
  })
})

describe('selectionReducer', () => {
  it('a tap opens that stop, another tap moves to the other one, close clears it', () => {
    let s = initialSelection()
    expect(s).toEqual({ mode: 'single', active: null })
    s = selectionReducer(s, { type: 'tap', id: 'a' })
    expect(s.active).toBe('a')
    const same = selectionReducer(s, { type: 'tap', id: 'a' })
    expect(same).toBe(s)
    s = selectionReducer(s, { type: 'tap', id: 'b' })
    expect(s.active).toBe('b')
    s = selectionReducer(s, { type: 'close' })
    expect(s.active).toBeNull()
    expect(selectionReducer(s, { type: 'close' })).toBe(s)
  })
})

describe('the remembered map flag', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('is off on a first visit, on after the map was used, off again after the list was chosen', () => {
    expect(readMapPref()).toBe(false)
    writeMapPref(true)
    expect(localStorage.getItem(MAP_PREF_KEY)).toBe('1')
    expect(readMapPref()).toBe(true)
    writeMapPref(false)
    expect(localStorage.getItem(MAP_PREF_KEY)).toBeNull()
    expect(readMapPref()).toBe(false)
  })

  it('never throws when storage is blocked, and reads as off', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeMapPref(true)).not.toThrow()
    expect(readMapPref()).toBe(false)
  })
})
