import { AlertsResponse, RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryDataSource } from '../src/data/source.ts'
import { FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { silentLogger } from '../src/log.ts'
import { pullFromR2, resetRangeHints } from '../src/r2-snapshots.ts'
import { COMBINED_KEY, decodeCombined, encodeCombined } from '../src/rt/combined.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import {
  ALERTS_EVERY_MS,
  CYCLE_MS,
  HubCore,
  KEEPALIVE_MS,
  modeLatestKey,
  POINTER_HEARTBEAT_MS,
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

const dec = (b: Uint8Array | undefined) => new TextDecoder().decode(b)
const combinedOf = (r2: FakeR2) => decodeCombined(r2.files.get(COMBINED_KEY) as Uint8Array)
/** One mode's document JSON, from the combined object. */
const modeJson = (r2: FakeR2, m: string) => combinedOf(r2)?.docs.find((d) => d.mode === m)?.json as string
const modeDoc = (r2: FakeR2, m: string) => JSON.parse(modeJson(r2, m))
/** Rewrite one mode's document inside the combined object (the index keeps naming the same seqs). */
function setModeDoc(r2: FakeR2, m: string, doc: unknown) {
  const c = combinedOf(r2) as NonNullable<ReturnType<typeof combinedOf>>
  const sections = c.docs.map((d) => (d.mode === m ? { ...d, json: JSON.stringify(doc) } : d))
  r2.files.set(COMBINED_KEY, encodeCombined(c.index, sections))
}
/** Leave R2 as a hub from before the combined object would have: per-mode latest documents named by the pointer. */
function toLegacyLayout(r2: FakeR2) {
  const c = combinedOf(r2) as NonNullable<ReturnType<typeof combinedOf>>
  const ptr = JSON.parse(dec(r2.files.get('rt/latest.json')))
  for (const d of c.docs) {
    r2.files.set(modeLatestKey(d.mode), new TextEncoder().encode(d.json))
    ptr.files[d.mode] = { key: modeLatestKey(d.mode), seq: d.seq }
  }
  delete ptr.combined
  r2.files.delete(COMBINED_KEY)
  r2.files.set('rt/latest.json', new TextEncoder().encode(JSON.stringify(ptr)))
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
    // Compare bytes directly: toEqual walks a 2.5 MiB array element by element (~3 s locally, past the 20 s
    // timeout on busy CI runners).
    const got = (await fresh.getRaw(VP))?.bytes
    expect(got?.byteLength).toBe(big.byteLength)
    expect(got?.findIndex((b, i) => b !== big[i])).toBe(-1)
  })
})

describe('RtHub R2 publish', () => {
  it('writes the seq snapshot, then the pointer; the edge reader follows it and skips unchanged seqs', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const seq = (await h.hub.pull(null)).seq as number
    // The combined mode object, the alerts document (alerts changed), then the pointer.
    expect(r2.ops.slice(-3)).toEqual([
      `put:${COMBINED_KEY}`,
      `put:${scopeKey('alerts', seq)}`,
      'put:rt/latest.json',
    ])
    resetRangeHints()
    const src = new MemoryDataSource(r2.files)
    const writtenAt = combinedOf(r2)?.index.fetchedAt as number
    const a = await pullFromR2(src, null, 'ferry', writtenAt)
    expect(a.seq).toBe(seq)
    expect(RtSnapshot.parse(JSON.parse(a.json as string)).header.seq).toBe(seq)
    expect(a.status.stats?.ferry?.matched).toBe(1)
    // A cold isolate: the index, then its section (pinned to the same object version).
    expect(src.reads).toEqual([
      `${COMBINED_KEY}@0+1024`,
      expect.stringMatching(/^rt\/modes\/combined\.dat@\d+\+\d+$/),
    ])
    const reads = src.reads.length
    const b = await pullFromR2(src, seq, 'ferry', writtenAt + 5_000)
    expect(b.json).toBeNull()
    // Warm: one ranged GET covering the index and the ferry section, with no pointer read.
    expect(src.reads.slice(reads)).toEqual([expect.stringMatching(/^rt\/modes\/combined\.dat@0\+\d+$/)])
    // An object older than one poll (content unchanged for a while): one pointer read for the status.
    const c = await pullFromR2(src, seq, 'ferry', writtenAt + 60_000)
    expect(c).toMatchObject({ seq, json: null })
    expect(src.reads.slice(reads + 1)).toEqual([
      expect.stringMatching(/^rt\/modes\/combined\.dat@0\+\d+$/),
      'rt/latest.json',
    ])
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
    // Content changes every poll (a moving vehicle, a new alert each minute), so every document keeps being written.
    for (let i = 0; i < 4 * R2_KEEP_SNAPSHOTS + 3; i++) {
      h.up.set(TU, feed(h.nowS(), []))
      h.up.set(VP, feed(h.nowS(), [vehicle('V1', 'T1', D, -27.45, 153.05 + i / 1e4)]))
      h.up.set('alerts', feed(h.nowS(), [alert(`a${i}`, 'Bulimba works', 'F1-4055')]))
      await h.hub.alarm()
      h.clock.advance(CYCLE_MS)
    }
    // Modes: one overwritten combined object. Alerts: a ring of at most R2_KEEP_SNAPSHOTS. Nothing is deleted.
    expect(
      [...r2.files.keys()].filter((k) => k.startsWith('rt/ferry/') || k.startsWith('rt/modes/')),
    ).toEqual([COMBINED_KEY])
    const alertSlots = [...r2.files.keys()].filter((k) => k.startsWith('rt/alerts/')).length
    expect(alertSlots).toBeLessThanOrEqual(R2_KEEP_SNAPSHOTS)
    expect(alertSlots).toBeGreaterThan(R2_KEEP_SNAPSHOTS / 8) // alerts move every 4th poll here
    expect(r2.ops.some((o) => o.startsWith('delete'))).toBe(false)
    const seq = (await h.hub.pull(null)).seq as number
    expect(seq).toBeGreaterThan(R2_KEEP_SNAPSHOTS)
    expect(scopeKey('alerts', seq)).toBe(`rt/alerts/snapshot-${seq % R2_KEEP_SNAPSHOTS}.json`)
    const doc = modeDoc(r2, 'ferry')
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
    const r = await pullFromR2(src, null, 'alerts', h.clock.t)
    expect(r.seq).toBe(seq)
    expect(snapshotSeq(r.json as string)).toBe(seq)
    expect(reads.filter((k) => k === 'rt/latest.json')).toHaveLength(2)
    src.get = async (k: string) =>
      k === key
        ? { body: new Blob([JSON.stringify(stale)]).stream() as ReadableStream<Uint8Array> }
        : realGet(k)
    await expect(pullFromR2(src, null, 'alerts', h.clock.t)).rejects.toThrow(/not found/)
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
    expect(snapshotSeq(modeJson(r2, 'ferry'))).toBe(published + 1)
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
    expect(snapshotSeq(modeJson(r2, 'ferry'))).toBe(seq)
    expect(h.hub.status().lastError).toBeNull()
    // The pointer follows within its heartbeat, still with nothing rebuilt.
    h.clock.advance(POINTER_HEARTBEAT_MS)
    await h.hub.cycle()
    const pointer = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    expect(pointer.seq).toBe(seq)
    expect(pointer.combined.seq).toBe(seq)
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
    const old = modeDoc(r2, 'ferry')
    delete old.trips[`T2@${D}`].gen
    setModeDoc(r2, 'ferry', old)
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
    expect(Object.keys(ptr.files)).toEqual(['alerts'])
    expect(ptr.combined.key).toBe(COMBINED_KEY)
    expect(Object.keys(combinedOf(r2)?.index.sections ?? {}).sort()).toEqual(['ferry', 'train'])
    const ferry = RtSnapshot.parse(modeDoc(r2, 'ferry'))
    const train = RtSnapshot.parse(modeDoc(r2, 'train'))
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
    const bus = await pullFromR2(new MemoryDataSource(r2.files), null, 'bus', h.clock.t)
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
        { pull: (s, sc) => pullFromR2(src, s, sc, h.clock.t), getRaw: async () => null },
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
    const orphan = { key: `X9@${D}`, rel: 'CANCELED', ts: 1, until: h.nowS() + 3600, gen: 'g1', updates: [] }
    for (const m of ['ferry', 'train']) {
      const doc = modeDoc(r2, m)
      doc.trips[orphan.key] = orphan
      setModeDoc(r2, m, doc)
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
    // The alerts ring slot fails its exact seq check on the first read; meanwhile another publish moved the pointer.
    const bad = JSON.parse(new TextDecoder().decode(r2.files.get(ptr.files.alerts.key)))
    bad.header.seq = 999_999
    const goodBytes = r2.files.get(ptr.files.alerts.key) as Uint8Array
    r2.files.set(ptr.files.alerts.key, new TextEncoder().encode(JSON.stringify(bad)))
    let pointerReads = 0
    const realGet = r2.get.bind(r2)
    r2.get = async (key: string) => {
      if (key === 'rt/latest.json' && ++pointerReads === 2) {
        r2.files.set(ptr.files.alerts.key, goodBytes)
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

  it('single-read review: a partial publish (mode written, pointer not) still restores retained cancellations', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    h.up.set(
      TU,
      feed(h.nowS(), [tripUpdate('c', { tripId: 'T2', startDate: D, scheduleRelationship: 3 }, [])]),
    )
    await h.hub.cycle()
    // Next publish: the mode object is overwritten, then the pointer PUT fails.
    const realPut = r2.put.bind(r2)
    r2.put = async (key: string, value: Uint8Array | string) => {
      if (key === 'rt/latest.json') throw new Error('r2 down')
      return realPut(key, value)
    }
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.cycle()
    r2.put = realPut
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    const modeSeq = snapshotSeq(modeJson(r2, 'ferry'))
    expect(modeSeq).toBe(ptr.seq + 1)
    const fresh = h.mk()
    const restored = RtSnapshot.parse(JSON.parse((await fresh.pull(null)).json as string))
    expect(restored.trips[`T2@${D}`]?.rel).toBe('CANCELED')
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await fresh.cycle()
    const after = RtSnapshot.parse(JSON.parse((await fresh.pull(null, 'ferry')).json as string))
    expect(after.trips[`T2@${D}`]?.rel).toBe('CANCELED')
    expect(after.header.seq).toBeGreaterThan(modeSeq as number) // never reuses the partially published seq
  })

  it('single-read review: a stale latest object (older publisher took over) falls back to the pointer', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    toLegacyLayout(r2) // a hub from before the combined object
    const latest = JSON.parse(new TextDecoder().decode(r2.files.get(modeLatestKey('ferry'))))
    // An older ring publisher now writes rt/ferry/snapshot-{slot} + a pointer naming it; latest.json is abandoned.
    const seq = latest.header.seq + 5
    const ringKey = scopeKey('ferry', seq)
    const newer = { ...latest, header: { ...latest.header, seq, fetchedAt: h.clock.t } }
    r2.files.set(ringKey, new TextEncoder().encode(JSON.stringify(newer)))
    const ptr = JSON.parse(new TextDecoder().decode(r2.files.get('rt/latest.json')))
    ptr.seq = seq
    ptr.files.ferry = { key: ringKey, seq }
    r2.files.set('rt/latest.json', new TextEncoder().encode(JSON.stringify(ptr)))
    const src = new MemoryDataSource(r2.files)
    // Fresh enough: the direct object still wins.
    expect((await pullFromR2(src, null, 'ferry', latest.header.fetchedAt + 10_000)).seq).toBe(
      latest.header.seq,
    )
    // Abandoned: the pointer path gives the newer ring snapshot.
    expect((await pullFromR2(src, null, 'ferry', latest.header.fetchedAt + 60_000)).seq).toBe(seq)
  })

  it('combined: the pointer fallback accepts a combined object written after the pointer (partial publish)', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const realPut = r2.put.bind(r2)
    r2.put = async (key: string, value: Uint8Array | string) => {
      if (key === 'rt/latest.json') throw new Error('r2 down')
      return realPut(key, value)
    }
    h.clock.advance(POINTER_HEARTBEAT_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await h.hub.cycle()
    r2.put = realPut
    const ptr = JSON.parse(dec(r2.files.get('rt/latest.json')))
    const index = combinedOf(r2)?.index as NonNullable<ReturnType<typeof combinedOf>>['index']
    expect(index.seq).toBeGreaterThan(ptr.combined.seq)
    const newSeq = index.sections.ferry?.[2] as number
    // Past one poll the reader consults the pointer, and still takes the newer object, with its own status.
    const at = index.fetchedAt + 60_000
    const r = await pullFromR2(new MemoryDataSource(r2.files), null, 'ferry', at)
    expect(r.seq).toBe(newSeq)
    expect(r.status.seq).toBe(index.seq)
    const same = await pullFromR2(new MemoryDataSource(r2.files), newSeq, 'ferry', at)
    expect(same).toMatchObject({ seq: newSeq, json: null })
  })

  it('combined: a truncated object at restore is not misparsed; the hub restarts clean past every seq', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2 })
    await warm(h)
    const ptr = JSON.parse(dec(r2.files.get('rt/latest.json')))
    const whole = r2.files.get(COMBINED_KEY) as Uint8Array
    r2.files.set(COMBINED_KEY, whole.slice(0, whole.byteLength - 40))
    const fresh = h.mk()
    const restored = await fresh.pull(null)
    expect(restored.json).toBeNull()
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    await fresh.cycle()
    expect((await fresh.pull(null)).seq).toBeGreaterThan(ptr.seq)
    expect(combinedOf(r2)?.index.seq).toBeGreaterThan(ptr.seq) // rewritten whole
  })

  it('combined: readers accept the old per-mode layout (deploy or rollback) and the new one, chosen by the pointer', async () => {
    const r2 = new FakeR2()
    const h = setup({ r2, modes: 'ferry,train' })
    await warm(h)
    const seq = (await h.hub.pull(null, 'ferry')).seq as number
    const at = combinedOf(r2)?.index.fetchedAt as number
    const src = () => new MemoryDataSource(r2.files)
    const fresh = await pullFromR2(src(), null, 'ferry', at)
    // The old layout only (an older hub's documents, no combined object): read as before.
    const saved = new Map(r2.files)
    toLegacyLayout(r2)
    const legacy = await pullFromR2(src(), null, 'ferry', at)
    expect(legacy.seq).toBe(fresh.seq)
    expect(legacy.json).toBe(fresh.json)
    // A hub that went back to per-mode documents leaves a stale combined object behind: the pointer has no
    // `combined`, so once the object is older than a poll, readers take the per-mode documents.
    const legacyFiles = new Map(r2.files)
    for (const [k, v] of saved) if (k === COMBINED_KEY) r2.files.set(k, v)
    const newer = { ...modeDoc(r2, 'ferry'), header: { ...modeDoc(r2, 'ferry').header, seq: seq + 9 } }
    r2.files.set(modeLatestKey('ferry'), new TextEncoder().encode(JSON.stringify(newer)))
    const ptr = JSON.parse(dec(legacyFiles.get('rt/latest.json')))
    ptr.seq = seq + 9
    ptr.files.ferry = { key: modeLatestKey('ferry'), seq: seq + 9 }
    r2.files.set('rt/latest.json', new TextEncoder().encode(JSON.stringify(ptr)))
    expect((await pullFromR2(src(), null, 'ferry', at + 60_000)).seq).toBe(seq + 9)
    // And restore reads the old layout too.
    const restored = await h.mk().pull(null, 'train')
    expect(restored.json).not.toBeNull()
  })
})

describe('R2 PUT budget: unchanged documents and the pointer are not rewritten', () => {
  const VPR = 'VehiclePositions/Rail'
  /** A mode's document (its section of the combined object) or any other object, as text. */
  const isModeKey = (key: string) => /^rt\/[a-z]+\/latest\.json$/.test(key)
  const text = (r2: FakeR2, key: string) =>
    isModeKey(key) ? modeJson(r2, key.split('/')[1] as string) : new TextDecoder().decode(r2.files.get(key))
  const docSeq = (r2: FakeR2, key: string) => snapshotSeq(text(r2, key))
  /** A vehicle report stamped with its own time (as TransLink's are), so only a move changes it. */
  const at = (n: number, id: string, tripId: string, lat: number, lon: number) =>
    vehicle(id, tripId, D, lat, lon + n / 1e4, epoch(D, '07:00:00') + n)
  /** One poll: header times always move; ferry/train vehicles move only when asked. */
  async function poll(
    h: ReturnType<typeof setup>,
    move: { ferry?: number; train?: number } = {},
    hub: HubCore = h.hub,
  ) {
    h.clock.advance(CYCLE_MS)
    h.up.set(TU, feed(h.nowS(), []))
    h.up.set(VP, feed(h.nowS(), [at(move.ferry ?? 0, 'V1', 'T1', -27.45, 153.05)]))
    h.up.set(VPR, feed(h.nowS(), [at(move.train ?? 0, 'R1', 'TR9', -27.46, 153.02)]))
    await hub.cycle()
  }
  async function warmed(modes = 'ferry,train') {
    const r2 = new FakeR2()
    const h = setup({ r2, modes })
    await warm(h)
    await poll(h)
    h.clock.advance(POINTER_HEARTBEAT_MS)
    await poll(h) // settles: every document current, pointer just written
    return { r2, h }
  }

  it('an unchanged mode is not rewritten; a changed one is; header-only polls write nothing', async () => {
    const { r2, h } = await warmed()
    const ferryKey = modeLatestKey('ferry')
    const trainKey = modeLatestKey('train')
    const ferrySeq = docSeq(r2, ferryKey)
    r2.ops.length = 0
    await poll(h) // feed headers moved, content didn't
    expect(h.hub.lastTimings?.rebuilt).toBe(true)
    expect(r2.ops).toEqual([])
    expect(h.hub.lastTimings?.r2Puts).toBe(0)
    await poll(h, { train: 1 })
    // One combined object; the ferry section in it is carried over unchanged, with its older seq.
    expect(r2.ops).toEqual([`put:${COMBINED_KEY}`])
    expect(docSeq(r2, trainKey)).toBe((await h.hub.pull(null)).seq)
    expect(docSeq(r2, ferryKey)).toBe(ferrySeq)
    // The train document carries only train content; ferry still serves its older document.
    expect(JSON.parse(text(r2, trainKey)).vehicles.map((v: { id: string }) => v.id)).toEqual(['R1'])
    expect(JSON.parse(text(r2, ferryKey)).vehicles.map((v: { id: string }) => v.id)).toEqual(['V1'])
  })

  it('alerts refetched with the same content are not rewritten; changed alerts are, and move the pointer', async () => {
    const { r2, h } = await warmed('ferry')
    const ptr = JSON.parse(text(r2, 'rt/latest.json'))
    r2.ops.length = 0
    for (let i = 0; i < 5; i++) {
      h.up.set('alerts', feed(h.nowS(), [alert('a1', 'Bulimba works', 'F1-4055')])) // same alert, new body
      await poll(h)
    }
    expect(h.up.calls.filter((c) => c.path === 'alerts').length).toBeGreaterThan(1)
    expect(r2.ops.filter((o) => o.includes('/alerts/'))).toEqual([])
    h.clock.advance(ALERTS_EVERY_MS)
    h.up.set('alerts', feed(h.nowS(), [alert('a2', 'Riverside closed', 'F1-4055')]))
    r2.ops.length = 0
    await poll(h)
    const seq = (await h.hub.pull(null)).seq as number
    // The alerts slot first (the ferry document too: its alerts changed), the pointer last, at once.
    expect(r2.ops).toEqual([`put:${COMBINED_KEY}`, `put:${scopeKey('alerts', seq)}`, 'put:rt/latest.json'])
    const ptr2 = JSON.parse(text(r2, 'rt/latest.json'))
    expect(ptr2.files.alerts).toEqual({ key: scopeKey('alerts', seq), seq })
    expect(ptr2.files.alerts.seq).not.toBe(ptr.files.alerts.seq)
  })

  it('the pointer lands last, after every changed document has settled, and at most once per heartbeat', async () => {
    const { r2, h } = await warmed()
    const realPut = r2.put.bind(r2)
    let inflight = 0
    const order: string[] = []
    r2.put = async (key: string, value: Uint8Array | string) => {
      if (key === 'rt/latest.json') expect(inflight).toBe(0)
      inflight++
      // Documents finish in reverse order of starting, slowly.
      await new Promise((r) => setTimeout(r, key === COMBINED_KEY ? 15 : 5))
      inflight--
      order.push(key)
      return realPut(key, value)
    }
    const pointers = () => r2.ops.filter((o) => o === 'put:rt/latest.json').length
    const before = pointers()
    // Every poll changes both modes; over 2 heartbeats the pointer is written only on its heartbeat.
    const polls = Math.round((2 * POINTER_HEARTBEAT_MS) / CYCLE_MS)
    for (let i = 1; i <= polls; i++) await poll(h, { ferry: i, train: i })
    expect(pointers() - before).toBe(2)
    expect(order.at(-1)).toBe('rt/latest.json')
    // The pointer names the newest documents.
    const ptr = JSON.parse(text(r2, 'rt/latest.json'))
    const seq = (await h.hub.pull(null)).seq as number
    expect(ptr.seq).toBe(seq)
    expect(ptr.combined).toEqual({ key: COMBINED_KEY, seq })
    expect(combinedOf(r2)?.index.sections.ferry?.[2]).toBe(seq)
    expect(combinedOf(r2)?.index.sections.train?.[2]).toBe(seq)
  })

  it('a pointer skipped by a publish is written on its heartbeat even when nothing is rebuilt', async () => {
    const { r2, h } = await warmed()
    await poll(h, { train: 1 }) // a document written, the pointer not yet due
    const seq = (await h.hub.pull(null)).seq as number
    expect(JSON.parse(text(r2, 'rt/latest.json')).seq).toBeLessThan(seq)
    h.clock.advance(POINTER_HEARTBEAT_MS)
    await h.hub.cycle() // every feed 304: nothing rebuilt
    expect(h.hub.lastTimings?.rebuilt).toBe(false)
    const ptr = JSON.parse(text(r2, 'rt/latest.json'))
    expect(ptr.seq).toBe(seq)
    expect(ptr.combined.seq).toBe(seq)
    r2.ops.length = 0
    h.clock.advance(POINTER_HEARTBEAT_MS)
    await h.hub.cycle() // nothing owed: nothing written
    expect(r2.ops).toEqual([])
  })

  it('readers handle documents of different ages and take freshness from the source timestamp', async () => {
    const { r2, h } = await warmed()
    const ferryAt = JSON.parse(text(r2, modeLatestKey('ferry'))).header
    // Five minutes of polls in which only the train moves: the ferry document keeps its old header.
    for (let i = 1; i <= 20; i++) await poll(h, { train: i })
    h.clock.advance(POINTER_HEARTBEAT_MS)
    await h.hub.cycle() // pointer heartbeat
    const ferry = JSON.parse(text(r2, modeLatestKey('ferry')))
    expect(ferry.header.seq).toBe(ferryAt.seq)
    expect(ferry.header.sourceTimestamp).toBe(ferryAt.sourceTimestamp)
    const src = new MemoryDataSource(r2.files)
    const source = (await h.hub.pull(null)).status.sourceTimestamp as number
    expect(source - ferryAt.sourceTimestamp).toBeGreaterThan(300) // past STALE_AFTER_S if read from the document
    const f = await pullFromR2(src, null, 'ferry', h.clock.t)
    expect(f.seq).toBe(ferryAt.seq)
    expect(f.status.sourceTimestamp).toBe(source)
    expect(f.status.seq).toBeGreaterThan(ferryAt.seq)
    const t = await pullFromR2(src, null, 'train', h.clock.t)
    expect(t.seq).toBeGreaterThan(ferryAt.seq)
    // Through the API: the unchanged ferry document is live, with the upstream source time, not the document's.
    const client = (scope: SnapshotScope) =>
      new SnapshotClient(
        { pull: (s, sc) => pullFromR2(src, s, sc, h.clock.t), getRaw: async () => null },
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
        const cl = clients.get(sc) ?? client(sc)
        clients.set(sc, cl)
        return cl
      },
      now: h.clock.now,
      log: silentLogger,
      combinedFeeds: false,
      polledModes: ['ferry', 'train'],
    })
    const body = (await (await app.request('/v1/ferry/vehicles')).json()) as {
      rtState: string
      rtSourceTimestamp: number
      vehicles: Array<{ id: string }>
    }
    expect(body.rtState).toBe('live')
    expect(body.rtSourceTimestamp).toBe(source)
    expect(body.vehicles.map((v) => v.id)).toEqual(['V1'])
    const health = (await (await app.request('/v1/health')).json()) as { rt: { sourceTimestamp: number } }
    expect(health.rt.sourceTimestamp).toBe(source)
  })

  it('a failed combined PUT forgets the modes it changed (Codex review A r1): no stale skip, no older seq', async () => {
    const { r2, h } = await warmed()
    const ferryKey = modeLatestKey('ferry')
    await poll(h, { ferry: 1, train: 1 }) // content A for ferry
    const ferryA = docSeq(r2, ferryKey) as number
    const realPut = r2.put.bind(r2)
    r2.put = async (key: string, value: Uint8Array | string) => {
      if (key === COMBINED_KEY) {
        await realPut(key, value) // it lands, but the call reports a failure
        throw new Error('r2 down')
      }
      return realPut(key, value)
    }
    await poll(h, { ferry: 2, train: 1 }) // ferry B, reported failed
    expect(h.hub.status().lastError).toMatch(/r2 down/)
    const ferryB = docSeq(r2, ferryKey) as number
    r2.put = realPut
    // Reversion to A: R2 may hold B, so ferry is written again, under a seq newer than B's (never A's older one,
    // which a reader holding B would ignore).
    r2.ops.length = 0
    await poll(h, { ferry: 1, train: 1 })
    expect(r2.ops).toContain(`put:${COMBINED_KEY}`)
    expect(JSON.parse(text(r2, ferryKey)).vehicles[0].lon).toBeCloseTo(153.05 + 1 / 1e4, 4)
    expect(docSeq(r2, ferryKey)).toBeGreaterThan(ferryB)
    expect(ferryB).toBeGreaterThan(ferryA)
    // Nothing changed now: nothing but (at most) the pointer is written.
    r2.ops.length = 0
    await poll(h, { ferry: 1, train: 1 })
    expect(r2.ops.filter((o) => o !== 'put:rt/latest.json')).toEqual([])
  })

  it('a new alerts slot written in a failed publish still moves the pointer at once on the retry', async () => {
    const { r2, h } = await warmed('ferry,train')
    const realPut = r2.put.bind(r2)
    r2.put = async (key: string, value: Uint8Array | string) => {
      if (key === COMBINED_KEY) throw new Error('r2 down')
      return realPut(key, value)
    }
    h.clock.advance(ALERTS_EVERY_MS)
    h.up.set('alerts', feed(h.nowS(), [alert('a3', 'New closure', 'F1-4055')]))
    await poll(h, { train: 1 })
    r2.put = realPut
    const slot = [...r2.ops]
      .reverse()
      .find((o) => o.includes('/alerts/'))
      ?.slice(4)
    expect(slot).toBeDefined()
    await poll(h, { train: 1 }) // alerts unchanged now; the pointer is still owed for the new slot
    expect(JSON.parse(text(r2, 'rt/latest.json')).files.alerts.key).toBe(slot)
  })

  it('restore after a restart merges documents of different ages (newest header, every scope)', async () => {
    const { r2, h } = await warmed()
    for (let i = 1; i <= 4; i++) await poll(h, { train: i })
    h.clock.advance(POINTER_HEARTBEAT_MS)
    await h.hub.cycle()
    const ptr = JSON.parse(text(r2, 'rt/latest.json'))
    const sections = combinedOf(r2)?.index.sections
    const [ferrySeq, trainSeq] = [sections?.ferry?.[2] as number, sections?.train?.[2] as number]
    expect(ferrySeq).toBeLessThan(trainSeq)
    const before = await h.hub.pull(null)
    const fresh = h.mk()
    const restored = RtSnapshot.parse(JSON.parse((await fresh.pull(null)).json as string))
    expect(restored.header.seq).toBe(trainSeq) // the newest document's header
    expect(Object.keys(restored.trips).sort()).toEqual(
      Object.keys(RtSnapshot.parse(JSON.parse(before.json as string)).trips).sort(),
    )
    expect(restored.vehicles.map((v) => v.id).sort()).toEqual(['R1', 'V1'])
    // A restarted hub publishes everything once (its trip indexes reload, so its first documents differ anyway),
    // under a seq past every published one, pointer last.
    r2.ops.length = 0
    await poll(h, { train: 5 }, fresh)
    expect(r2.ops.at(-1)).toBe('put:rt/latest.json')
    const seq = (await fresh.pull(null)).seq as number
    expect(seq).toBeGreaterThan(ptr.seq) // never reuses a published seq
    expect(docSeq(r2, modeLatestKey('train'))).toBe(seq)
  })
})
