/**
 * Unplanned trains (smoke round 35): TransLink's ADDED trips carry no trip_headsign and have no timetable. The board
 * row is named after the trip's last stop and gets its platform from the boarding stop id, as scheduled rows do; the
 * trip's stops have no scheduled times, so no client can measure a delay from 0.
 */
import { describe, expect, it } from 'vitest'
import {
  addedTripHeadsign,
  addedTripStops,
  Departure,
  gtfsToEpoch,
  mergeDepartures,
  type RtSnapshot,
  type RtTrip,
  type StaticStopDay,
  TripStop,
} from '../src/index.ts'

const D = '20261023'
const at = (s: number) => gtfsToEpoch(D, s)
const now = at(23 * 3600)

// Central: platform 5 (c5) is not in the stop-day file's stops that evening, platform 4 (c4) is.
const day: StaticStopDay = {
  schemaVersion: 1,
  mode: 'train',
  stopKey: 'central',
  serviceDate: D,
  trips: ['T1'],
  routes: [{ id: 'BRSH-1', short: 'BRSH', color: '4778B2' }],
  headsigns: ['Shorncliffe station'],
  stops: [{ id: 'c4', name: 'Central station, platform 4', platform: '4', key: 'central' }],
  downstreams: [[]],
  events: [[0, 5, 23 * 3600 + 600, 23 * 3600 + 600, 0, 0, 0, 0, 0, 0]],
}

const unplanned = (headsign: string, boardAt = 'c5'): RtTrip => ({
  key: `rt:UNPLANNED@${D}`,
  rel: 'ADDED',
  ts: now,
  updates: [],
  added: {
    route: { id: 'SHBR-1', short: 'SHBR', color: '4778B2' },
    headsign,
    directionId: -1,
    stops: [
      { stopId: 'v2', seq: 12, arr: now + 60, dep: now + 60 },
      { stopId: boardAt, seq: 13, arr: now + 240, dep: now + 270 },
      { stopId: 'r8', seq: 14, arr: now + 480, dep: now + 480 },
    ],
  },
})

const snap = (trips: RtTrip[]): RtSnapshot => ({
  header: {
    schemaVersion: 1,
    seq: 1,
    staticGeneration: { train: 'g1' },
    serviceDates: [D],
    sourceTimestamp: now,
    fetchedAt: now * 1000,
  },
  trips: Object.fromEntries(trips.map((t) => [t.key, t])),
  vehicles: [],
  alerts: [],
})

const NAMES: Record<string, string> = {
  r8: 'Roma Street station',
  c5: 'Central station',
  v2: 'Fortitude Valley station',
}
const stopName = (id: string) => NAMES[id]
/** Every platform of Central, as the edge passes them (the station's stop ids). */
const CENTRAL = new Set(['c4', 'c5'])
const platforms = new Map([
  ['c4', '4'],
  ['c5', '5'],
])

const addedRow = (rows: Departure[]) => rows.find((r) => r.tripInstance.startsWith('rt:'))

describe('an ADDED trip with no headsign', () => {
  it('is named after its last stop on the board row', () => {
    const rows = mergeDepartures([day], snap([unplanned('')]), {
      nowS: now,
      rtState: 'live',
      boardingStopIds: CENTRAL,
      stationPlatforms: platforms,
      stopName,
    })
    expect(addedRow(rows)).toMatchObject({ headsign: 'Roma Street station', status: 'live' })
    expect(Departure.safeParse(addedRow(rows)).success).toBe(true)
  })

  it('keeps a real trip headsign', () => {
    const rows = mergeDepartures([day], snap([unplanned('Shorncliffe station')]), {
      nowS: now,
      rtState: 'live',
      boardingStopIds: CENTRAL,
      stopName,
    })
    expect(addedRow(rows)?.headsign).toBe('Shorncliffe station')
  })

  it('is left unnamed, not misnamed, when no stop names are given', () => {
    expect(addedTripHeadsign(unplanned('').added as NonNullable<RtTrip['added']>)).toBe('')
    expect(addedTripHeadsign(unplanned('').added as NonNullable<RtTrip['added']>, () => undefined)).toBe('')
  })
})

describe("an ADDED trip's platform", () => {
  it('comes from the boarding stop id: the station platforms', () => {
    const rows = mergeDepartures([day], snap([unplanned('')]), {
      nowS: now,
      rtState: 'live',
      boardingStopIds: CENTRAL,
      stationPlatforms: platforms,
    })
    expect(addedRow(rows)).toMatchObject({ stopId: 'c5', platform: '5' })
  })

  it("comes from the boarding stop id: the stop-day file's stops", () => {
    const rows = mergeDepartures([day], snap([unplanned('', 'c4')]), {
      nowS: now,
      rtState: 'live',
      boardingStopIds: CENTRAL,
    })
    expect(addedRow(rows)).toMatchObject({ stopId: 'c4', platform: '4' })
  })

  it('is null for a stop without one (bus, ferry)', () => {
    const rows = mergeDepartures([day], snap([unplanned('', 'x9')]), {
      nowS: now,
      rtState: 'live',
      boardingStopIds: new Set(['x9']),
    })
    expect(addedRow(rows)).toMatchObject({ stopId: 'x9', platform: null })
  })
})

describe("an ADDED trip's stops", () => {
  it('have live estimates and no scheduled times', () => {
    const stops = addedTripStops(unplanned('').added as NonNullable<RtTrip['added']>)
    expect(stops.map((s) => [s.stopId, s.schedArr, s.schedDep, s.estArr, s.estDep, s.status])).toEqual([
      ['v2', null, null, now + 60, now + 60, 'live'],
      ['c5', null, null, now + 240, now + 270, 'live'],
      ['r8', null, null, now + 480, now + 480, 'live'],
    ])
    for (const s of stops) expect(TripStop.safeParse(s).success).toBe(true)
  })

  it('never leave before they arrive', () => {
    const added = unplanned('').added as NonNullable<RtTrip['added']>
    const early = { ...added, stops: [{ stopId: 'a', seq: 1, arr: 100, dep: 90 }, ...added.stops] }
    expect(addedTripStops(early)[0]).toMatchObject({ estArr: 100, estDep: 100 })
  })
})
