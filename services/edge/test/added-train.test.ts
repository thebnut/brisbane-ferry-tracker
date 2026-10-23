/**
 * An unplanned train (smoke round 35): an ADDED trip with no trip_headsign. Its trip page is named after its last
 * station, each stop carries its platform and station key as a timetabled train's do, and no stop has a timetable.
 */
import { TripResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { silentLogger } from '../src/log.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { HubCore } from '../src/rt/hub-core.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import {
  buildTree,
  Clock,
  D,
  epoch,
  FakeStorage,
  FakeUpstream,
  feed,
  storeFor,
  tripUpdate,
} from './fixtures.ts'

const station = (key: string, name: string, platforms: Array<{ id: string; code: string }>) => ({
  key,
  name,
  lat: -27.46,
  lon: 153.02,
  routes: ['BRSH'],
  platforms,
})

const TRAIN_STOPS = {
  schemaVersion: 1 as const,
  mode: 'train' as const,
  generation: 'g-added',
  stops: [
    station('fortitude-valley', 'Fortitude Valley station', [{ id: '600013', code: '2' }]),
    station('central', 'Central station', [
      { id: '600020', code: '4' },
      { id: '600019', code: '5' },
    ]),
    station('roma-street', 'Roma Street station', [{ id: '600029', code: '8' }]),
  ],
}

async function trainApp() {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const trips = {
    [D]: [
      {
        id: 'BRSH1',
        route: 'BRSH-5186',
        headsign: 'Shorncliffe station',
        stops: [
          ['600029', '08:00:00'],
          ['600020', '08:04:00'],
          ['600013', '08:07:00'],
        ] as Array<[string, string]>,
      },
      {
        // An ADDED trip resolves only against known static stops: platform 5 is one.
        id: 'SPBR1',
        route: 'SPBR-5186',
        headsign: 'Roma Street station',
        stops: [
          ['600019', '09:00:00'],
          ['600029', '09:04:00'],
        ] as Array<[string, string]>,
      },
    ],
  }
  const tree = buildTree('g-added', trips, 'train')
  tree.source.files.set('data/train/stops.json', new TextEncoder().encode(JSON.stringify(TRAIN_STOPS)))
  const up = new FakeUpstream()
  const nowS = Math.floor(clock.t / 1000)
  up.set(
    'TripUpdates/Rail',
    feed(nowS, [
      tripUpdate('u', { tripId: 'UNPLANNED1', startDate: D, routeId: 'BRSH-5186', scheduleRelationship: 1 }, [
        { seq: 1, stopId: '600013', depTime: epoch(D, '08:05:00') },
        { seq: 2, stopId: '600019', arrTime: epoch(D, '08:08:00'), depTime: epoch(D, '08:09:00') },
        { seq: 3, stopId: '600029', arrTime: epoch(D, '08:12:00') },
      ]),
    ]),
  )
  up.set('VehiclePositions/Rail', feed(nowS, []))
  up.set('alerts', feed(nowS, []))
  const hub = new HubCore({
    storage: new FakeStorage(),
    fetch: up.fetch,
    now: clock.now,
    store: storeFor(tree, clock.now),
    config: parseRtModes('train'),
    upstream: 'https://up.test/api/realtime/SEQ',
  })
  for (let i = 0; i < 3; i++) {
    await hub.cycle()
    clock.advance(1000)
  }
  return createApp({
    store: storeFor(tree, clock.now),
    snapshots: new SnapshotClient(
      { pull: (s) => hub.pull(s), getRaw: (k) => hub.getRaw(k) },
      clock.now,
      () => {},
      null,
    ),
    now: clock.now,
    log: silentLogger,
    combinedFeeds: false,
    polledModes: ['train'],
  })
}

describe('/v1/train/trips/rt:…', () => {
  it('names the unplanned train after its last station, with platforms and no timetable', async () => {
    const app = await trainApp()
    const res = await app.request(`/v1/train/trips/${encodeURIComponent(`rt:UNPLANNED1@${D}`)}`)
    expect(res.status).toBe(200)
    const trip = TripResponse.parse(await res.json())
    expect(trip.headsign).toBe('Roma Street station')
    expect(trip.status).toBe('live')
    expect(trip.stops.map((s) => [s.stopId, s.stationKey, s.platform, s.schedArr, s.schedDep])).toEqual([
      ['600013', 'fortitude-valley', '2', null, null],
      ['600019', 'central', '5', null, null],
      ['600029', 'roma-street', '8', null, null],
    ])
    expect(trip.stops[1]).toMatchObject({ estArr: epoch(D, '08:08:00'), estDep: epoch(D, '08:09:00') })
  })
})
