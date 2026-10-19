/**
 * The 19 Oct staging stall: a shared snapshot refresh that never settled (its I/O died with the request that
 * started it) held every later ferry request in that isolate until the caller's 10 s deadline. These tests use
 * hubs, caches and data sources that never answer, or answer late, and check that nobody waits past a deadline.
 */
import { DeparturesResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { MemoryDataSource } from '../src/data/source.ts'
import { StaticStore } from '../src/data/static-store.ts'
import { DeadlineError } from '../src/deadline.ts'
import { silentLogger } from '../src/log.ts'
import type { PullResult } from '../src/rt/hub-core.ts'
import { type HubClient, SNAPSHOT_REFRESH_MS, SnapshotClient } from '../src/snapshot-client.ts'
import { stationsFor } from '../src/stations.ts'
import { buildTree, Clock, D, epoch, storeFor } from './fixtures.ts'

const DEADLINE = 80
const STALE_WAIT = 20
/** Generous slack for timer jitter on a busy CI runner; the stall this guards against lasted 10 s. */
const SLACK = 150
const timing = { refreshDeadlineMs: DEADLINE, staleWaitMs: STALE_WAIT }

const snap = (seq: number, sourceTimestamp = 1, fetchedAt = 1) =>
  JSON.stringify({
    header: {
      schemaVersion: 1,
      seq,
      staticGeneration: { ferry: 'g1' },
      serviceDates: [D],
      sourceTimestamp,
      fetchedAt,
    },
    trips: {},
    vehicles: [],
    alerts: [],
  })
const status = (seq: number | null) => ({
  seq,
  sourceTimestamp: null,
  fetchedAt: null,
  lastCycleAt: null,
  lastError: null,
  stats: null,
  generations: {},
})
const result = (seq: number, json = snap(seq)): PullResult => ({ seq, json, status: status(seq) })

/** A promise and the handles to settle it later (or never). */
function deferred<T>() {
  let resolve: (v: T) => void = () => {}
  let reject: (e: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A hub whose pulls are answered by the scripted behaviours in order; past the script, it answers `fallback`. */
function scriptedHub(script: Array<() => Promise<PullResult>>, fallback: () => Promise<PullResult>) {
  const hub = {
    pulls: 0,
    pull: (): Promise<PullResult> => {
      const step = script[hub.pulls++]
      return step ? step() : fallback()
    },
    getRaw: async () => null,
  } satisfies HubClient & { pulls: number }
  return hub
}

const never = <T>() => new Promise<T>(() => {})

async function timed<T>(p: Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await p
  return { value, ms: performance.now() - t0 }
}

describe('SnapshotClient refresh deadline', () => {
  it('cold, hub never answers: the request fails fast (null), the refresh is dropped, the next one succeeds', async () => {
    const clock = new Clock(0)
    const hub = scriptedHub([never], async () => result(7))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    const { value, ms } = await timed(client.get())
    expect(value).toBeNull()
    expect(ms).toBeLessThan(DEADLINE + SLACK)
    expect(client.abandoned).toBe(1)
    // Its own timer fired, so its request was alive: the hub is slow, not lost, and the 10 s throttle stands (r3 P2).
    const next = await timed(client.get())
    expect(next.value).toBeNull()
    expect(next.ms).toBeLessThan(SLACK)
    expect(hub.pulls).toBe(1)
    clock.advance(SNAPSHOT_REFRESH_MS)
    expect((await client.get())?.seq).toBe(7)
    expect(hub.pulls).toBe(2)
  })

  it('a lost refresh (past its deadline before its own timer could fire) is retried at once, not throttled', async () => {
    const clock = new Clock(0)
    const hub = scriptedHub([async () => result(1), never], async () => result(2))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    await client.get()
    clock.advance(SNAPSHOT_REFRESH_MS)
    const bg: Promise<unknown>[] = []
    expect((await client.get((p) => bg.push(p)))?.seq).toBe(1) // background refresh, which never settles
    // Its request ended: its timer never fires. The next request, past the deadline, presumes it lost (Codex r1 #1).
    clock.advance(DEADLINE)
    expect((await client.get())?.seq).toBe(1) // SWR: serves the copy and starts a new refresh at once
    expect(client.abandoned).toBe(1)
    expect(hub.pulls).toBe(3)
  })

  it('an expired copy is served (flagged expired) after the short wait, not after the refresh deadline', async () => {
    const clock = new Clock(0)
    const hub = scriptedHub([async () => result(1), never], async () => result(2))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    expect((await client.get())?.seq).toBe(1)
    expect(client.expired).toBe(false)
    clock.advance(61_000)
    const { value, ms } = await timed(client.get())
    expect(value?.seq).toBe(1)
    expect(ms).toBeLessThan(STALE_WAIT + SLACK)
    expect(client.expired).toBe(true)
    // The hung refresh isn't abandoned by a short waiter, but past its deadline the next request replaces it.
    expect(client.abandoned).toBe(0)
    clock.advance(DEADLINE)
    expect(await client.get()).toBeTruthy()
    expect(client.abandoned).toBe(1)
    clock.advance(SNAPSHOT_REFRESH_MS)
    expect((await client.get())?.seq).toBe(2)
    expect(client.expired).toBe(false)
  })

  it('a hung refresh that settles late does not overwrite what a newer refresh loaded', async () => {
    const clock = new Clock(0)
    const late = deferred<PullResult>()
    const hub = scriptedHub([() => late.promise], async () => result(3))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    expect(await client.get()).toBeNull() // abandoned at the deadline
    clock.advance(SNAPSHOT_REFRESH_MS)
    expect((await client.get())?.seq).toBe(3)
    expect(client.status?.seq).toBe(3)
    late.resolve(result(2))
    await new Promise((r) => setTimeout(r, 0))
    expect((await client.get())?.seq).toBe(3)
    expect(client.status?.seq).toBe(3)
  })

  describe('a hub slower than the refresh deadline (release review r3 P2)', () => {
    const SLOW = DEADLINE + 40
    const slowTiming = { ...timing, lateCommitMs: SLOW * 4 }
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    /** Every pull answers, but only after SLOW real ms (above the deadline), with the next seq. */
    function slowHub() {
      let seq = 0
      return scriptedHub([], async () => {
        const s = ++seq
        await sleep(SLOW)
        return result(s)
      })
    }

    it('cold: the request fails fast, and the late answer still commits', async () => {
      const clock = new Clock(0)
      const hub = slowHub()
      const bg: Promise<unknown>[] = []
      const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, slowTiming)
      const { value, ms } = await timed(client.get((p) => bg.push(p)))
      expect(value).toBeNull()
      expect(ms).toBeLessThan(DEADLINE + SLACK)
      expect(client.abandoned).toBe(1)
      await Promise.all(bg) // the request's waitUntil holds the refresh itself, so its late answer lands
      expect((await client.get())?.seq).toBe(1)
      expect(client.status?.seq).toBe(1)
      expect(client.expired).toBe(false)
      expect(hub.pulls).toBe(1)
    })

    it('warm: every refresh commits late, the copy never expires, and the hub is asked once per 10 s', async () => {
      const clock = new Clock(0)
      const hub = slowHub()
      const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, slowTiming)
      const bg: Promise<unknown>[] = []
      await client.get((p) => bg.push(p))
      await Promise.all(bg.splice(0))
      expect((await client.get())?.seq).toBe(1)
      // Two minutes of one request a second. Before the fix the throttle was reset at every deadline and the late
      // answers dropped: a pull on nearly every request, and the copy expired at 60 s.
      for (let i = 0; i < 120; i++) {
        clock.advance(1_000)
        const r = await client.get((p) => bg.push(p))
        expect(r).toBeTruthy()
        expect(client.expired).toBe(false)
        await Promise.all(bg.splice(0))
      }
      expect(hub.pulls).toBeLessThanOrEqual(1 + 120 / (SNAPSHOT_REFRESH_MS / 1000) + 1)
      expect(hub.pulls).toBeGreaterThanOrEqual(1 + 120 / (SNAPSHOT_REFRESH_MS / 1000) - 1)
      expect((await client.get())?.seq).toBe(hub.pulls) // each pull committed
    })

    it('expired copy: the waiter is still served within its short wait, and the late answer commits', async () => {
      const clock = new Clock(0)
      const hub = slowHub()
      const bg: Promise<unknown>[] = []
      const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, slowTiming)
      await client.get((p) => bg.push(p))
      await Promise.all(bg.splice(0))
      clock.advance(61_000)
      const { value, ms } = await timed(client.get((p) => bg.push(p)))
      expect(value?.seq).toBe(1)
      expect(ms).toBeLessThan(STALE_WAIT + SLACK)
      expect(client.expired).toBe(true)
      await Promise.all(bg.splice(0))
      expect((await client.get())?.seq).toBe(2)
      expect(client.expired).toBe(false)
    })

    it('a late answer older than the current copy is ignored (snapshot and status)', async () => {
      const clock = new Clock(0)
      const late = deferred<PullResult>()
      const hub = scriptedHub([async () => result(4), () => late.promise], async () => result(6))
      const bg: Promise<unknown>[] = []
      const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, slowTiming)
      expect((await client.get())?.seq).toBe(4)
      clock.advance(SNAPSHOT_REFRESH_MS)
      await client.get((p) => bg.push(p)) // background refresh: slow, abandoned at its deadline
      await sleep(DEADLINE + 20)
      expect(client.abandoned).toBe(1)
      clock.advance(SNAPSHOT_REFRESH_MS)
      await client.get((p) => bg.push(p)) // the next one commits seq 6 on time
      await bg.at(-1)
      expect(client.status?.seq).toBe(6)
      late.resolve(result(5))
      await Promise.all(bg)
      expect((await client.get())?.seq).toBe(6)
      expect(client.status?.seq).toBe(6)
    })
  })

  it('a rejecting refresh: cold fails fast, a copy is served, and the next refresh succeeds', async () => {
    const clock = new Clock(0)
    const boom = async (): Promise<PullResult> => {
      throw new Error('r2 down')
    }
    const hub = scriptedHub([boom, async () => result(1), boom], async () => result(4))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    expect(await client.get()).toBeNull()
    clock.advance(SNAPSHOT_REFRESH_MS)
    expect((await client.get())?.seq).toBe(1)
    clock.advance(61_000)
    const { value, ms } = await timed(client.get())
    expect(value?.seq).toBe(1)
    expect(ms).toBeLessThan(SLACK)
    expect(client.expired).toBe(true)
    clock.advance(SNAPSHOT_REFRESH_MS)
    expect((await client.get())?.seq).toBe(4)
    expect(client.abandoned).toBe(0) // failures settle; nothing had to be abandoned
  })

  it('a Cache API match that never answers is bounded the same way', async () => {
    const clock = new Clock(0)
    const cache = { match: () => never<Response | undefined>(), put: async () => {} }
    const hub = scriptedHub([], async () => result(1))
    const client = new SnapshotClient(hub, clock.now, () => {}, cache, 'ferry', undefined, timing)
    const { value, ms } = await timed(client.get())
    expect(value).toBeNull()
    expect(ms).toBeLessThan(DEADLINE + SLACK)
    expect(hub.pulls).toBe(0)
    expect(client.abandoned).toBe(1)
  })

  it('two requests: the refresh started in request A is lost with A; request B is not held by it', async () => {
    const clock = new Clock(0)
    // A's refresh I/O is cancelled with A's context: in workerd that promise simply never settles.
    const hub = scriptedHub([async () => result(1), never], async () => result(2))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    await client.get()
    clock.advance(59_990)
    const ctxA: Promise<unknown>[] = []
    expect((await client.get((p) => ctxA.push(p)))?.seq).toBe(1) // A: served at once, refresh in A's waitUntil
    expect(ctxA).toHaveLength(1)
    // B arrives just after the copy expired, while A's refresh is still in flight (and never settles).
    clock.advance(20)
    const ctxB: Promise<unknown>[] = []
    const b = await timed(client.get((p) => ctxB.push(p)))
    expect(b.value?.seq).toBe(1)
    expect(b.ms).toBeLessThan(STALE_WAIT + SLACK)
    expect(ctxB).toHaveLength(0) // B joined (bounded); it didn't start a duplicate
    expect(client.expired).toBe(true)
    // C, past A's deadline and the 10 s attempt throttle: drops A's refresh and runs its own in its own context.
    clock.advance(SNAPSHOT_REFRESH_MS)
    const ctxC: Promise<unknown>[] = []
    const c = await timed(client.get((p) => ctxC.push(p)))
    expect(c.value?.seq).toBe(2)
    expect(ctxC).toHaveLength(1)
    expect(client.abandoned).toBe(1)
    expect(hub.pulls).toBe(3)
  })

  it('hot path: a healthy hub is called once per 10 s however many requests, and SWR is unchanged', async () => {
    const clock = new Clock(0)
    let seq = 1
    const hub = scriptedHub([], async () => result(seq))
    const client = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    await client.get()
    for (let i = 0; i < 50; i++) await client.get()
    expect(client.hubCalls).toBe(1)
    clock.advance(SNAPSHOT_REFRESH_MS)
    seq = 2
    const bg: Promise<unknown>[] = []
    const reqs = await Promise.all(Array.from({ length: 20 }, () => client.get((p) => bg.push(p))))
    expect(reqs.every((r) => r?.seq === 1)).toBe(true) // served the copy at once
    expect(bg).toHaveLength(1) // one background refresh
    await bg[0]
    expect((await client.get())?.seq).toBe(2)
    expect(client.hubCalls).toBe(2)
    expect(client.abandoned).toBe(0)
  })

  it('raw(): a getRaw that never answers returns the last good copy (or null) and is replaced', async () => {
    const clock = new Clock(0)
    const feed = { bytes: new Uint8Array([1]), fetchedAt: 1 } as unknown as Awaited<
      ReturnType<HubClient['getRaw']>
    >
    let calls = 0
    const hub: HubClient = {
      pull: async () => result(1),
      getRaw: () => (++calls === 2 ? never() : Promise.resolve(feed)),
    }
    const client = new SnapshotClient(hub, clock.now, () => {}, null, undefined, undefined, timing)
    expect(await client.raw('k')).toBe(feed)
    clock.advance(SNAPSHOT_REFRESH_MS)
    const { value, ms } = await timed(client.raw('k'))
    expect(value).toBe(feed)
    expect(ms).toBeLessThan(DEADLINE + SLACK)
    expect(await client.raw('k')).toBe(feed)
    expect(calls).toBe(3)
  })
})

describe('departures with a stalled snapshot', () => {
  const nowMs = epoch(D, '07:55:00') * 1000

  function app(hub: HubClient, clock: Clock) {
    const tree = buildTree()
    const snapshots = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    return createApp({
      store: storeFor(tree, clock.now),
      snapshots,
      snapshotsFor: () => snapshots,
      now: clock.now,
      log: silentLogger,
      combinedFeeds: false,
      polledModes: ['ferry'],
    })
  }

  it('cold isolate, hub never answers: scheduled rows, rtState unavailable, within the deadline', async () => {
    const clock = new Clock(nowMs)
    const a = app(scriptedHub([], never), clock)
    const { value: res, ms } = await timed(Promise.resolve(a.request('/v1/ferry/stops/317584/departures')))
    expect(res.status).toBe(200)
    const body = DeparturesResponse.parse(await res.json())
    expect(body.rtState).toBe('unavailable')
    expect(body.departures.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(DEADLINE + SLACK)
  })

  it('expired copy, hub stalled: served promptly and reported stale, never live', async () => {
    const clock = new Clock(nowMs)
    const fresh = async () => result(1, snap(1, Math.floor(clock.t / 1000), clock.t))
    const a = app(scriptedHub([fresh], never), clock)
    const first = DeparturesResponse.parse(
      await (await a.request('/v1/ferry/stops/317584/departures')).json(),
    )
    expect(first.rtState).toBe('live')
    clock.advance(61_000) // past maxStale, but its source time (61 s) alone would still read as live
    const { value: res, ms } = await timed(Promise.resolve(a.request('/v1/ferry/stops/317584/departures')))
    const body = DeparturesResponse.parse(await res.json())
    expect(body.rtState).toBe('stale')
    expect(body.rtSourceTimestamp).toBe(first.rtSourceTimestamp)
    expect(ms).toBeLessThan(STALE_WAIT + SLACK)
  })
})

describe('static reads with a stalled data source', () => {
  /** A MemoryDataSource whose reads of `stall` never answer while `stalled` is true. */
  function stallingSource(files: Map<string, Uint8Array>, stall: (key: string) => boolean) {
    const src = new MemoryDataSource(files)
    const get = src.get.bind(src)
    const state = { stalled: true }
    src.get = (key) => {
      if (!state.stalled || !stall(key)) return get(key)
      src.reads.push(key)
      return never()
    }
    return { src, state }
  }
  const manifest = (gen: string) =>
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: gen,
        modes: { ferry: { current: gen, serviceDates: [D] } },
        quarantined: [],
      }),
    )

  it('cold manifest read never answers: null within the deadline, then a new read succeeds', async () => {
    let t = 0
    const { src, state } = stallingSource(new Map([['manifest.json', manifest('g1')]]), () => true)
    const store = new StaticStore(src, { now: () => t, loadDeadlineMs: DEADLINE })
    const { value, ms } = await timed(store.currentGeneration('ferry'))
    expect(value).toBeNull()
    expect(ms).toBeLessThan(DEADLINE + SLACK)
    state.stalled = false
    t += 1
    expect(await store.currentGeneration('ferry')).toBe('g1')
    expect(src.reads.filter((k) => k === 'manifest.json')).toHaveLength(2)
  })

  it('a manifest read that settles late does not replace the newer manifest', async () => {
    let t = 0
    const late = deferred<null>()
    const src = new MemoryDataSource(new Map([['manifest.json', manifest('g2')]]))
    const real = src.get.bind(src)
    let first = true
    src.get = (key) => {
      if (first) {
        first = false
        // Settles later with an older manifest's bytes.
        return late.promise.then(() => ({
          body: new Blob([manifest('g1') as unknown as ArrayBuffer]).stream() as ReadableStream<Uint8Array>,
        }))
      }
      return real(key)
    }
    const store = new StaticStore(src, { now: () => t, loadDeadlineMs: DEADLINE })
    expect(await store.currentGeneration('ferry')).toBeNull()
    expect(await store.currentGeneration('ferry')).toBe('g2')
    late.resolve(null)
    await new Promise((r) => setTimeout(r, 10))
    t = 120_000 // let the manifest go stale so a regression would have to show here
    expect((await store.getManifest((p) => void p))?.updatedAt).toBe('g2')
  })

  it('a background manifest refresh that never answers settles at its own deadline and commits nothing', async () => {
    let t = 0
    const late = deferred<null>()
    const src = new MemoryDataSource(new Map([['manifest.json', manifest('g1')]]))
    const real = src.get.bind(src)
    const store = new StaticStore(src, { manifestMaxAgeMs: 60_000, now: () => t, loadDeadlineMs: DEADLINE })
    expect(await store.currentGeneration('ferry')).toBe('g1')
    src.get = () =>
      late.promise.then(() => ({
        body: new Blob([manifest('g0') as unknown as ArrayBuffer]).stream() as ReadableStream<Uint8Array>,
      }))
    t = 61_000
    const bg: Promise<unknown>[] = []
    expect(await store.currentGeneration('ferry', (p) => bg.push(p))).toBe('g1')
    expect(bg).toHaveLength(1)
    // No other request comes along; the waitUntil promise still ends at the deadline.
    const { ms } = await timed(bg[0] as Promise<unknown>)
    expect(ms).toBeLessThan(DEADLINE + SLACK)
    late.resolve(null)
    await new Promise((r) => setTimeout(r, 10))
    src.get = real
    expect((await store.getManifest())?.modes.ferry?.current).toBe('g1') // the late g0 was not committed
  })

  it('an index read that never answers rejects within the deadline and is retried on the next request', async () => {
    const tree = buildTree()
    const { src, state } = stallingSource(tree.source.files, (k) => k.endsWith('/index.json'))
    const store = new StaticStore(src, { loadDeadlineMs: DEADLINE })
    const gen = (await store.currentGeneration('ferry')) as string
    const t0 = performance.now()
    await expect(store.getIndex(gen, 'ferry')).rejects.toBeInstanceOf(DeadlineError)
    expect(performance.now() - t0).toBeLessThan(DEADLINE + SLACK)
    state.stalled = false
    expect(await store.getIndex(gen, 'ferry')).toBeTruthy()
  })

  it('stationsFor: a stops.json read that never answers rejects within the deadline, then recovers', async () => {
    const tree = buildTree()
    const { src, state } = stallingSource(tree.source.files, (k) => k.endsWith('stops.json'))
    const store = new StaticStore(src, { loadDeadlineMs: DEADLINE })
    const gen = `stall-${Math.random()}` // the stations cache is per module: a key no other test uses
    const t0 = performance.now()
    await expect(stationsFor(store, 'ferry', gen)).rejects.toBeInstanceOf(DeadlineError)
    expect(performance.now() - t0).toBeLessThan(DEADLINE + SLACK)
    state.stalled = false
    await expect(stationsFor(store, 'ferry', gen)).resolves.not.toBeUndefined()
  })
})
