import { RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { parseRtModes } from '../src/rt/feeds.ts'
import { ALERTS_EVERY_MS, CYCLE_MS, HubCore, WATCHDOG_STALE_MS } from '../src/rt/hub-core.ts'
import {
  alert,
  buildTree,
  Clock,
  D,
  D0,
  epoch,
  FakeStorage,
  FakeUpstream,
  feed,
  storeFor,
  tripUpdate,
  vehicle,
} from './fixtures.ts'

const TU = 'TripUpdates/Ferry'
const VP = 'VehiclePositions/Ferry'

function setup(opts: { modes?: string } = {}) {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const tree = buildTree()
  const up = new FakeUpstream()
  const storage = new FakeStorage()
  const mk = () =>
    new HubCore({
      storage,
      fetch: up.fetch,
      now: clock.now,
      store: storeFor(tree, clock.now),
      config: parseRtModes(opts.modes ?? 'ferry'),
      upstream: 'https://up.test/api/realtime/SEQ',
      fetchTimeoutMs: 50,
    })
  const nowS = () => Math.floor(clock.t / 1000)
  up.set(
    TU,
    feed(nowS(), [
      tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [
        { seq: 1, stopId: '317584', depTime: epoch(D, '08:02:00') },
      ]),
    ]),
  )
  up.set(VP, feed(nowS(), [vehicle('V1', 'T1', D, -27.45, 153.05)]))
  up.set('alerts', feed(nowS(), [alert('a1', 'Bulimba works', 'F1-4055')]))
  return { clock, tree, up, storage, hub: mk(), mk, nowS }
}

/** Run alarm cycles until the trip indexes for both days are loaded (one day per cycle). */
async function warm(h: ReturnType<typeof setup>) {
  for (let i = 0; i < 3; i++) {
    await h.hub.alarm()
    h.clock.advance(CYCLE_MS)
  }
}

describe('RtHub alarm robustness', () => {
  it('re-arms the next alarm before doing any work', async () => {
    const h = setup()
    await h.hub.alarm()
    expect(h.storage.events[0]).toBe('setAlarm')
    expect(h.storage.alarmAt).toBe(epoch(D, '07:55:00') * 1000 + CYCLE_MS)
  })

  it('keeps the chain alive when the cycle throws (store unreachable)', async () => {
    const h = setup()
    h.tree.source.files.delete('manifest.json')
    h.tree.source.get = async () => {
      throw new Error('data worker down')
    }
    await h.hub.alarm()
    expect(h.storage.alarmAt).not.toBeNull()
    expect(h.hub.status().lastError).toMatch(/data worker down/)
  })

  it('re-arms in finally if the alarm went missing during the cycle', async () => {
    const h = setup()
    const orig = h.up.fetch
    h.up.fetch = async (u, i) => {
      h.storage.deleteAlarm()
      return orig(u, i)
    }
    await h.hub.alarm()
    expect(h.storage.alarmAt).toBe(h.clock.t + CYCLE_MS)
  })

  it('times out a hanging upstream fetch and still publishes the other feeds', async () => {
    const h = setup()
    await warm(h)
    h.up.hang.add(VP)
    const t0 = Date.now()
    await h.hub.alarm()
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(h.hub.status().lastError).toMatch(/VehiclePositions\/Ferry: .*abort/i)
    expect(h.storage.alarmAt).not.toBeNull()
  })

  it('sends If-None-Match and skips the rebuild on 304', async () => {
    const h = setup()
    await warm(h)
    const seq = (await h.hub.pull(null)).seq
    await h.hub.alarm()
    const last = h.up.calls.filter((c) => c.path === TU).at(-1)
    expect(last?.ifNoneMatch).toBe(`"${TU}-1"`)
    expect((await h.hub.pull(null)).seq).toBe(seq)
  })

  it('polls alerts every 60 s, trip feeds every cycle', async () => {
    const h = setup()
    for (let i = 0; i < 8; i++) {
      await h.hub.alarm()
      h.clock.advance(CYCLE_MS)
    }
    const n = (p: string) => h.up.calls.filter((c) => c.path === p).length
    expect(n(TU)).toBe(8)
    expect(n('alerts')).toBe(Math.ceil((8 * CYCLE_MS) / ALERTS_EVERY_MS))
  })

  it('watchdog: a killed alarm chain is re-armed by ensureRunning and recovers', async () => {
    const h = setup()
    await warm(h)
    expect((await h.hub.ensureRunning()).rearmed).toBe(false)

    // Kill the chain: no alarm, and time passes with no cycle.
    h.storage.deleteAlarm()
    h.clock.advance(WATCHDOG_STALE_MS + 15_000)
    const before = h.hub.status().lastCycleAt as number

    const r = await h.hub.ensureRunning()
    expect(r.rearmed).toBe(true)
    expect(h.storage.alarmAt).toBe(h.clock.t)

    // The runtime fires the alarm; the chain continues on its own.
    await h.hub.alarm()
    expect(h.hub.status().lastCycleAt).toBeGreaterThan(before)
    expect(h.storage.alarmAt).toBe(h.clock.t + CYCLE_MS)
    expect((await h.hub.ensureRunning()).rearmed).toBe(false)
  })

  it('watchdog also re-arms a chain whose alarm is set but stuck (last cycle too old)', async () => {
    const h = setup()
    await warm(h)
    h.storage.alarmAt = h.clock.t + 3_600_000
    h.clock.advance(WATCHDOG_STALE_MS + 1)
    expect((await h.hub.ensureRunning()).rearmed).toBe(true)
    expect(h.storage.alarmAt).toBe(h.clock.t)
  })

  it('a fresh hub with no history is started by the first watchdog call', async () => {
    const h = setup()
    expect((await h.hub.ensureRunning()).rearmed).toBe(true)
  })
})

describe('RtHub snapshot', () => {
  it('publishes a contract-valid snapshot with matches, delays, vehicles and alerts', async () => {
    const h = setup()
    await warm(h)
    const { json, status } = await h.hub.pull(null)
    const snap = RtSnapshot.parse(JSON.parse(json as string))
    expect(snap.header.staticGeneration).toEqual({ ferry: 'g1' })
    expect(snap.header.serviceDates).toEqual([D0, D])
    const t1 = snap.trips[`T1@${D}`]
    expect(t1?.tier).toBe(1)
    // Absolute time normalised to a delay against the static schedule.
    expect(t1?.updates[0]).toMatchObject({ seq: 1, dep: epoch(D, '08:02:00'), depDelay: 120 })
    expect(snap.vehicles[0]).toMatchObject({ id: 'V1', mode: 'ferry', tripKey: `T1@${D}` })
    expect(snap.alerts[0]).toMatchObject({ id: 'a1', header: 'Bulimba works', modes: ['ferry'] })
    expect(status.stats?.ferry).toMatchObject({ total: 1, matched: 1, ambiguous: 0 })
  })

  it('keeps a cancellation until the trip’s scheduled end after the feed drops it', async () => {
    const h = setup()
    await warm(h)
    h.up.set(TU, feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]))
    await h.hub.alarm()
    // Feed drops the cancellation.
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.alarm()
    let snap = RtSnapshot.parse(JSON.parse((await h.hub.pull(null)).json as string))
    expect(snap.trips[`T2@${D}`]).toMatchObject({ rel: 'CANCELED', until: epoch(D, '08:20:00') })
    // After its scheduled end it expires.
    h.clock.t = epoch(D, '08:21:00') * 1000
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.alarm()
    snap = RtSnapshot.parse(JSON.parse((await h.hub.pull(null)).json as string))
    expect(snap.trips[`T2@${D}`]).toBeUndefined()
  })

  it('keeps ADDED trips whose stops resolve, counts and drops the rest', async () => {
    const h = setup()
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [
        tripUpdate('ok', { tripId: 'X1', startDate: D, routeId: 'F1-4055', scheduleRelationship: 1 }, [
          { seq: 1, stopId: '317584', depTime: epoch(D, '09:00:00') },
          { seq: 2, stopId: '317590', arrTime: epoch(D, '09:12:00') },
        ]),
        tripUpdate('bad', { tripId: 'X2', startDate: D, routeId: 'F1-4055', scheduleRelationship: 1 }, [
          { seq: 1, stopId: 'NOWHERE', depTime: epoch(D, '09:00:00') },
          { seq: 2, stopId: '317590', arrTime: epoch(D, '09:12:00') },
        ]),
      ]),
    )
    await h.hub.alarm()
    const { json, status } = await h.hub.pull(null)
    const snap = RtSnapshot.parse(JSON.parse(json as string))
    expect(snap.trips[`rt:X1@${D}`]?.added?.stops.map((s) => s.stopId)).toEqual(['317584', '317590'])
    expect(Object.keys(snap.trips).some((k) => k.includes('X2'))).toBe(false)
    expect(status.stats?.ferry?.addedDropped).toBe(1)
  })

  it('matches yesterday’s 24:40 trip at 00:45 (two service days loaded)', async () => {
    const h = setup()
    h.clock.t = epoch(D0, '24:30:00') * 1000
    h.up.set(
      TU,
      feed(h.nowS(), [
        tripUpdate('late', { tripId: 'LATE', startDate: D, startTime: '00:40:00', routeId: 'F1-4055' }, [
          { seq: 1, depDelay: 60 },
        ]),
      ]),
    )
    await warm(h)
    const snap = RtSnapshot.parse(JSON.parse((await h.hub.pull(null)).json as string))
    expect(snap.trips[`LATE@${D0}`]?.updates[0]?.depDelay).toBe(60)
  })

  it('reloads the trip index when the manifest generation changes, without mixing generations', async () => {
    const h = setup()
    await warm(h)
    h.tree.publish('g2')
    await h.hub.alarm() // starts loading g2 (first day)
    let snap = JSON.parse((await h.hub.pull(null)).json as string)
    expect(snap.header.staticGeneration.ferry).toBe('g1')
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.alarm() // second day, swap
    snap = JSON.parse((await h.hub.pull(null)).json as string)
    expect(snap.header.staticGeneration.ferry).toBe('g2')
  })

  it('pull only re-sends the snapshot when seq changed', async () => {
    const h = setup()
    await warm(h)
    const a = await h.hub.pull(null)
    expect(a.json).not.toBeNull()
    expect((await h.hub.pull(a.seq)).json).toBeNull()
  })

  it('after a restart serves the stored snapshot and raw feeds without fetching upstream', async () => {
    const h = setup()
    await warm(h)
    const before = await h.hub.pull(null)
    const calls = h.up.calls.length
    const fresh = h.mk()
    const after = await fresh.pull(null)
    expect(after.seq).toBe(before.seq)
    expect(after.json).toBe(before.json)
    const raw = await fresh.getRaw(TU)
    expect(raw && fromBinary(FeedMessageSchema, raw.bytes).entity).toHaveLength(1)
    expect(await fresh.getRaw('TripUpdates/Bus')).toBeNull()
    expect(h.up.calls.length).toBe(calls)
  })

  it('a corrupt feed body keeps the previous good bytes and does not stop the cycle', async () => {
    const h = setup()
    await warm(h)
    const good = await h.hub.getRaw(VP)
    h.up.set(VP, new Uint8Array(64).fill(0xff))
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.alarm()
    expect(h.hub.status().lastError).toMatch(/VehiclePositions\/Ferry: decode failed/)
    expect((await h.hub.getRaw(VP))?.bytes).toEqual(good?.bytes)
    expect((await h.hub.pull(null)).status.sourceTimestamp).toBe(h.nowS())
  })

  it('chunks large raw feeds and snapshots across storage values', async () => {
    const h = setup()
    const big = feed(h.nowS(), [{ ...vehicle('V1', 'T1', D, -27.45, 153.05), id: 'x'.repeat(2.5 * (1 << 20)) }])
    h.up.set(VP, big)
    await h.hub.alarm()
    expect(h.storage.data.has(`raw:${VP}:2`)).toBe(true)
    const fresh = h.mk()
    expect((await fresh.getRaw(VP))?.bytes).toEqual(big)
  })
})
