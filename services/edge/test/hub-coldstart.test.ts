import type { Manifest, Mode } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { MemoryDataSource } from '../src/data/source.ts'
import { StaticStore } from '../src/data/static-store.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { CYCLE_MS, HubCore } from '../src/rt/hub-core.ts'
import {
  buildTree,
  Clock,
  D,
  epoch,
  FakeStorage,
  FakeUpstream,
  feed,
  TRIPS,
  type Tree,
  tripUpdate,
} from './fixtures.ts'

const MODES: Mode[] = ['ferry', 'train', 'tram', 'bus']

/** One data source holding every mode's tree, with a manifest naming each mode's current generation. */
function multiTree() {
  const source = new MemoryDataSource()
  const trees = new Map<Mode, Tree>()
  const current: Partial<Record<Mode, string>> = {}
  const writeManifest = () => {
    const manifest: Manifest = {
      schemaVersion: 1,
      updatedAt: '2026-10-19T17:20:00Z',
      modes: Object.fromEntries(
        Object.entries(current).map(([m, g]) => [m, { current: g, previous: g, serviceDates: [] }]),
      ),
      quarantined: [],
    }
    source.files.set('manifest.json', new TextEncoder().encode(JSON.stringify(manifest)))
  }
  /** Publish generation `gen` for `mode` (each mode's tree writes its own blobs and index into the shared source). */
  const publish = (mode: Mode, gen: string) => {
    let t = trees.get(mode)
    if (!t) {
      // Ferry keeps the fixture trips (the feed matches T1); other modes get their own trip ids, so every mode's
      // trip-index blob (content-addressed) is distinct.
      const trips =
        mode === 'ferry'
          ? TRIPS
          : Object.fromEntries(
              Object.entries(TRIPS).map(([d, ts]) => [d, ts.map((t) => ({ ...t, id: `${mode}-${t.id}` }))]),
            )
      t = buildTree(gen, trips, mode)
      trees.set(mode, t)
    } else t.publish(gen)
    for (const [k, v] of t.source.files) if (k !== 'manifest.json') source.files.set(k, v)
    current[mode] = gen
    writeManifest()
  }
  for (const m of MODES) publish(m, 'g1')
  /** The blob key of a mode's trip index for a date in its current generation. */
  const tripBlob = (mode: Mode, date: string) => {
    const key = `static/${current[mode]}/${mode}/index.json`
    const index = JSON.parse(new TextDecoder().decode(source.files.get(key)))
    return `static/blobs/${index.tripIndex[date]}.json.gz`
  }
  return { source, publish, tripBlob }
}

function setup() {
  const clock = new Clock(epoch(D, '07:55:00') * 1000)
  const data = multiTree()
  const up = new FakeUpstream()
  const storage = new FakeStorage()
  const store = new StaticStore(data.source, { validate: true, manifestMaxAgeMs: 0, now: clock.now })
  const mk = (s = store) =>
    new HubCore({
      storage,
      fetch: up.fetch,
      now: clock.now,
      store: s,
      config: parseRtModes('all', MODES.join(',')),
      upstream: 'https://up.test/api/realtime/SEQ',
      fetchTimeoutMs: 50,
    })
  const nowS = () => Math.floor(clock.t / 1000)
  up.set(
    'TripUpdates',
    feed(nowS(), [
      tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [{ seq: 1, depDelay: 30 }]),
    ]),
  )
  up.set('VehiclePositions', feed(nowS(), []))
  up.set('alerts', feed(nowS(), []))
  return { clock, data, up, storage, store, hub: mk(), mk }
}

const generations = async (hub: HubCore) => (await hub.pull(null)).status.generations

const snapshotGenerations = async (hub: HubCore) =>
  JSON.parse((await hub.pull(null)).json as string).header.staticGeneration as Partial<Record<Mode, string>>

describe('RtHub cold start: every unindexed mode loads in one cycle', () => {
  it('the first cycle of a fresh hub indexes both days of every polled mode', async () => {
    const h = setup()
    await h.hub.alarm()
    expect(await generations(h.hub)).toEqual({ ferry: 'g1', train: 'g1', tram: 'g1', bus: 'g1' })
    // The snapshot built in that same cycle already carries every mode as loaded.
    expect(await snapshotGenerations(h.hub)).toMatchObject({
      ferry: 'g1',
      train: 'g1',
      tram: 'g1',
      bus: 'g1',
    })
    expect((await h.hub.pull(null)).status.lastError).toBeNull()
  })

  it('after a restart (empty indexes, restored snapshot) the first cycle reloads every mode', async () => {
    const h = setup()
    await h.hub.alarm()
    h.clock.advance(CYCLE_MS)
    const restarted = h.mk(
      new StaticStore(h.data.source, { validate: true, manifestMaxAgeMs: 0, now: h.clock.now }),
    )
    await restarted.alarm()
    expect(await generations(restarted)).toEqual({ ferry: 'g1', train: 'g1', tram: 'g1', bus: 'g1' })
  })

  it('fetches the trip-index blobs concurrently but decodes one day at a time', async () => {
    const h = setup()
    let fetching = 0
    let maxFetching = 0
    let decoding = 0
    let maxDecoding = 0
    let decoded = 0
    const store = h.store
    const bytes = store.tripIndexDayBytes.bind(store)
    store.tripIndexDayBytes = async (index, date) => {
      fetching++
      maxFetching = Math.max(maxFetching, fetching)
      await new Promise((r) => setTimeout(r, 5))
      try {
        return await bytes(index, date)
      } finally {
        fetching--
      }
    }
    const decode = store.decodeTripIndexDay.bind(store)
    store.decodeTripIndexDay = async (b) => {
      decoding++
      maxDecoding = Math.max(maxDecoding, decoding)
      try {
        return await decode(b)
      } finally {
        decoding--
        decoded++
      }
    }
    await h.hub.alarm()
    expect(decoded).toBe(MODES.length * 2)
    expect(maxFetching).toBe(MODES.length * 2)
    expect(maxDecoding).toBe(1)
  })

  it('a failed mode does not block the others and is retried on the next cycle', async () => {
    const h = setup()
    const key = h.data.tripBlob('bus', D)
    const blob = h.data.source.files.get(key) as Uint8Array
    h.data.source.files.delete(key)
    await h.hub.alarm()
    expect(await generations(h.hub)).toEqual({ ferry: 'g1', train: 'g1', tram: 'g1' })
    const { status } = await h.hub.pull(null)
    expect(status.lastError).toMatch(/static bus: trip index bus g1 20261020 missing/)
    // Bus stays unloaded in the snapshot (no live claim before its index), the others are live.
    const snap = await snapshotGenerations(h.hub)
    expect(snap.bus).toBeUndefined()
    expect(snap.ferry).toBe('g1')

    h.data.source.files.set(key, blob)
    h.clock.advance(CYCLE_MS)
    await h.hub.alarm()
    expect(await generations(h.hub)).toEqual({ ferry: 'g1', train: 'g1', tram: 'g1', bus: 'g1' })
    expect((await h.hub.pull(null)).status.lastError).toBeNull()
  })

  it('a mode whose generation index is missing fails alone', async () => {
    const h = setup()
    const key = 'static/g1/train/index.json'
    const index = h.data.source.files.get(key) as Uint8Array
    h.data.source.files.delete(key)
    await h.hub.alarm()
    expect(await generations(h.hub)).toEqual({ ferry: 'g1', tram: 'g1', bus: 'g1' })
    expect((await h.hub.pull(null)).status.lastError).toMatch(/static train: index g1\/train missing/)
    // The missing index isn't cached: once it appears, the next cycle loads train.
    h.data.source.files.set(key, index)
    h.clock.advance(CYCLE_MS)
    await h.hub.alarm()
    expect(await generations(h.hub)).toEqual({ ferry: 'g1', train: 'g1', tram: 'g1', bus: 'g1' })
  })

  it('a read that throws (R2 error) fails only its mode', async () => {
    const h = setup()
    const key = h.data.tripBlob('tram', D)
    const get = h.data.source.get.bind(h.data.source)
    h.data.source.get = async (k) => {
      if (k === key) throw new Error('r2 503')
      return get(k)
    }
    await h.hub.alarm()
    expect(await generations(h.hub)).toEqual({ ferry: 'g1', train: 'g1', bus: 'g1' })
    expect((await h.hub.pull(null)).status.lastError).toMatch(/static tram: r2 503/)
  })
})

describe('RtHub steady state: indexed modes still reload one day per cycle', () => {
  it('a generation change swaps each mode in after its own two cycles, the old index serving meanwhile', async () => {
    const h = setup()
    await h.hub.alarm()
    h.data.publish('ferry', 'g2')
    h.data.publish('bus', 'g2')
    const decoded: string[] = []
    const decode = h.store.decodeTripIndexDay.bind(h.store)
    h.store.decodeTripIndexDay = (b) => {
      decoded.push('cold')
      return decode(b)
    }
    const seen: Array<Partial<Record<Mode, string>>> = []
    for (let i = 0; i < 4; i++) {
      h.clock.advance(CYCLE_MS)
      await h.hub.alarm()
      seen.push(await generations(h.hub))
    }
    expect(seen.map((g) => [g.ferry, g.bus])).toEqual([
      ['g1', 'g1'],
      ['g2', 'g1'],
      ['g2', 'g1'],
      ['g2', 'g2'],
    ])
    expect(decoded).toEqual([]) // never the cold path
  })

  it('an unindexed mode still loads at once while another mode reloads incrementally', async () => {
    const h = setup()
    const key = h.data.tripBlob('bus', D)
    const blob = h.data.source.files.get(key) as Uint8Array
    h.data.source.files.delete(key)
    await h.hub.alarm() // bus fails
    h.data.publish('ferry', 'g2')
    h.data.source.files.set(key, blob)
    h.clock.advance(CYCLE_MS)
    await h.hub.alarm() // bus loads whole; ferry starts its g2 reload
    let g = await generations(h.hub)
    expect([g.ferry, g.bus]).toEqual(['g1', 'g1'])
    h.clock.advance(CYCLE_MS)
    await h.hub.alarm()
    g = await generations(h.hub)
    expect([g.ferry, g.bus]).toEqual(['g2', 'g1'])
  })
})
