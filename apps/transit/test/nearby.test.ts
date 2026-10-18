import type { GeoTileFile } from '@bft/core/contract'
import { geohashBounds, geohashEncode, geohashNeighbourhood } from '@bft/core/geo'
import { describe, expect, it } from 'vitest'
import { cellsFor, computeNearby, cue, type NearbyMode, walkMinutes } from '../app/lib/nearby.ts'

const tile = (mode: NearbyMode, gh: string, stops: GeoTileFile['stops']): GeoTileFile => ({
  schemaVersion: 1,
  mode,
  generation: 'g',
  geohash: gh,
  stops,
})

/** Metres → degrees of longitude at a latitude. */
const dLon = (m: number, lat: number) => m / (111_320 * Math.cos((lat * Math.PI) / 180))

describe('Around you across modes', () => {
  it('asks for the own cell plus 8 neighbours', () => {
    const cells = cellsFor(-27.4717, 153.0206)
    expect(cells[0]).toBe(geohashEncode(-27.4717, 153.0206, 5))
    expect(new Set(cells).size).toBe(9)
  })

  it('finds a stop 30 m away across a tile edge before one 500 m away in the same tile', () => {
    const h = geohashEncode(-27.47, 153.02, 5)
    const b = geohashBounds(h)
    const lat = (b.latLo + b.latHi) / 2
    const me = { lat, lon: b.lonHi - dLon(10, lat) }
    const east = geohashNeighbourhood(h).find(
      (x) => geohashBounds(x).lonLo === b.lonHi && geohashBounds(x).latLo === b.latLo,
    )
    expect(east).toBeDefined()
    const across = { key: 'across', name: 'Across', lat, lon: b.lonHi + dLon(20, lat) }
    const inside = { key: 'inside', name: 'Inside', lat, lon: b.lonHi - dLon(500, lat) }
    const r = computeNearby(me.lat, me.lon, {
      bus: [tile('bus', h, [inside]), tile('bus', east as string, [across])],
    })
    expect(r.byMode.bus.map((s) => s.key)).toEqual(['across', 'inside'])
    expect(r.byMode.bus[0]?.metres).toBeGreaterThan(25)
    expect(r.byMode.bus[0]?.metres).toBeLessThan(35)
  })

  it('groups by mode, nearest first overall, and keeps the closest of a mode even beyond the radius', () => {
    const lat = -27.4717
    const lon = 153.0206
    const at = (m: number) => lon + dLon(m, lat)
    const r = computeNearby(lat, lon, {
      ferry: [tile('ferry', 'r7hgd', [{ key: 'f1', name: 'F', lat, lon: at(2500) }])],
      train: [
        tile('train', 'r7hgd', [
          { key: 't1', name: 'T', lat, lon: at(300) },
          { key: 't2', name: 'T2', lat, lon: at(1500) },
        ]),
      ],
      bus: [null, tile('bus', 'r7hgd', [{ key: 'b1', name: 'B', lat, lon: at(50) }])],
    })
    expect(r.stops.map((s) => s.key)).toEqual(['b1', 't1', 'f1'])
    expect(r.byMode.ferry.map((s) => s.key)).toEqual(['f1'])
    expect(r.byMode.train.map((s) => s.key)).toEqual(['t1'])
    expect(r.byMode.train.every((s) => s.mode === 'train')).toBe(true)
  })

  it('sorts realistic CBD tiles for all three modes in well under 100 ms', () => {
    // About what 9 tiles hold around the CBD: ~4,000 bus stops, 40 stations, 20 terminals.
    const lat = -27.4717
    const lon = 153.0206
    const rand = (i: number) => ((i * 9301 + 49297) % 233280) / 233280
    const spread = (mode: NearbyMode, n: number) =>
      Array.from({ length: 9 }, (_, t) =>
        tile(
          mode,
          `t${t}xxx`.slice(0, 5),
          Array.from({ length: Math.ceil(n / 9) }, (_, i) => ({
            key: `${mode}${t}-${i}`,
            name: `${mode} ${i}`,
            lat: lat + (rand(i * 7 + t) - 0.5) * 0.12,
            lon: lon + (rand(i * 13 + t) - 0.5) * 0.12,
          })),
        ),
      )
    const tiles = { ferry: spread('ferry', 20), train: spread('train', 40), bus: spread('bus', 4000) }
    computeNearby(lat, lon, tiles) // warm up the JIT
    const runs = Array.from({ length: 5 }, () => computeNearby(lat, lon, tiles).ms)
    expect(Math.max(...runs)).toBeLessThan(100)
    expect(Math.min(...runs)).toBeLessThan(25)
  })

  it('walk time and the make-it cue', () => {
    expect(walkMinutes(30)).toBe(1)
    expect(walkMinutes(400)).toBe(5)
    expect(cue(2, 3).text).toBe('Too late')
    expect(cue(5, 3).text).toBe('Hurry')
    expect(cue(9, 3).text).toBe('On your way')
    expect(cue(30, 3)).toEqual({ text: 'Plenty of time', tone: 'good' })
  })
})
