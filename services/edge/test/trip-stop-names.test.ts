import { TripResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { silentLogger } from '../src/log.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { HubCore } from '../src/rt/hub-core.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import { altStopId, buildStations, stopNameFor } from '../src/stations.ts'
import { buildTree, Clock, D, epoch, FakeStorage, FakeUpstream, feed, storeFor } from './fixtures.ts'

const entry = (key: string, name: string) => ({ key, name, lat: -27.47, lon: 153.03, routes: ['232'] })

/** A bus stop index: plain numeric ids, a real id with leading zeros, a lettered id and a station with platforms. */
const BUS_STOPS = {
  schemaVersion: 1 as const,
  mode: 'bus' as const,
  generation: 'g1',
  stops: [
    entry('142', 'Edward Street Stop 142 near Queen St'),
    entry('64', 'Adelaide Street Stop 64 near Albert St'),
    entry('010813', 'Old-style stop with real zeros'),
    entry('place_cannon', 'Cannon Hill interchange'),
    { ...entry('busway-x', 'Cultural Centre station'), platforms: [{ id: '1850', code: '1' }] },
  ],
}

describe('altStopId', () => {
  it('pads and unpads numeric stop numbers, both ways', () => {
    expect(altStopId('000142')).toBe('142')
    expect(altStopId('142')).toBe('000142')
    expect(altStopId('010813')).toBe('10813')
    expect(altStopId('10813')).toBe('010813')
  })
  it('leaves letters, six-digit ids and zero alone', () => {
    expect(altStopId('place_cannon')).toBeNull()
    expect(altStopId('C1')).toBeNull()
    expect(altStopId('123456')).toBeNull()
    expect(altStopId('')).toBeNull()
    expect(altStopId('0')).toBeNull()
  })
})

describe('stopNameFor', () => {
  const st = buildStations(BUS_STOPS)
  it('an exact key wins, so real ids with leading zeros or letters keep their own name', () => {
    expect(stopNameFor(st, '142')).toBe('Edward Street Stop 142 near Queen St')
    expect(stopNameFor(st, '010813')).toBe('Old-style stop with real zeros')
    expect(stopNameFor(st, 'place_cannon')).toBe('Cannon Hill interchange')
  })
  it('a padded id finds the unpadded key and the reverse', () => {
    expect(stopNameFor(st, '000142')).toBe('Edward Street Stop 142 near Queen St')
    expect(stopNameFor(st, '000064')).toBe('Adelaide Street Stop 64 near Albert St')
    expect(stopNameFor(st, '10813')).toBe('Old-style stop with real zeros')
  })
  it('a platform id takes its station name', () => {
    expect(stopNameFor(st, '1850')).toBe('Cultural Centre station')
  })
  it('unknown stops and a missing index stay unnamed', () => {
    expect(stopNameFor(st, '99999')).toBeUndefined()
    expect(stopNameFor(st, 'nope')).toBeUndefined()
    expect(stopNameFor(null, '142')).toBeUndefined()
  })
})

/** Each test uses its own generation: the stop index is cached per isolate by mode and generation. */
async function busApp(stopIndex: unknown, generation: string, failIndex = false) {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const trips = {
    [D]: [
      {
        id: 'B232',
        route: '232-5146',
        headsign: 'Cannon Hill interchange',
        stops: [
          ['142', '08:00:00'],
          ['000064', '08:03:00'],
          ['1850', '08:10:00'],
          ['77777', '08:20:00'],
          ['place_cannon', '08:30:00'],
        ] as Array<[string, string]>,
      },
    ],
  }
  const tree = buildTree(generation, trips, 'bus')
  if (stopIndex)
    tree.source.files.set('data/bus/stops.json', new TextEncoder().encode(JSON.stringify(stopIndex)))
  else tree.source.files.delete('data/bus/stops.json')
  if (failIndex) {
    const get = tree.source.get.bind(tree.source)
    tree.source.get = (key) =>
      key === 'data/bus/stops.json' ? Promise.reject(new Error('R2 down')) : get(key)
  }
  const up = new FakeUpstream()
  const nowS = Math.floor(clock.t / 1000)
  up.set('TripUpdates/Bus', feed(nowS, []))
  up.set('VehiclePositions/Bus', feed(nowS, []))
  up.set('alerts', feed(nowS, []))
  const hub = new HubCore({
    storage: new FakeStorage(),
    fetch: up.fetch,
    now: clock.now,
    store: storeFor(tree, clock.now),
    config: parseRtModes('bus'),
    upstream: 'https://up.test/api/realtime/SEQ',
  })
  for (let i = 0; i < 2; i++) await hub.cycle()
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
    polledModes: ['bus'],
  })
}

describe('/v1/bus/trips', () => {
  it('names every stop the index knows, padded or not, and leaves unknown ones unnamed', async () => {
    const app = await busApp(BUS_STOPS, 'g-named')
    const res = await app.request(`/v1/bus/trips/B232@${D}`)
    expect(res.status).toBe(200)
    const body = TripResponse.parse(await res.json())
    expect(body.stops.map((s) => [s.stopId, s.name])).toEqual([
      ['142', 'Edward Street Stop 142 near Queen St'],
      ['000064', 'Adelaide Street Stop 64 near Albert St'],
      ['1850', 'Cultural Centre station'],
      ['77777', undefined],
      ['place_cannon', 'Cannon Hill interchange'],
    ])
  })

  it('a failing stop-index read never fails the trip: ids only', async () => {
    const app = await busApp(BUS_STOPS, 'g-index-error', true)
    const res = await app.request(`/v1/bus/trips/B232@${D}`)
    expect(res.status).toBe(200)
    const body = TripResponse.parse(await res.json())
    expect(body.stops).toHaveLength(5)
    expect(body.stops.every((s) => s.name === undefined)).toBe(true)
  })

  it('without a stop index the trip still answers, with ids only', async () => {
    const app = await busApp(null, 'g-no-index')
    const res = await app.request(`/v1/bus/trips/B232@${D}`)
    expect(res.status).toBe(200)
    const body = TripResponse.parse(await res.json())
    expect(body.stops).toHaveLength(5)
    expect(body.stops.every((s) => s.name === undefined)).toBe(true)
  })
})
