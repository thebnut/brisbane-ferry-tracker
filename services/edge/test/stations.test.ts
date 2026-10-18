import { DeparturesResponse, TripResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { silentLogger } from '../src/log.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { HubCore } from '../src/rt/hub-core.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import { buildStations, tripStopPlatform } from '../src/stations.ts'
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

const STOPS = {
  schemaVersion: 1 as const,
  mode: 'train' as const,
  generation: 'g1',
  stops: [
    {
      key: 'central',
      name: 'Central',
      lat: 0,
      lon: 0,
      routes: [],
      platforms: [
        { id: 'C1', code: '1' },
        { id: 'C2', code: '2' },
      ],
    },
    {
      key: 'roma-street',
      name: 'Roma Street',
      lat: 0,
      lon: 0,
      routes: [],
      platforms: [{ id: 'R5', code: '5' }],
    },
  ],
}

describe('station platforms', () => {
  const st = buildStations(STOPS)

  it('timetabled platform and station key', () => {
    expect(tripStopPlatform(st, 'C1', undefined)).toEqual({ platform: '1', stationKey: 'central' })
  })
  it('a live move to another platform of the same station is a platform change', () => {
    expect(tripStopPlatform(st, 'C1', { seq: 1, stopId: 'C2', rel: 'SCHEDULED' })).toEqual({
      platform: '2',
      scheduledPlatform: '1',
      stationKey: 'central',
    })
  })
  it('a stop id from another station is never a platform change', () => {
    expect(tripStopPlatform(st, 'C1', { seq: 1, stopId: 'R5', rel: 'SCHEDULED' })).toEqual({
      platform: '1',
      stationKey: 'central',
    })
    expect(tripStopPlatform(st, 'X', undefined)).toEqual({})
  })
})

describe('/v1/train', () => {
  it('departures carry stopping patterns; trip detail reports a live platform change', async () => {
    const clock = new Clock(epoch(D, '07:55:00') * 1000)
    const trips = {
      [D]: [
        {
          id: 'RT1',
          route: 'BRCL-5202',
          stops: [
            ['C1', '08:00:00'],
            ['R5', '08:04:00'],
          ] as Array<[string, string]>,
        },
      ],
    }
    const tree = buildTree('g1', trips, 'train')
    tree.source.files.set('data/train/stops.json', new TextEncoder().encode(JSON.stringify(STOPS)))
    const up = new FakeUpstream()
    up.set(
      'TripUpdates/Rail',
      feed(Math.floor(clock.t / 1000), [
        tripUpdate('e', { tripId: 'RT1', startDate: D, routeId: 'BRCL-5202' }, [
          { seq: 1, stopId: 'C2', depDelay: 60 },
        ]),
      ]),
    )
    up.set('VehiclePositions/Rail', feed(Math.floor(clock.t / 1000), []))
    up.set('alerts', feed(Math.floor(clock.t / 1000), []))
    const hub = new HubCore({
      storage: new FakeStorage(),
      fetch: up.fetch,
      now: clock.now,
      store: storeFor(tree, clock.now),
      config: parseRtModes('train'),
      upstream: 'https://up.test/api/realtime/SEQ',
    })
    for (let i = 0; i < 2; i++) await hub.alarm()
    const app = createApp({
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
    const dep = DeparturesResponse.parse(await (await app.request('/v1/train/stops/C1/departures')).json())
    expect(dep.departures[0]?.stopsAfter).toEqual(['R5'])
    const trip = (await (await app.request(`/v1/train/trips/RT1@${D}`)).json()) as Record<string, unknown>
    TripResponse.parse(trip)
    expect((trip.stops as unknown[])[0]).toMatchObject({
      stopId: 'C1',
      platform: '2',
      scheduledPlatform: '1',
      stationKey: 'central',
    })
  })
})
