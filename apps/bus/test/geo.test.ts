import { describe, expect, it } from 'vitest'
import {
  cellsCovering,
  formatDistance,
  geohashBounds,
  geohashEncode,
  geohashNeighbourhood,
  haversine,
  nearest,
} from '../app/lib/geo.ts'

describe('geohash', () => {
  it('encodes known points (same as the pipeline encoder)', () => {
    // Cultural Centre busway, Brisbane.
    expect(geohashEncode(-27.473232, 153.019415, 5)).toBe('r7hgd')
    expect(geohashEncode(57.64911, 10.40744, 11)).toBe('u4pruydqqvj')
  })

  it('bounds contain the encoded point', () => {
    const b = geohashBounds(geohashEncode(-27.47, 153.02, 5))
    expect(b.latLo).toBeLessThanOrEqual(-27.47)
    expect(b.latHi).toBeGreaterThan(-27.47)
    expect(b.lonLo).toBeLessThanOrEqual(153.02)
    expect(b.lonHi).toBeGreaterThan(153.02)
  })

  it('neighbourhood is the cell plus 8 distinct adjacent cells', () => {
    const h = geohashEncode(-27.47, 153.02, 5)
    const n = geohashNeighbourhood(h)
    expect(n[0]).toBe(h)
    expect(new Set(n).size).toBe(9)
    const c = geohashBounds(h)
    for (const x of n.slice(1)) {
      const b = geohashBounds(x)
      // Each neighbour touches the centre cell (shares an edge or a corner).
      const touchLat =
        Math.abs(b.latLo - c.latHi) < 1e-9 || Math.abs(b.latHi - c.latLo) < 1e-9 || b.latLo === c.latLo
      const touchLon =
        Math.abs(b.lonLo - c.lonHi) < 1e-9 || Math.abs(b.lonHi - c.lonLo) < 1e-9 || b.lonLo === c.lonLo
      expect(touchLat && touchLon).toBe(true)
    }
  })

  it('finds the nearest stop across a tile edge', () => {
    // A point 20 m inside the east edge of its cell; one stop 40 m away across the edge (another tile) and one
    // 600 m away inside the same tile. The cross-edge stop must come first.
    const h = geohashEncode(-27.47, 153.02, 5)
    const b = geohashBounds(h)
    const lat = (b.latLo + b.latHi) / 2
    const dLon20m = 20 / (111_320 * Math.cos((lat * Math.PI) / 180))
    const me = { lat, lon: b.lonHi - dLon20m }
    const across = { key: 'across', lat, lon: b.lonHi + dLon20m }
    const inside = { key: 'inside', lat, lon: b.lonHi - 31 * dLon20m }
    expect(geohashEncode(across.lat, across.lon, 5)).not.toBe(h)
    expect(geohashNeighbourhood(h)).toContain(geohashEncode(across.lat, across.lon, 5))
    const r = nearest(me.lat, me.lon, [inside, across])
    expect(r.map((s) => s.key)).toEqual(['across', 'inside'])
    expect(r[0]?.metres).toBeGreaterThan(35)
    expect(r[0]?.metres).toBeLessThan(45)
  })

  it('nearest de-duplicates, limits and caps distance', () => {
    const s = [
      { key: 'a', lat: -27.47, lon: 153.02 },
      { key: 'a', lat: -27.47, lon: 153.02 },
      { key: 'b', lat: -27.48, lon: 153.02 },
      { key: 'c', lat: -27.6, lon: 153.02 },
    ]
    expect(nearest(-27.47, 153.02, s, { maxMetres: 2000 }).map((x) => x.key)).toEqual(['a', 'b'])
    expect(nearest(-27.47, 153.02, s, { limit: 1 })).toHaveLength(1)
  })

  it('haversine and distance text', () => {
    expect(haversine(-27.47, 153.02, -27.48, 153.02)).toBeCloseTo(1112, -1)
    expect(formatDistance(123)).toBe('120 m')
    expect(formatDistance(1890)).toBe('1.9 km')
  })

  it('covers a small view with tiles and refuses a large one', () => {
    const small = cellsCovering({ west: 153.0, south: -27.49, east: 153.04, north: -27.46 })
    expect(small?.length).toBeGreaterThan(0)
    expect(small).toContain(geohashEncode(-27.47, 153.02, 5))
    expect(cellsCovering({ west: 152.5, south: -28, east: 153.5, north: -27 })).toBeNull()
  })
})
