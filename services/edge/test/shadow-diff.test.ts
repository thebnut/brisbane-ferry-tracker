import type { Departure } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { comparePair, legacyWindow, processGitHubDepartures } from '../scripts/shadow-diff.ts'

const T = (iso: string) => Date.parse(iso) / 1000
const file = {
  generated: '2026-10-19T20:00:00Z',
  validFrom: '2026-10-20T06:00:00Z',
  validTo: '2026-10-22T00:00:00Z',
  ferryStops: {},
  departures: [
    { tripId: 'A', routeId: 'F1-4055', stopId: 'X', stopSequence: 1, departureTime: '2026-10-19T22:00:00Z' },
    { tripId: 'A', routeId: 'F1-4055', stopId: 'Y', stopSequence: 2, departureTime: '2026-10-19T22:10:00Z' },
    { tripId: 'B', routeId: 'F11-4055', stopId: 'X', stopSequence: 1, departureTime: '2026-10-19T22:30:00Z' },
    { tripId: 'B', routeId: 'F11-4055', stopId: 'Y', stopSequence: 2, departureTime: '2026-10-19T22:40:00Z' },
    // Cross-river route the legacy app never shows.
    { tripId: 'C', routeId: 'F21-4055', stopId: 'X', stopSequence: 1, departureTime: '2026-10-19T22:45:00Z' },
    { tripId: 'C', routeId: 'F21-4055', stopId: 'Y', stopSequence: 2, departureTime: '2026-10-19T22:50:00Z' },
  ],
}

const dep = (trip: string, route: string, d: string, a: string): Departure => ({
  tripInstance: `${trip}@20261020`,
  stopSequence: 1,
  route: { id: route, short: route.split('-')[0] as string },
  headsign: '',
  directionId: 0,
  stopId: 'X',
  platform: null,
  schedDep: T(d),
  estDep: null,
  schedArrTo: T(a),
  estArrTo: null,
  status: 'scheduled',
  gps: false,
  vehicleId: null,
})

describe('shadow diff', () => {
  const now = new Date('2026-10-19T21:00:00Z')
  const legacy = processGitHubDepartures(legacyWindow(file as never, now), {
    outbound: { id: 'X' },
    inbound: { id: 'Y' },
  })
  const until = now.getTime() + 24 * 3600 * 1000

  it('the legacy port keeps F1/F11 rows in direction, with destination departure as arrival', () => {
    expect(legacy.filter((d) => d.direction === 'outbound').map((d) => d.tripId)).toEqual(['A', 'B'])
  })

  it('identical rows match; other routes are informational', () => {
    const r = comparePair(
      'X',
      'Y',
      legacy,
      [
        dep('A', 'F1-4055', '2026-10-19T22:00:00Z', '2026-10-19T22:10:00Z'),
        dep('B', 'F11-4055', '2026-10-19T22:30:20Z', '2026-10-19T22:40:00Z'),
        dep('C', 'F21-4055', '2026-10-19T22:45:00Z', '2026-10-19T22:50:00Z'),
      ],
      until,
    )
    expect(r).toMatchObject({ matched: 2, legacyOnly: [], v1Only: [], timeMismatch: [], v1OtherRoutes: 1 })
  })

  it('reports missing trips, extra trips and times beyond ±1 min', () => {
    const r = comparePair(
      'X',
      'Y',
      legacy,
      [
        dep('A', 'F1-4055', '2026-10-19T22:02:00Z', '2026-10-19T22:10:00Z'),
        dep('Z', 'F1-4055', '2026-10-19T23:00:00Z', '2026-10-19T23:10:00Z'),
      ],
      until,
    )
    expect(r.timeMismatch.map((m) => m.legacy.tripId)).toEqual(['A'])
    expect(r.legacyOnly.map((x) => x.tripId)).toEqual(['B'])
    expect(r.v1Only.map((x) => x.tripId)).toEqual(['Z'])
  })
})
