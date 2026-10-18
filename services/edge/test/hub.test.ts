import { AlertsResponse, RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryDataSource } from '../src/data/source.ts'
import { FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { silentLogger } from '../src/log.ts'
import { pullFromR2 } from '../src/r2-snapshots.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import {
  ALERTS_EVERY_MS,
  CYCLE_MS,
  HubCore,
  KEEPALIVE_MS,
  modeLatestKey,
  R2_KEEP_SNAPSHOTS,
  scopeKey,
  snapshotSeq,
  WATCHDOG_STALE_MS,
} from '../src/rt/hub-core.ts'
import type { SnapshotScope } from '../src/rt/split.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
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

class FakeR2 {
  readonly files = new Map<string, Uint8Array>()
  readonly ops: string[] = []
  fail = false
  async put(key: string, value: Uint8Array | string) {
    if (this.fail) throw new Error('r2 down')
    this.ops.push(`put:${key}`)
    this.files.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : value)
  }
  async get(key: string) {
    const b = this.files.get(key)
    return b ? { text: async () => new TextDecoder().decode(b) } : null
  }
}

const TU = 'TripUpdates/Ferry'
const VP = 'VehiclePositions/Ferry'

function setup(opts: { modes?: string; r2?: FakeR2 } = {}) {
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
      r2: opts.r2,
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
    expect(h.storage.alarmAt).toBe(epoch(D, '07:55:00') * 1000 + KEEPALIVE_MS)
  })

  it('keep-alive alarms every 7.5 s, polls every 15 s', async () => {
    const h = setup()
    for (let i = 0; i < 8; i++) {
      await h.hub.alarm()
      h.clock.advance(KEEPALIVE_MS)
    }
    expect(h.up.calls.filter((c) => c.path === TU)).toHaveLength(4)
  })

  it('keeps the chain alive when the cycle throws (store unreachable)', async () => {
    const h = setup()
    h.tree.source.files.delete('manifest.json')
    h.tree.source.get = async () => {
      throw new Error('data worker down')
    }
    await h.hub.alarm()
    expect(h.storage.alarmAt).not.toBeNull()
    expect(h.hub.status().lastError).toMatch(/no manifest.json|data worker down/)
  })

  it('re-arms in finally if the alarm went missing during the cycle', async () => {
    const h = setup()
    const orig = h.up.fetch
    h.up.fetch = async (u, i) => {
      h.storage.deleteAlarm()
      return orig(u, i)
    }
    await h.hub.alarm()
    expect(h.storage.alarmAt).toBe(h.clock.t + KEEPALIVE_MS)
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
    expect(h.storage.alarmAt).toBe(h.clock.t + KEEPALIVE_MS)
    expect((await h.hub.ensureRunning()).rearmed).toBe(false)
  })

  it('drill: a killed chain stays dead (even an in-flight alarm skips its re-arm) until the watchdog', async () => {
    const h = setup()
    await warm(h)
    await h.hub.killForDrill()
    h.clock.advance(KEEPALIVE_MS)
    await h.hub.alarm() // an alarm already queued fires, but the chain is dead
    expect(h.storage.alarmAt).toBeNull()
    h.clock.advance(WATCHDOG_STALE_MS)
    expect((await h.hub.ensureRunning()).rearmed).toBe(true)
    await h.hub.alarm()
    expect(h.storage.alarmAt).toBe(h.clock.t + KEEPALIVE_MS)
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
    h.up.set(
      TU,
      feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]),
    )
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

  it('alert modes are re-derived once the trip index has loaded (alerts fetched before it)', async () => {
    const h = setup()
    h.up.set(
      'alerts',
      feed(h.nowS(), [
        {
          id: 'a9',
          alert: { headerText: { translation: [{ text: 'x' }] }, informedEntity: [{ routeId: 'F11-4055' }] },
        },
      ]),
    )
    await warm(h)
    const snap = JSON.parse((await h.hub.pull(null)).json as string)
    expect(snap.alerts[0]).toMatchObject({ id: 'a9', modes: ['ferry'] })
  })

  it('combined feeds: entities of unloaded modes are not counted against a loaded mode', async () => {
    const h = setup({ modes: 'all' })
    h.up.set(
      'TripUpdates',
      feed(h.nowS(), [
        tripUpdate('f', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [{ seq: 1, depDelay: 30 }]),
        tripUpdate('b', { tripId: 'BUS1', startDate: D, routeId: '66-4055' }, [{ seq: 1, depDelay: 30 }]),
      ]),
    )
    h.up.set('VehiclePositions', feed(h.nowS(), []))
    await warm(h)
    const { status } = await h.hub.pull(null)
    expect(status.stats?.ferry).toMatchObject({ total: 1, matched: 1, unmatched: 0 })
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
    const big = feed(h.nowS(), [
      { ...vehicle('V1', 'T1', D, -27.45, 153.05), id: 'x'.repeat(2.5 * (1 << 20)) },
    ])
    h.up.set(VP, big)
    await h.hub.alarm()
    expect(h.storage.data.has(`raw:${VP}:2`)).toBe(true)
    const fresh = h.mk()
    expect((await fresh.getRaw(VP))?.bytes).toEqual(big)
  })
})

describe('RtHub R2 publish', () => {
  it('writes the seq snapshot, then the pointer; the edge reader follows it and skips unchanged seqs', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const seq = (await h.hub.pull(null)).seq as number
    // Per-mode document, the alerts document (alerts changed), then the pointer.
    expect(r2.ops.slice(-3)).toEqual([
      `put:${modeLatestKey('ferry')}`,
      `put:${scopeKey('alerts', seq)}`,
      'put:rt/latest.json',
    ])
    const src = new MemoryDataSource(r2.files)
    const a = await pullFromR2(src, null, 'ferry')
    expect(a.seq).toBe(seq)
    expect(RtSnapshot.parse(JSON.parse(a.json as string)).header.seq).toBe(seq)
    expect(a.status.stats?.ferry?.matched).toBe(1)
    const reads = src.reads.length
    const b = await pullFromR2(src, seq, 'ferry')
    expect(b.json).toBeNull()
    // Single-read refresh: a mode is one GET, with no pointer read first.
    expect(src.reads.slice(reads)).toEqual([modeLatestKey('ferry')])
  })

  it('keeps the snapshot only in R2 (not DO storage) and restores it from R2 after a restart', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    expect([...h.storage.data.keys()].some((k) => k.startsWith('snap:'))).toBe(false)
    const before = await h.hub.pull(null)
    const after = await h.mk().pull(null)
    expect(after.seq).toBe(before.seq)
    expect(after.json).toBe(before.json)
  })

  it('writes a fixed ring of R2_KEEP_SNAPSHOTS keys and never deletes', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    for (let i = 0; i < R2_KEEP_SNAPSHOTS + 3; i++) {
      h.up.set(TU, feed(h.nowS(), []))
      await h.hub.alarm()
      h.clock.advance(CYCLE_MS)
    }
    // Modes: one overwritten object each. Alerts: a ring of at most R2_KEEP_SNAPSHOTS. Nothing is deleted.
    expect([...r2.files.keys()].filter((k) => k.startsWith('rt/ferry/'))).toEqual([modeLatestKey('ferry')])
    expect([...r2.files.keys()].filter((k) => k.startsWith('rt/alerts/')).length).toBeLessThanOrEqual(
      R2_KEEP_SNAPSHOTS,
    )
    expect(r2.ops.some((o) => o.startsWith('delete'))).toBe(false)
    const seq = (await h.hub.pull(null)).seq as number
    expect(seq).toBeGreaterThan(R2_KEEP_SNAPSHOTS)
    expect(scopeKey('alerts', seq)).toBe(`rt/alerts/snapshot-${seq % R2_KEEP_SNAPSHOTS}.json`)
    const doc = JSON.parse(new TextDecoder().decode(r2.files.get(modeLatestKey('ferry'))))
    expect(doc.header.seq).toBe(seq)
  })

  it('alerts readers retry once when the ring slot does not hold the pointer seq', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    const { key, seq } = ptr.files.alerts
    const stale = JSON.parse(new TextDecoder().decode(r2.files.get(key)))
    stale.header.seq = seq + R2_KEEP_SNAPSHOTS
    const reads: string[] = []
    const src = new MemoryDataSource(r2.files)
    const realGet = src.get.bind(src)
    let first = true
    src.get = async (k: string) => {
      reads.push(k)
      if (k === key && first) {
        first = false
        return { body: new Blob([JSON.stringify(stale)]).stream() as ReadableStream<Uint8Array> }
      }
      return realGet(k)
    }
    const r = await pullFromR2(src, null, 'alerts')
    expect(r.seq).toBe(seq)
    expect(snapshotSeq(r.json as string)).toBe(seq)
    expect(reads.filter((k) => k === 'rt/latest.json')).toHaveLength(2)
    src.get = async (k: string) =>
      k === key
        ? { body: new Blob([JSON.stringify(stale)]).stream() as ReadableStream<Uint8Array> }
        : realGet(k)
    await expect(pullFromR2(src, null, 'alerts')).rejects.toThrow(/not found/)
  })

  it('an R2 outage is recorded but does not stop the cycle or the DO copy', async () => {
    const r2 = new FakeR2()
    r2.fail = true
    const h = setup({ r2 })
    await warm(h)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.alarm()
    expect(h.hub.status().lastError).toMatch(/r2: r2 down/)
    expect((await h.hub.pull(null)).json).not.toBeNull()
    expect(h.storage.alarmAt).not.toBeNull()
  })
})

describe('Codex review regressions', () => {
  it('#1 a fresh object never reuses a seq already published to R2', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const published = (await h.hub.pull(null)).seq as number
    // The object's own storage is lost (new namespace, or a failed write), R2 still has the pointer.
    h.storage.data.clear()
    const fresh = h.mk()
    h.up.set(TU, feed(h.nowS(), []))
    await fresh.cycle()
    expect((await fresh.pull(null)).seq).toBe(published + 1)
    expect(snapshotSeq(new TextDecoder().decode(r2.files.get(modeLatestKey('ferry'))))).toBe(published + 1)
  })

  it('#3 a failed R2 publish is retried on the next cycle even when feeds are unchanged', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    r2.fail = true
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.cycle()
    const seq = (await h.hub.pull(null)).seq as number
    r2.fail = false
    await h.hub.cycle() // all 304s, nothing rebuilt
    const pointer = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    expect(pointer.seq).toBe(seq)
    expect(h.hub.status().lastError).toBeNull()
  })

  it('#2 a DUPLICATED trip takes its identity and start time from TripProperties', async () => {
    const h = setup()
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [
        {
          id: 'dup',
          tripUpdate: {
            trip: {
              tripId: 'T1',
              startDate: D,
              startTime: '08:00:00',
              routeId: 'F1-4055',
              scheduleRelationship: 6,
            },
            tripProperties: { tripId: 'T1-0900', startDate: D, startTime: '09:00:00' },
            stopTimeUpdate: [
              { stopSequence: 1, stopId: '317584', departure: { delay: 0 } },
              { stopSequence: 3, stopId: '317590', arrival: { delay: 60 } },
            ],
          },
        },
      ]),
    )
    await h.hub.cycle()
    const snap = RtSnapshot.parse(JSON.parse((await h.hub.pull(null)).json as string))
    const t = snap.trips[`rt:T1-0900@${D}`]
    expect(t?.rel).toBe('DUPLICATED')
    expect(t?.added?.stops.map((x) => [x.stopId, x.dep])).toEqual([
      ['317584', epoch(D, '09:00:00')],
      ['317590', epoch(D, '09:16:00')],
    ])
  })

  it('#4 a cancellation is not carried into a new static generation', async () => {
    const h = setup()
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]),
    )
    await h.hub.cycle()
    h.tree.publish('g2') // same trip ids, new generation
    for (let i = 0; i < 3; i++) {
      h.clock.advance(CYCLE_MS)
      h.up.set(TU, feed(h.nowS(), []))
      await h.hub.cycle()
    }
    const snap = RtSnapshot.parse(JSON.parse((await h.hub.pull(null)).json as string))
    expect(snap.header.staticGeneration.ferry).toBe('g2')
    expect(snap.trips[`T2@${D}`]).toBeUndefined()
  })

  it('re-review #1 a cancellation restored after a restart survives until its mode has loaded', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]),
    )
    await h.hub.cycle()
    // Restart; upstream has dropped the cancellation by now.
    const fresh = h.mk()
    for (let i = 0; i < 3; i++) {
      h.clock.advance(CYCLE_MS)
      h.up.set(TU, feed(h.nowS(), []))
      await fresh.cycle()
      const snap = RtSnapshot.parse(JSON.parse((await fresh.pull(null)).json as string))
      expect(snap.trips[`T2@${D}`]?.rel).toBe('CANCELED')
    }
  })

  it('re-review #2 vehicles of a DUPLICATED trip attach to the duplicate, the original keeps its own', async () => {
    const h = setup()
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [
        tripUpdate('orig', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [{ seq: 1, depDelay: 0 }]),
        {
          id: 'dup',
          tripUpdate: {
            trip: {
              tripId: 'T1',
              startDate: D,
              startTime: '08:00:00',
              routeId: 'F1-4055',
              scheduleRelationship: 6,
            },
            tripProperties: { tripId: 'T1-0900', startDate: D, startTime: '09:00:00' },
            stopTimeUpdate: [
              { stopSequence: 1, stopId: '317584', departure: { delay: 0 } },
              { stopSequence: 3, stopId: '317590', arrival: { delay: 0 } },
            ],
          },
        },
      ]),
    )
    h.up.set(
      VP,
      feed(h.nowS(), [vehicle('VO', 'T1', D, -27.4, 153), vehicle('VD', 'T1-0900', D, -27.5, 153)]),
    )
    await h.hub.cycle()
    const snap = RtSnapshot.parse(JSON.parse((await h.hub.pull(null)).json as string))
    const byId = Object.fromEntries(snap.vehicles.map((v) => [v.id, v.tripKey]))
    expect(byId).toEqual({ VO: `T1@${D}`, VD: `rt:T1-0900@${D}` })
  })

  it('re-verify: cancellations survive staggered per-mode loading and a second restart', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2, modes: 'ferry,train' })
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]),
    )
    await h.hub.cycle()
    for (let restart = 0; restart < 2; restart++) {
      const fresh = h.mk()
      for (let i = 0; i < 4; i++) {
        h.clock.advance(CYCLE_MS)
        h.up.set(TU, feed(h.nowS(), []))
        await fresh.cycle()
        const snap = RtSnapshot.parse(JSON.parse((await fresh.pull(null)).json as string))
        expect(snap.trips[`T2@${D}`]).toMatchObject({ rel: 'CANCELED', gen: 'g1' })
      }
    }
  })

  it('a pre-provenance cancellation (no gen) is stamped from the header and survives restarts', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]),
    )
    await h.hub.cycle()
    // Rewrite the published snapshot as an older build would have: no gen on the record.
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    const old = JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files.ferry.key)))
    delete old.trips[`T2@${D}`].gen
    r2.files.set(ptr.files.ferry.key, new TextEncoder().encode(JSON.stringify(old)))
    for (let restart = 0; restart < 2; restart++) {
      const fresh = h.mk()
      for (let i = 0; i < 3; i++) {
        h.clock.advance(CYCLE_MS)
        h.up.set(TU, feed(h.nowS(), []))
        await fresh.cycle()
        const snap = RtSnapshot.parse(JSON.parse((await fresh.pull(null)).json as string))
        expect(snap.trips[`T2@${D}`]?.rel).toBe('CANCELED')
      }
    }
  })

  it('split: each mode document holds only its trips and vehicles; alerts written only when they change', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2, modes: 'ferry,train' })
    await warm(h)
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    expect(Object.keys(ptr.files).sort()).toEqual(['alerts', 'ferry', 'train'])
    const ferry = RtSnapshot.parse(JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files.ferry.key))))
    const train = RtSnapshot.parse(JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files.train.key))))
    expect(Object.keys(ferry.trips)).toEqual([`T1@${D}`])
    expect(ferry.vehicles.map((v) => v.id)).toEqual(['V1'])
    expect(train.trips).toEqual({})
    expect(train.header.staticGeneration).toEqual(ferry.header.staticGeneration)
    // A rebuild with unchanged alerts does not rewrite the alerts document.
    const alertsSeq = ptr.files.alerts.seq
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.cycle()
    const ptr2 = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    expect(ptr2.seq).toBeGreaterThan(ptr.seq)
    expect(ptr2.files.alerts.seq).toBe(alertsSeq)
    // A scope the hub doesn't publish reads as no snapshot, with the hub status.
    const bus = await pullFromR2(new MemoryDataSource(r2.files), null, 'bus')
    expect(bus).toMatchObject({ seq: null, json: null })
    expect(bus.status.seq).toBe(ptr2.seq)
  })

  it('split: pull(scope) over RPC returns the same per-scope documents', async () => {
    const h = setup()
    await warm(h)
    const ferry = RtSnapshot.parse(JSON.parse((await h.hub.pull(null, 'ferry')).json as string))
    const alerts = RtSnapshot.parse(JSON.parse((await h.hub.pull(null, 'alerts')).json as string))
    expect(Object.keys(ferry.trips)).toEqual([`T1@${D}`])
    expect(alerts.trips).toEqual({})
    expect(alerts.alerts.map((a) => a.id)).toEqual(['a1'])
  })

  it('split review: /v1/alerts via R2 stays live while the alerts document is unchanged', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    for (let i = 0; i < 25; i++) {
      h.clock.advance(CYCLE_MS)
      h.up.set(TU, feed(h.nowS(), []))
      await h.hub.cycle()
    }
    const src = new MemoryDataSource(r2.files)
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    expect(ptr.seq - ptr.files.alerts.seq).toBeGreaterThan(20) // the alerts document is old
    const client = (scope: SnapshotScope) =>
      new SnapshotClient(
        { pull: (s, sc) => pullFromR2(src, s, sc), getRaw: async () => null },
        h.clock.now,
        () => {},
        null,
        scope,
      )
    const clients = new Map<SnapshotScope, SnapshotClient>()
    const app = createApp({
      store: storeFor(h.tree, h.clock.now),
      snapshots: client('alerts'),
      snapshotsFor: (sc) => {
        const existing = clients.get(sc)
        if (existing) return existing
        const cl = client(sc)
        clients.set(sc, cl)
        return cl
      },
      now: h.clock.now,
      log: silentLogger,
      combinedFeeds: false,
      polledModes: ['ferry'],
    })
    const body = AlertsResponse.parse(await (await app.request('/v1/alerts')).json())
    expect(body.rtState).toBe('live')
    expect(body.rtSourceTimestamp).toBe(h.nowS())
    expect(body.alerts.map((a) => a.id)).toEqual(['a1'])
  })

  it('split review: restore keeps unknown-mode records in every mode document', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2, modes: 'ferry,train' })
    await warm(h)
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    const orphan = { key: `X9@${D}`, rel: 'CANCELED', ts: 1, until: h.nowS() + 3600, gen: 'g1', updates: [] }
    for (const m of ['ferry', 'train']) {
      const doc = JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files[m].key)))
      doc.trips[orphan.key] = orphan
      r2.files.set(ptr.files[m].key, new TextEncoder().encode(JSON.stringify(doc)))
    }
    const fresh = h.mk()
    for (const m of ['ferry', 'train'] as const) {
      const doc = RtSnapshot.parse(JSON.parse((await fresh.pull(null, m)).json as string))
      expect(doc.trips[orphan.key]?.rel).toBe('CANCELED')
    }
  })

  it('split review: an alerts document failing its seq check restores without alerts and refetches them', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    const bad = JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files.alerts.key)))
    bad.header.seq = 999_999
    r2.files.set(ptr.files.alerts.key, new TextEncoder().encode(JSON.stringify(bad)))
    const fresh = h.mk()
    const restored = RtSnapshot.parse(JSON.parse((await fresh.pull(null)).json as string))
    expect(Object.keys(restored.trips)).toContain(`T1@${D}`)
    const before = h.up.calls.filter((c) => c.path === 'alerts').length
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await fresh.cycle()
    expect(h.up.calls.filter((c) => c.path === 'alerts').length).toBe(before + 1)
    const next = RtSnapshot.parse(JSON.parse((await fresh.pull(null, 'alerts')).json as string))
    expect(next.alerts.map((a) => a.id)).toEqual(['a1'])
  })

  it('split review: a pointer re-read during restore advances seq (never reuse a published seq)', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    // The ferry slot fails its seq check on the first read; meanwhile another publish moved the pointer on.
    const bad = JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files.ferry.key)))
    bad.header.seq = 999_999
    const goodBytes = r2.files.get(ptr.files.ferry.key) as Uint8Array
    r2.files.set(ptr.files.ferry.key, new TextEncoder().encode(JSON.stringify(bad)))
    let pointerReads = 0
    const realGet = r2.get.bind(r2)
    r2.get = async (key: string) => {
      if (key === 'rt/latest.json' && ++pointerReads === 2) {
        r2.files.set(ptr.files.ferry.key, goodBytes)
        return { text: async () => JSON.stringify({ ...ptr, seq: ptr.seq + 5 }) }
      }
      return realGet(key)
    }
    const fresh = h.mk()
    await fresh.pull(null)
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await fresh.cycle()
    expect((await fresh.pull(null)).seq).toBe(ptr.seq + 6)
  })
})
