import {
  AlertsResponse,
  DeparturesResponse,
  ErrorResponse,
  GeoTileFile,
  HealthResponse,
  TripResponse,
  VehiclesResponse,
} from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error The legacy Vercel helper is plain JS without types; imported to prove parity.
import { applyCors } from '../../../api/_cors.js'
import { createApp, legacyFeedKeys, snapBbox } from '../src/app.ts'
import { corsHeaders } from '../src/cors.ts'
import { FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { silentLogger } from '../src/log.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { HubCore } from '../src/rt/hub-core.ts'
import type { SnapshotScope } from '../src/rt/split.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import {
  alert,
  buildTree,
  Clock,
  D,
  epoch,
  FakeStorage,
  FakeUpstream,
  feed,
  storeFor,
  tripUpdate,
  vehicle,
} from './fixtures.ts'

async function setup(opts: { modes?: string; warm?: boolean; scoped?: boolean; build?: string } = {}) {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const tree = buildTree()
  const up = new FakeUpstream()
  const nowS = () => Math.floor(clock.t / 1000)
  const cfg = parseRtModes(opts.modes ?? 'ferry')
  const hub = new HubCore({
    storage: new FakeStorage(),
    fetch: up.fetch,
    now: clock.now,
    store: storeFor(tree, clock.now),
    config: cfg,
    upstream: 'https://up.test/api/realtime/SEQ',
    fetchTimeoutMs: 50,
  })
  const tu = cfg.combined ? 'TripUpdates' : 'TripUpdates/Ferry'
  const vp = cfg.combined ? 'VehiclePositions' : 'VehiclePositions/Ferry'
  up.set(
    tu,
    feed(nowS(), [
      tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [{ seq: 1, depDelay: 180 }], 'V1'),
      tripUpdate('e2', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, []),
    ]),
  )
  up.set(vp, feed(nowS(), [vehicle('V1', 'T1', D, -27.45, 153.05), vehicle('V9', 'T3', D, -27.6, 153.3)]))
  up.set(
    'alerts',
    feed(nowS(), [
      alert('a1', 'Bulimba works', 'F1-4055'),
      alert('a2', 'Network notice'),
      alert('a3', 'Bus detour', '66-4055'),
    ]),
  )
  if (opts.warm !== false) {
    for (let i = 0; i < 3; i++) {
      await hub.cycle()
      clock.advance(1000)
    }
  }
  const pulls = { n: 0, raw: 0 }
  const snapshots = new SnapshotClient(
    {
      pull: (s) => {
        pulls.n++
        return hub.pull(s)
      },
      getRaw: (k) => {
        pulls.raw++
        return hub.getRaw(k)
      },
    },
    clock.now,
    () => {},
    null,
  )
  const scoped = new Map<string, SnapshotClient>()
  const snapshotsFor = (scope: SnapshotScope) => {
    let cl = scoped.get(scope)
    if (!cl) {
      cl = new SnapshotClient(
        {
          pull: (since, sc) => {
            pulls.n++
            return hub.pull(since, sc)
          },
          getRaw: (k) => hub.getRaw(k),
        },
        clock.now,
        () => {},
        null,
        scope,
      )
      scoped.set(scope, cl)
    }
    return cl
  }
  const app = createApp({
    store: storeFor(tree, clock.now),
    snapshots,
    ...(opts.scoped ? { snapshotsFor } : {}),
    now: clock.now,
    log: silentLogger,
    combinedFeeds: cfg.combined,
    polledModes: cfg.modes,
    ...(opts.build !== undefined ? { build: opts.build } : {}),
  })
  const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers })
  return { clock, tree, up, hub, app, get, pulls, nowS }
}

describe('GET /v1/{mode}/stops/{key}/departures', () => {
  it('merges static and RT into contract-valid departures', async () => {
    const s = await setup()
    const res = await s.get('/v1/ferry/stops/317584/departures?to=317590')
    expect(res.status).toBe(200)
    const body = DeparturesResponse.parse(await res.json())
    expect(body.rtState).toBe('live')
    expect(body.staticGeneration).toBe('g1')
    expect(body.to).toEqual({ key: '317590', name: '317590 ferry terminal' })
    const [t1, t2] = body.departures
    expect(t1).toMatchObject({ tripInstance: `T1@${D}`, status: 'live', gps: true, vehicleId: 'V1' })
    expect((t1?.estDep as number) - (t1?.schedDep as number)).toBe(180)
    expect(t1?.schedArrTo).toBe(epoch(D, '08:15:00'))
    expect(t2).toMatchObject({ tripInstance: `T2@${D}`, status: 'cancelled' })
    // T3 runs the other way (Riverside → Bulimba) and must not appear.
    expect(body.departures.map((d) => d.tripInstance)).not.toContain(`T3@${D}`)
  })

  it('caps max-age by snapshot age', async () => {
    const s = await setup()
    // The last cycle ran 1 s ago; snapshot fetchedAt is that cycle's start.
    const res = await s.get('/v1/ferry/stops/317584/departures')
    expect(res.headers.get('cache-control')).toMatch(/^public, max-age=([0-9]|10)$/)
    s.clock.advance(20_000)
    const later = await s.get('/v1/ferry/stops/317584/departures')
    expect(later.headers.get('cache-control')).toBe('public, max-age=0')
  })

  it('serves scheduled-only rows marked reloading when the generations differ', async () => {
    const s = await setup()
    s.tree.publish('g2')
    const body = DeparturesResponse.parse(await (await s.get('/v1/ferry/stops/317584/departures')).json())
    expect(body.staticGeneration).toBe('g2')
    expect(body.rtState).toBe('reloading')
    expect(body.departures.every((d) => d.status === 'scheduled' && d.estDep == null)).toBe(true)
  })

  it('is unavailable for a mode the hub does not index', async () => {
    const s = await setup()
    const body = VehiclesResponse.parse(await (await s.get('/v1/bus/vehicles')).json())
    expect(body.rtState).toBe('unavailable')
  })

  it('is unavailable (scheduled rows) before the hub has published anything', async () => {
    const s = await setup({ warm: false })
    const body = DeparturesResponse.parse(await (await s.get('/v1/ferry/stops/317584/departures')).json())
    expect(body.rtState).toBe('unavailable')
    expect(body.rtSourceTimestamp).toBeNull()
    expect(body.departures.length).toBeGreaterThan(0)
  })

  it('stale RT falls back to scheduled, but a cancellation shows unknown', async () => {
    const s = await setup()
    s.clock.advance(6 * 60_000)
    const body = DeparturesResponse.parse(await (await s.get('/v1/ferry/stops/317584/departures')).json())
    expect(body.rtState).toBe('stale')
    const byTrip = Object.fromEntries(body.departures.map((d) => [d.tripInstance.split('@')[0], d.status]))
    expect(byTrip).toMatchObject({ T2: 'unknown' })
  })

  it('reads yesterday’s service day for a 00:30 query', async () => {
    const s = await setup()
    s.clock.t = epoch('20261019', '24:30:00') * 1000
    const body = DeparturesResponse.parse(await (await s.get('/v1/ferry/stops/317584/departures')).json())
    expect(body.serviceDates).toEqual(['20261019', D])
    expect(body.departures[0]?.tripInstance).toBe('LATE@20261019')
  })

  it('at= lists departures from that time; max-age=60 only for scheduled-only rows', async () => {
    const s = await setup()
    const res = await s.get(`/v1/ferry/stops/317584/departures?at=${epoch(D, '08:05:00')}`)
    // T2 is cancelled in the snapshot, so RT contributes: the snapshot-age cap applies.
    expect(res.headers.get('cache-control')).toMatch(/^public, max-age=([0-9]|10)$/)
    const body = DeparturesResponse.parse(await res.json())
    expect(body.departures.map((d) => d.tripInstance)).toEqual([`T2@${D}`, `T3@${D}`])
    // A scheduled-status row with a GPS vehicle (T3 has V9) is still RT: capped.
    const gps = await s.get(`/v1/ferry/stops/317584/departures?at=${epoch(D, '08:25:00')}`)
    expect(gps.headers.get('cache-control')).toMatch(/^public, max-age=([0-9]|10)$/)
    // Far in the future with no RT at all: a minute.
    const far = await s.get(`/v1/ferry/stops/317584/departures?at=${epoch(D, '20:00:00')}`)
    expect(far.headers.get('cache-control')).toBe('public, max-age=60')
    // A query at yesterday's late evening reads yesterday's service day too.
    const late = DeparturesResponse.parse(
      await (await s.get(`/v1/ferry/stops/317584/departures?at=${epoch('20261019', '24:30:00')}`)).json(),
    )
    expect(late.departures[0]?.tripInstance).toBe('LATE@20261019')
    expect((await s.get('/v1/ferry/stops/317584/departures?at=soon')).status).toBe(400)
    // at ≈ now carries live predictions: still capped by snapshot age.
    const near = await s.get(`/v1/ferry/stops/317584/departures?at=${s.nowS() + 30}`)
    expect(near.headers.get('cache-control')).toMatch(/^public, max-age=([0-9]|10)$/)
  })

  it('late in the evening carries on into the next service day', async () => {
    const s = await setup()
    // 23:00 on D0: the 24:40 LATE trip, then D's morning services.
    const body = DeparturesResponse.parse(
      await (await s.get(`/v1/ferry/stops/317584/departures?at=${epoch('20261019', '23:00:00')}`)).json(),
    )
    expect(body.serviceDates).toEqual(['20261019', D])
    expect(body.departures.map((d) => d.tripInstance)).toEqual([
      `LATE@20261019`,
      `T1@${D}`,
      `T2@${D}`,
      `T3@${D}`,
    ])
  })

  it('404 with ErrorResponse for a key not in the stop index; 200 empty for a known stop with no service', async () => {
    const s = await setup()
    const r = await s.get('/v1/ferry/stops/nope/departures')
    expect(r.status).toBe(404)
    expect(ErrorResponse.parse(await r.json())).toEqual({ error: 'unknown stop', detail: 'nope' })
    const quiet = await s.get('/v1/ferry/stops/QUIET/departures')
    expect(quiet.status).toBe(200)
    const body = DeparturesResponse.parse(await quiet.json())
    expect(body.departures).toEqual([])
    expect(body.stop.name).toBe('QUIET ferry terminal')
    expect(body.stop.boardAt).toBeUndefined()
    // A set-down-only stop: no rows, and where to board instead from the stop index.
    const dropOff = DeparturesResponse.parse(await (await s.get('/v1/ferry/stops/DROPOFF/departures')).json())
    expect(dropOff.departures).toEqual([])
    expect(dropOff.stop.boardAt).toEqual([{ key: 'QUIET', name: 'QUIET ferry terminal' }])
  })

  it('404s an unknown stop, 400s an unknown mode, clamps limit', async () => {
    const s = await setup()
    const r404 = await s.get('/v1/ferry/stops/nope/departures')
    expect(r404.status).toBe(404)
    ErrorResponse.parse(await r404.json())
    expect((await s.get('/v1/boat/stops/317584/departures')).status).toBe(400)
    const body = DeparturesResponse.parse(
      await (await s.get('/v1/ferry/stops/317584/departures?limit=1')).json(),
    )
    expect(body.departures).toHaveLength(1)
  })

  it('never calls the hub per request: one pull per 10 s per isolate', async () => {
    const s = await setup()
    await Promise.all(Array.from({ length: 25 }, () => s.get('/v1/ferry/stops/317584/departures')))
    expect(s.pulls.n).toBe(1)
    s.clock.advance(5_000)
    await s.get('/v1/ferry/stops/317584/departures')
    expect(s.pulls.n).toBe(1)
    s.clock.advance(6_000)
    await Promise.all(Array.from({ length: 10 }, () => s.get('/v1/ferry/stops/317590/departures')))
    expect(s.pulls.n).toBe(2)
  })

  it('a stalled hub does not turn into per-request DO calls', async () => {
    const s = await setup()
    await s.get('/v1/ferry/stops/317584/departures')
    s.clock.advance(10 * 60_000) // snapshot is now very old
    for (let i = 0; i < 5; i++) await s.get('/v1/ferry/stops/317584/departures')
    expect(s.pulls.n).toBe(2)
  })
})

describe('other /v1 routes', () => {
  it('trip detail with live predictions and the vehicle', async () => {
    const s = await setup()
    const res = await s.get(`/v1/ferry/trips/T1@${D}`)
    const body = TripResponse.parse(await res.json())
    expect(body.status).toBe('live')
    expect(body.vehicle?.id).toBe('V1')
    expect(body.stops.map((x) => x.stopId)).toEqual(['317584', '317586', '317590'])
    expect(body.stops[2]?.estArr).toBe(epoch(D, '08:15:00') + 180)
    expect((await s.get(`/v1/ferry/trips/NOPE@${D}`)).status).toBe(404)
  })

  it('an added trip never departs a stop before it arrives (estDep clamped to estArr)', async () => {
    const s = await setup()
    // TransLink can send a departure prediction earlier than the arrival at the same stop (big early predictions).
    s.up.set(
      'TripUpdates/Ferry',
      feed(s.nowS(), [
        tripUpdate('x', { tripId: 'X1', startDate: D, routeId: 'F1-4055', scheduleRelationship: 1 }, [
          { seq: 1, stopId: '317584', arrTime: epoch(D, '09:00:40'), depTime: epoch(D, '09:00:10') },
          { seq: 2, stopId: '317586', arrTime: epoch(D, '09:06:40'), depTime: epoch(D, '09:06:10') },
          { seq: 3, stopId: '317590', arrTime: epoch(D, '09:12:00') },
        ]),
      ]),
    )
    for (let i = 0; i < 3; i++) {
      await s.hub.cycle()
      s.clock.advance(1000)
    }
    const res = await s.get(`/v1/ferry/trips/${encodeURIComponent(`rt:X1@${D}`)}`)
    expect(res.status).toBe(200)
    const body = TripResponse.parse(await res.json())
    // At the origin the arrival is the inbound vehicle's, so the stated departure stands (smoke round 9); at an
    // intermediate stop the departure is clamped to the arrival.
    expect(body.stops[0]).toMatchObject({ estArr: epoch(D, '09:00:10'), estDep: epoch(D, '09:00:10') })
    expect(body.stops[1]).toMatchObject({ estArr: epoch(D, '09:06:40'), estDep: epoch(D, '09:06:40') })
    for (const stop of body.stops) expect(stop.estDep ?? 0).toBeGreaterThanOrEqual(stop.estArr ?? 0)
  })

  it('vehicles filtered by mode, route and a snapped bbox', async () => {
    const s = await setup()
    const all = VehiclesResponse.parse(await (await s.get('/v1/ferry/vehicles')).json())
    expect(all.vehicles.map((v) => v.id).sort()).toEqual(['V1', 'V9'])
    const route = VehiclesResponse.parse(await (await s.get('/v1/ferry/vehicles?route=F1')).json())
    expect(route.vehicles.map((v) => v.id).sort()).toEqual(['V1', 'V9'])
    const express = VehiclesResponse.parse(await (await s.get('/v1/ferry/vehicles?route=F11')).json())
    expect(express.vehicles).toEqual([])
    const redirect = await s.get('/v1/ferry/vehicles?bbox=153.01,-27.47,153.07,-27.43')
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe('/v1/ferry/vehicles?bbox=153.00%2C-27.50%2C153.10%2C-27.40')
    const boxed = VehiclesResponse.parse(
      await (await s.get('/v1/ferry/vehicles?bbox=153.00,-27.50,153.10,-27.40')).json(),
    )
    expect(boxed.vehicles.map((v) => v.id)).toEqual(['V1'])
    expect(VehiclesResponse.parse(await (await s.get('/v1/train/vehicles')).json()).vehicles).toEqual([])
  })

  it('snapBbox rounds outward to the grid', () => {
    expect(snapBbox([153.01, -27.47, 153.07, -27.43])).toEqual([153, -27.5, 153.1, -27.4])
    expect(snapBbox([153, -27.5, 153.1, -27.4])).toEqual([153, -27.5, 153.1, -27.4])
  })

  it('alerts filtered by mode, route and stop', async () => {
    const s = await setup()
    const all = AlertsResponse.parse(await (await s.get('/v1/alerts?mode=ferry')).json())
    expect(all.alerts.map((a) => a.id)).toEqual(['a1', 'a2'])
    // The bus alert (route of a mode we don't load) never leaks into a ferry query as if it were network-wide.
    const all3 = AlertsResponse.parse(await (await s.get('/v1/alerts')).json())
    expect(all3.alerts.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    const route = AlertsResponse.parse(await (await s.get('/v1/alerts?route=F1')).json())
    expect(route.alerts.map((a) => a.id)).toEqual(['a1'])
    expect((await s.get('/v1/alerts?mode=train')).headers.get('cache-control')).toBe('public, max-age=60')
  })

  it('health reports manifest, RT age and match stats', async () => {
    const s = await setup()
    const res = await s.get('/v1/health')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = HealthResponse.parse(await res.json())
    expect(body.ok).toBe(true)
    expect(body.manifest.generations).toEqual({ ferry: 'g1' })
    expect(body.rt.stats?.ferry?.matched).toBe(2)
    s.clock.advance(5 * 60_000)
    expect((await s.get('/v1/health')).status).toBe(503)
  })

  it('health fails when TripUpdates go stale even though the hub keeps rebuilding', async () => {
    const s = await setup()
    // TransLink's header time stops advancing; the hub still rebuilds from retained data every cycle.
    s.clock.advance(5 * 60_000)
    s.up.fail.add('TripUpdates/Ferry')
    s.up.set('VehiclePositions/Ferry', feed(s.nowS(), []))
    await s.hub.cycle()
    s.clock.advance(11_000)
    const body = HealthResponse.parse(await (await s.get('/v1/health')).json())
    expect(body.ok).toBe(false)
    expect(body.rt.ageS).toBeGreaterThan(120)
  })

  it('/data passthrough and the legacy latest.json', async () => {
    const s = await setup()
    const d = await s.get('/data/ferry/stops.json')
    expect(d.status).toBe(200)
    expect(await d.json()).toMatchObject({ mode: 'ferry' })
    expect((await s.get('/data/ferry/nope.json')).status).toBe(404)
    // A tile with no stops isn't published: a well-formed tile path is an empty tile, not a 404 (X2).
    const empty = await s.get('/data/ferry/geo/r7hu1.json')
    expect(empty.status).toBe(200)
    expect(GeoTileFile.parse(await empty.json())).toMatchObject({
      mode: 'ferry',
      geohash: 'r7hu1',
      stops: [],
    })
    expect(empty.headers.get('cache-control')).toBe('public, max-age=300')
    // R3-X8: a mode without a generation in the manifest (here train) still answers an empty tile, briefly cached.
    const noGen = await s.get('/data/train/geo/r7hu1.json')
    expect(noGen.status).toBe(200)
    expect(GeoTileFile.parse(await noGen.json())).toMatchObject({ mode: 'train', generation: '', stops: [] })
    expect(noGen.headers.get('cache-control')).toBe('public, max-age=30')
    expect((await s.get('/data/ferry/geo/r7hu.json')).status).toBe(404)
    expect((await s.get('/data/ferry/geo/aaaaa.json')).status).toBe(404)
    const l = await s.get('/schedule-data/latest.json')
    expect(l.status).toBe(200)
    expect(await l.json()).toMatchObject({ generated: '2026-10-19T17:20:00Z' })
  })

  it('every response carries a request id', async () => {
    const s = await setup()
    expect((await s.get('/v1/health', { 'cf-ray': 'abc-SYD' })).headers.get('x-request-id')).toBe('abc-SYD')
    expect((await s.get('/nope')).headers.get('x-request-id')).toMatch(/[0-9a-f-]{36}/)
  })

  it('every response carries the build marker, and health reports it', async () => {
    const s = await setup({ build: '1a2b3c4' })
    s.app.get('/boom', () => {
      throw new Error('boom')
    })
    const health = await s.get('/v1/health')
    expect(health.headers.get('x-bft-build')).toBe('1a2b3c4')
    expect(HealthResponse.parse(await health.json()).build).toBe('1a2b3c4')
    const answers = [
      await s.get('/v1/ferry/stops/317584/departures'),
      await s.get('/v1/nope/vehicles'),
      await s.get('/nope'),
      await s.get('/boom'),
      await s.app.request('/v1/health', { method: 'OPTIONS', headers: { origin: 'capacitor://localhost' } }),
    ]
    expect(answers.map((r) => r.status)).toEqual([200, 400, 404, 500, 200])
    for (const r of answers) expect(r.headers.get('x-bft-build'), r.url).toBe('1a2b3c4')
    // Stale RT: health still names the build on its 503.
    s.clock.advance(5 * 60_000)
    const stale = await s.get('/v1/health')
    expect(stale.status).toBe(503)
    expect(stale.headers.get('x-bft-build')).toBe('1a2b3c4')
  })

  it('the marker is "dev" without a build, and never echoes a value that is not a sha', async () => {
    const dev = await setup()
    const res = await dev.get('/v1/health')
    expect(res.headers.get('x-bft-build')).toBe('dev')
    expect(HealthResponse.parse(await res.json()).build).toBe('dev')
    for (const junk of ['main', 'refs/heads/develop', '/home/runner/work', 'abc', '1a2b3c4\nx'])
      expect((await (await setup({ build: junk })).get('/nope')).headers.get('x-bft-build'), junk).toBe('dev')
    expect((await (await setup({ build: '1a2b3c4-dirty' })).get('/nope')).headers.get('x-bft-build')).toBe(
      '1a2b3c4-dirty',
    )
  })
})

describe('legacy /api/gtfs-proxy', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => fetchSpy.mockRestore())

  it('serves the hub’s stored raw protobuf and never fetches upstream itself', async () => {
    const s = await setup()
    const before = s.up.calls.length
    const res = await s.get('/api/gtfs-proxy?endpoint=TripUpdates/Ferry')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('cache-control')).toBe('public, max-age=10')
    const msg = fromBinary(FeedMessageSchema, new Uint8Array(await res.arrayBuffer()))
    expect(msg.entity.map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(s.up.calls.length).toBe(before)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('combined endpoint with per-mode polling serves the per-mode feeds concatenated', async () => {
    const s = await setup()
    const res = await s.get('/api/gtfs-proxy?endpoint=TripUpdates')
    const msg = fromBinary(FeedMessageSchema, new Uint8Array(await res.arrayBuffer()))
    expect(msg.entity).toHaveLength(2)
    expect(msg.header?.gtfsRealtimeVersion).toBe('2.0')
  })

  it('accepts the legacy app’s endpoint names (Alerts) and shares raw reads for 10 s', async () => {
    const s = await setup()
    for (let i = 0; i < 5; i++) expect((await s.get('/api/gtfs-proxy?endpoint=Alerts')).status).toBe(200)
    expect(s.pulls.raw).toBe(1)
  })

  it('503 when the hub has nothing, 400 for missing or unknown endpoints', async () => {
    const s = await setup({ warm: false })
    const r = await s.get('/api/gtfs-proxy?endpoint=VehiclePositions')
    expect(r.status).toBe(503)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect((await s.get('/api/gtfs-proxy')).status).toBe(400)
    expect(await (await s.get('/api/gtfs-proxy')).json()).toEqual({ error: 'Endpoint parameter is required' })
    expect((await s.get('/api/gtfs-proxy?endpoint=../../etc')).status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('maps endpoints onto stored feed keys', () => {
    expect(legacyFeedKeys('TripUpdates', false, ['ferry', 'train'])).toEqual([
      'TripUpdates/Ferry',
      'TripUpdates/Rail',
    ])
    expect(legacyFeedKeys('TripUpdates', true, ['ferry'])).toEqual(['TripUpdates'])
    expect(legacyFeedKeys('VehiclePositions/Bus', true, [])).toEqual(['VehiclePositions'])
    expect(legacyFeedKeys('VehiclePositions/Bus', false, ['ferry'])).toEqual([])
    expect(legacyFeedKeys('alerts/Bus', false, ['ferry'])).toBeNull()
    expect(legacyFeedKeys('Foo', false, ['ferry'])).toBeNull()
  })
})

describe('CORS parity with api/_cors.js', () => {
  const ORIGINS = [
    undefined,
    'https://www.brisbaneferry.com',
    'https://brisbaneferry.com',
    'https://ferry.lifemap.au',
    'capacitor://localhost',
    'ionic://localhost',
    'http://localhost',
    'http://localhost:5173',
    'https://brisbane-ferry-tracker-abc123-starblaze.vercel.app',
    'https://brisbane-ferry-tracker-git-feat-x-starblaze.vercel.app',
    'https://brisbane-ferry-tracker.evil.com',
    'https://evil.example',
    'null',
  ]

  function legacy(origin: string | undefined, allowAll: boolean): Record<string, string> {
    const prev = process.env.CORS_ALLOW_ALL
    process.env.CORS_ALLOW_ALL = allowAll ? 'true' : 'false'
    const headers: Record<string, string> = {}
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    applyCors(
      { headers: origin ? { origin } : {}, url: '/api/gtfs-proxy' },
      { setHeader: (k: string, v: string) => (headers[k] = v) },
    )
    warn.mockRestore()
    process.env.CORS_ALLOW_ALL = prev
    return headers
  }

  for (const allowAll of [false, true]) {
    for (const origin of ORIGINS) {
      it(`${allowAll ? 'allow-all' : 'allowlist'} ${origin ?? '(no origin)'}`, () => {
        expect(corsHeaders(origin, allowAll)).toEqual(legacy(origin, allowAll))
      })
    }
  }

  it('the app applies them, and answers OPTIONS with 200', async () => {
    const s = await setup()
    const res = await s.app.request('/api/gtfs-proxy?endpoint=TripUpdates', {
      method: 'OPTIONS',
      headers: { origin: 'capacitor://localhost' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('capacitor://localhost')
    const blocked = await s.get('/v1/health', { origin: 'https://evil.example' })
    expect(blocked.headers.get('access-control-allow-origin')).toBeNull()
    expect(blocked.headers.get('access-control-allow-credentials')).toBe('true')
  })
})

describe('per-scope snapshot clients (split)', () => {
  it('departures, vehicles, alerts and health behave the same with per-mode documents', async () => {
    const s = await setup({ scoped: true })
    const dep = DeparturesResponse.parse(
      await (await s.get('/v1/ferry/stops/317584/departures?to=317590')).json(),
    )
    expect(dep.rtState).toBe('live')
    expect(dep.departures[0]).toMatchObject({ tripInstance: `T1@${D}`, status: 'live', gps: true })
    expect(dep.departures[1]).toMatchObject({ status: 'cancelled' })
    const veh = VehiclesResponse.parse(await (await s.get('/v1/ferry/vehicles')).json())
    expect(veh.vehicles.map((v) => v.id).sort()).toEqual(['V1', 'V9'])
    const al = AlertsResponse.parse(await (await s.get('/v1/alerts')).json())
    expect(al.alerts.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    const health = HealthResponse.parse(await (await s.get('/v1/health')).json())
    expect(health.ok).toBe(true)
    expect(health.rt.stats?.ferry?.matched).toBe(2)
    // An unpolled mode has no document: unavailable, scheduled rows.
    const bus = VehiclesResponse.parse(await (await s.get('/v1/train/vehicles')).json())
    expect(bus.vehicles).toEqual([])
  })
})

describe('departures parallel loading (Codex review of bcd94a7)', () => {
  it('an unknown stop is 404 even when its speculative stop-day read fails', async () => {
    const s = await setup()
    const real = s.tree.source.get.bind(s.tree.source)
    s.tree.source.get = async (key: string) => {
      if (key.startsWith('static/blobs/')) throw new Error('r2 down')
      return real(key)
    }
    const res = await s.get('/v1/ferry/stops/nope/departures')
    expect(res.status).toBe(404)
  })

  it('the merge cutoff uses the clock after the snapshot loaded', async () => {
    const s = await setup()
    // T3 leaves 317590 at 08:30 with no RT. The request starts at 08:30:29 and the (cold) snapshot pull takes 2 s,
    // so at merge time T3 is 31 s past: outside the 30 s grace, it must not be listed.
    s.clock.t = epoch(D, '08:30:29') * 1000
    const real = s.hub.pull.bind(s.hub)
    s.hub.pull = async (...args: Parameters<typeof real>) => {
      s.clock.advance(2000)
      return real(...args)
    }
    const body = DeparturesResponse.parse(await (await s.get('/v1/ferry/stops/317590/departures')).json())
    expect(body.departures.map((d) => d.tripInstance)).not.toContain(`T3@${D}`)
  })
})
