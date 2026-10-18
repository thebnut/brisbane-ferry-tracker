/**
 * Train platform changes: the RT stop-time update names another platform of the same parent station.
 * Station "central" has platforms c1 (code 1), c2 (code 2) and c4 (code 4, unused by the timetable that day).
 */
import { describe, expect, it } from 'vitest'
import {
  Departure,
  gtfsToEpoch,
  mergeDepartures,
  platformChange,
  type RtSnapshot,
  type RtTrip,
  type StaticStopDay,
} from '../src/index.ts'

const D = '20261020'
const at = (s: number) => gtfsToEpoch(D, s)

const day: StaticStopDay = {
  schemaVersion: 1,
  mode: 'train',
  stopKey: 'central',
  serviceDate: D,
  trips: ['T1', 'T2', 'T3'],
  routes: [{ id: 'BRSP-1', short: 'BRSP', color: '6CC6E9' }],
  headsigns: ['Springfield Central station'],
  stops: [
    { id: 'c1', name: 'Central station, platform 1', platform: '1', key: 'central' },
    { id: 'c2', name: 'Central station, platform 2', platform: '2', key: 'central' },
    { id: 'r1', name: 'Roma Street station, platform 7', platform: '7', key: 'roma-street' },
  ],
  events: [
    [0, 5, 36000, 36000, 0, 0, 0, 0, 0, [2, 180, 0, 1]],
    [1, 5, 36600, 36600, 0, 0, 1, 0, 0, [2, 180, 0, 1]],
    [2, 5, 37200, 37200, 0, 0, 0, 0, 0, [2, 180, 0, 1]],
  ],
}

const trip = (id: string, stopId: string | undefined, depDelay = 0): RtTrip => ({
  key: `${id}@${D}`,
  rel: 'SCHEDULED',
  ts: at(35000),
  updates: [{ seq: 5, stopId, rel: 'SCHEDULED', depDelay }],
})

const snap = (trips: RtTrip[]): RtSnapshot => ({
  header: {
    schemaVersion: 1,
    seq: 1,
    staticGeneration: { train: 'g1' },
    serviceDates: [D],
    sourceTimestamp: at(35000),
    fetchedAt: at(35000) * 1000,
  },
  trips: Object.fromEntries(trips.map((t) => [t.key, t])),
  vehicles: [],
  alerts: [],
})

const merge = (rt: RtSnapshot, platforms?: Map<string, string>) =>
  mergeDepartures([day], rt, { nowS: at(35000), rtState: 'live', stationPlatforms: platforms })

describe('platform change', () => {
  it('moves the row to the new platform of the same station and keeps the timetabled one', () => {
    const [t1] = merge(snap([trip('T1', 'c2', 60)]))
    expect(t1).toMatchObject({ stopId: 'c2', platform: '2', scheduledPlatform: '1', status: 'live' })
    expect(Departure.safeParse(t1).success).toBe(true)
  })

  it('same platform, or an update without a stop id, is not a change', () => {
    const rows = merge(snap([trip('T1', 'c1'), trip('T2', undefined)]))
    for (const r of rows) expect(r.scheduledPlatform).toBeUndefined()
    expect(rows.map((r) => r.platform)).toEqual(['1', '2', '1'])
  })

  it('a stop id from another station is never a platform change', () => {
    const [t1] = merge(snap([trip('T1', 'r1')]))
    expect(t1).toMatchObject({ stopId: 'c1', platform: '1' })
    expect(t1?.scheduledPlatform).toBeUndefined()
  })

  it('recognises a platform the timetable does not use that day when given the station platforms', () => {
    const rt = snap([trip('T3', 'c4')])
    expect(merge(rt)[2]?.scheduledPlatform).toBeUndefined()
    const platforms = new Map([
      ['c1', '1'],
      ['c2', '2'],
      ['c4', '4'],
    ])
    expect(merge(rt, platforms)[2]).toMatchObject({ stopId: 'c4', platform: '4', scheduledPlatform: '1' })
  })

  it('no change is shown when the trip is cancelled or RT is not live', () => {
    const cancelled: RtTrip = { ...trip('T1', 'c2'), rel: 'CANCELED' }
    expect(merge(snap([cancelled]))[0]?.scheduledPlatform).toBeUndefined()
    const stale = mergeDepartures([day], snap([trip('T1', 'c2')]), { nowS: at(35000), rtState: 'stale' })
    expect(stale[0]).toMatchObject({ platform: '1', status: 'scheduled' })
  })

  it('platformChange ignores ferry-style stops without a station key', () => {
    const ferry = {
      stopKey: 'A',
      stops: [
        { id: 'A', name: 'A' },
        { id: 'B', name: 'B' },
      ],
    }
    expect(platformChange(trip('T1', 'B'), 5, ferry.stops[0], ferry)).toBeNull()
  })
})
