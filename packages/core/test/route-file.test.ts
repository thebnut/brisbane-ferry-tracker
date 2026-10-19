/** routeFileFor: data/bus/routes/{short}.json, the route page's stop list (two busiest patterns per direction). */
import { describe, expect, it } from 'vitest'
import { type Line, RouteFile, routeFileFor, type StopIndexEntry } from '../src/index.ts'

const stop = (key: string, name: string, code?: string): StopIndexEntry => ({
  key,
  name,
  ...(code ? { code } : {}),
  lat: -27.4 - Number(key) / 1e4,
  lon: 153 + Number(key) / 1e4,
  routes: ['66'],
})
const index = new Map(
  [
    stop('1', 'UQ Lakes', '001001'),
    stop('2', 'Boggo Road'),
    stop('3', 'Cultural Centre'),
    stop('4', 'RBWH'),
  ].map((s) => [s.key, s]),
)
// lines.json order: busiest first.
const line: Line = {
  short: '66',
  long: 'UQ Lakes - RBWH',
  color: 'E463A4',
  textColor: '1D1D1D',
  routeIds: ['66-4321'],
  patterns: [
    { directionId: 0, headsign: 'RBWH', stops: ['1', '2', '3', '4'], trips: 300 },
    { directionId: 1, headsign: 'UQ Lakes', stops: ['4', '3', '2', '1'], trips: 290 },
    { directionId: 0, headsign: 'Cultural Centre', stops: ['1', '2', '3'], trips: 40 },
    { directionId: 0, headsign: 'Boggo Road', stops: ['1', '2'], trips: 5 },
    { directionId: 1, headsign: 'UQ Lakes', stops: ['3', '2', '1'], trips: 4 },
    { directionId: 1, headsign: 'Boggo Road', stops: ['3', '2'], trips: 1 },
  ],
}

describe('routeFileFor', () => {
  it('keeps the two busiest patterns per direction, in the line order, as a contract-valid file', () => {
    const rf = routeFileFor(line, index, 'g1')
    expect(rf && RouteFile.parse(rf)).toEqual(rf)
    expect(rf).toMatchObject({
      schemaVersion: 1,
      mode: 'bus',
      generation: 'g1',
      short: '66',
      long: 'UQ Lakes - RBWH',
      color: 'E463A4',
      textColor: '1D1D1D',
    })
    expect(rf?.patterns.map((p) => [p.directionId, p.headsign, p.trips])).toEqual([
      [0, 'RBWH', 300],
      [1, 'UQ Lakes', 290],
      [0, 'Cultural Centre', 40],
      [1, 'UQ Lakes', 4],
    ])
  })

  it('names and positions each stop from the index, with the stop code only when there is one', () => {
    const stops = routeFileFor(line, index, 'g1')?.patterns[0]?.stops
    expect(stops?.map((s) => s.name)).toEqual(['UQ Lakes', 'Boggo Road', 'Cultural Centre', 'RBWH'])
    const at = (k: string) => ({ lat: index.get(k)?.lat, lon: index.get(k)?.lon })
    expect(stops?.[0]).toEqual({ key: '1', name: 'UQ Lakes', code: '001001', ...at('1') })
    expect(stops?.[1]).toEqual({ key: '2', name: 'Boggo Road', ...at('2') })
    // No routes, platforms or boardAt: the file carries only what the page shows.
    expect(Object.keys(stops?.[0] ?? {})).toEqual(['key', 'name', 'code', 'lat', 'lon'])
  })

  it('drops stops missing from the index, and a pattern left with none does not take a slot', () => {
    const rf = routeFileFor(
      {
        ...line,
        patterns: [
          { directionId: 0, headsign: 'Nowhere', stops: ['x', 'y'], trips: 500 },
          { directionId: 0, headsign: 'RBWH', stops: ['1', 'x', '4'], trips: 300 },
          { directionId: 0, headsign: 'Boggo Road', stops: ['1', '2'], trips: 5 },
        ],
      },
      index,
      'g1',
    )
    expect(rf?.patterns.map((p) => p.headsign)).toEqual(['RBWH', 'Boggo Road'])
    expect(rf?.patterns[0]?.stops.map((s) => s.key)).toEqual(['1', '4'])
  })

  it('is null for a line with no known stop, or a short name the route page does not accept', () => {
    expect(routeFileFor({ ...line, patterns: [] }, index, 'g1')).toBeNull()
    expect(
      routeFileFor(
        { ...line, patterns: [{ directionId: 0, headsign: 'X', stops: ['z'], trips: 1 }] },
        index,
        'g1',
      ),
    ).toBeNull()
    expect(routeFileFor({ ...line, short: 'a/b' }, index, 'g1')).toBeNull()
    expect(routeFileFor({ ...line, short: '1234567890123' }, index, 'g1')).toBeNull()
    expect(routeFileFor({ ...line, short: 'P-137_x' }, index, 'g1')?.short).toBe('P-137_x')
  })

  it('omits long name and colours the line does not have', () => {
    const rf = routeFileFor({ short: '400', routeIds: ['400-1'], patterns: line.patterns }, index, 'g1')
    expect(rf && 'long' in rf).toBe(false)
    expect(rf && ('color' in rf || 'textColor' in rf)).toBe(false)
  })
})
