/**
 * Cold static reads must not fail requests (20 Oct): a prod shard read's DeadlineError reached onError as a 500, and
 * a staging fresh isolate's failed manifest read answered 503 "no static data for mode" with its cause thrown away.
 * A request's static reads now get one immediate retry inside its budget, then a deliberate retryable 503 (or a
 * degraded answer); reads without a budget (the hub, health, ai, scripts) behave exactly as before.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { type GenerationIndex, type Mode, shardOf } from '@bft/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stopDay } from '../../../packages/core/test/helpers.ts'
import { createApp } from '../src/app.ts'
import type { MemoryDataSource } from '../src/data/source.ts'
import {
  blobKey,
  indexKey,
  MIN_RETRY_MS,
  readBudget,
  StaticReadError,
  StaticStore,
  shardKey,
} from '../src/data/static-store.ts'
import { DeadlineError } from '../src/deadline.ts'
import { createLogger } from '../src/log.ts'
import type { SnapshotClient } from '../src/snapshot-client.ts'
import { buildTree, Clock, D, D0, epoch, TRIPS, type Tree } from './fixtures.ts'

const DEADLINE = 80
/**
 * Where a read must answer inside its deadline (a retry that succeeds, or reads that are fine), a deadline a loaded
 * CI runner can't miss (CI 20 Oct: a healthy retry read overran 80 ms).
 */
const OK_DEADLINE = 300
/** Generous slack for timer jitter on a busy CI runner. */
const SLACK = 150
/** How early a timer may fire against performance.now(), for a lower bound on a wait. */
const EARLY = 25

const never = <T>() => new Promise<T>(() => {})

type Behaviour = 'never' | 'reject' | 'ok'

/**
 * A MemoryDataSource whose reads follow `script(key, n)` (n = how many times `key` was read before): hang, reject,
 * or answer normally. Every read is counted in `reads`.
 */
function scripted(src: MemoryDataSource, script: (key: string, n: number) => Behaviour) {
  const get = src.get.bind(src)
  const seen = new Map<string, number>()
  src.get = (key) => {
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    const b = script(key, n)
    if (b === 'ok') return get(key)
    src.reads.push(key)
    return b === 'never' ? never() : Promise.reject(new Error(`R2 internal error reading ${key}`))
  }
  const count = (key: string) => seen.get(key) ?? 0
  return { src, count }
}

async function timed<T>(p: Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await p
  return { value, ms: performance.now() - t0 }
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

/** A bus tree whose stop-days live in shards (the assets backend layout), like prod's bus. */
function busShardTree(): { tree: Tree; index: GenerationIndex } {
  const tree = buildTree('g1', TRIPS, 'bus')
  const files = tree.source.files
  const key = indexKey('g1', 'bus')
  const index = JSON.parse(new TextDecoder().decode(files.get(key))) as GenerationIndex
  const count = 4
  const byDate: Record<string, (string | null)[]> = {}
  for (const date of index.serviceDates) {
    const groups: Record<string, unknown>[] = Array.from({ length: count }, () => ({}))
    for (const stopKey of Object.keys(index.blobs[date] ?? {}))
      (groups[shardOf(stopKey, count)] as Record<string, unknown>)[stopKey] = stopDay(
        date,
        stopKey,
        TRIPS[date] ?? [],
      )
    byDate[date] = groups.map((g) => {
      if (Object.keys(g).length === 0) return null
      const bytes = new Uint8Array(gzipSync(JSON.stringify(g)))
      const h = sha(bytes)
      files.set(shardKey(h), bytes)
      return h
    })
    index.blobs[date] = {}
  }
  index.shards = { count, hash: 'fnv1a32', byDate }
  files.set(key, new TextEncoder().encode(JSON.stringify(index)))
  return { tree, index }
}

const shardFile = (index: GenerationIndex, date: string, stopKey: string) =>
  shardKey(index.shards?.byDate[date]?.[shardOf(stopKey, index.shards.count)] as string)

/** The per-stop blob key of a ferry tree's stop on a date. */
function blobFile(tree: Tree, date: string, stopKey: string, mode: Mode = 'ferry'): string {
  const index = JSON.parse(
    new TextDecoder().decode(tree.source.files.get(indexKey(tree.generation, mode))),
  ) as GenerationIndex
  return blobKey(index.blobs[date]?.[stopKey] as string)
}

/** A snapshot client stub whose snapshot names `generation` for `mode` (or none at all). */
function snapshots(generation: string | null, mode: Mode = 'ferry'): SnapshotClient {
  const snapshot = generation
    ? {
        header: {
          schemaVersion: 1,
          seq: 1,
          staticGeneration: { [mode]: generation },
          serviceDates: [D],
          sourceTimestamp: 1,
          fetchedAt: 1,
        },
        trips: {},
        vehicles: [],
        alerts: [],
      }
    : null
  return {
    get: async () => (snapshot ? { snapshot, vehiclesByTrip: new Map() } : null),
    status: null,
    expired: false,
    raw: async () => null,
  } as unknown as SnapshotClient
}

function appFor(
  src: MemoryDataSource,
  opts: { mode?: Mode; generation?: string | null; nowMs?: number; passthroughDeadlineMs?: number } = {},
) {
  const clock = new Clock(opts.nowMs ?? epoch(D, '07:55:00') * 1000)
  const lines: Array<Record<string, unknown>> = []
  const store = new StaticStore(src, {
    validate: true,
    manifestMaxAgeMs: 0,
    now: clock.now,
    loadDeadlineMs: OK_DEADLINE,
  })
  const snaps = snapshots(opts.generation ?? null, opts.mode)
  const app = createApp({
    store,
    snapshots: snaps,
    snapshotsFor: () => snaps,
    now: clock.now,
    log: createLogger({}, (l) => lines.push(JSON.parse(l))),
    combinedFeeds: false,
    polledModes: ['ferry'],
    ...(opts.passthroughDeadlineMs ? { passthroughDeadlineMs: opts.passthroughDeadlineMs } : {}),
  })
  const line = (msg: string) => lines.find((l) => l.msg === msg)
  return { app, lines, line, store }
}

async function expectUnavailable(res: Response, detail: string) {
  expect(res.status).toBe(503)
  expect(res.headers.get('retry-after')).toBe('2')
  expect(res.headers.get('cache-control')).toBe('no-store')
  expect(await res.json()).toEqual({ error: 'static data unavailable', detail, retryable: true })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('StaticStore reads with a request budget', () => {
  const later = () => readBudget(5_000, Date.now())

  it('a shard read that times out is retried at once and succeeds', async () => {
    const { tree, index } = busShardTree()
    const key = shardFile(index, D, '317584')
    const { src, count } = scripted(tree.source, (k, n) => (k === key && n === 0 ? 'never' : 'ok'))
    const store = new StaticStore(src, { loadDeadlineMs: OK_DEADLINE })
    const { value, ms } = await timed(store.stopDay(index, D, '317584', later()))
    expect(value?.events.length).toBeGreaterThan(0)
    expect(count(key)).toBe(2)
    expect(ms).toBeLessThan(2 * OK_DEADLINE + SLACK)
  })

  it('a shard read that never answers: one retry, then a StaticReadError within two deadlines', async () => {
    const { tree, index } = busShardTree()
    const key = shardFile(index, D, '317584')
    const { src, count } = scripted(tree.source, (k) => (k === key ? 'never' : 'ok'))
    const store = new StaticStore(src, { loadDeadlineMs: DEADLINE })
    const t0 = performance.now()
    const err = await store.stopDay(index, D, '317584', later()).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StaticReadError)
    expect(err).toMatchObject({ what: 'shard', why: 'deadline' })
    expect(count(key)).toBe(2)
    expect(performance.now() - t0).toBeLessThan(2 * DEADLINE + SLACK)
  })

  it('a rejecting index read is retried at once; two failures are a StaticReadError (error)', async () => {
    const tree = buildTree()
    const key = indexKey('g1', 'ferry')
    const once = scripted(tree.source, (k, n) => (k === key && n === 0 ? 'reject' : 'ok'))
    expect(await new StaticStore(once.src).getIndex('g1', 'ferry', later())).toBeTruthy()
    expect(once.count(key)).toBe(2)
    const always = scripted(buildTree().source, (k) => (k === key ? 'reject' : 'ok'))
    const err = await new StaticStore(always.src).getIndex('g1', 'ferry', later()).catch((e: unknown) => e)
    expect(err).toMatchObject({ name: 'StaticReadError', what: 'index', why: 'error' })
    expect(always.count(key)).toBe(2)
  })

  it('no retry when the budget has less than MIN_RETRY_MS left', async () => {
    const tree = buildTree()
    const key = indexKey('g1', 'ferry')
    const { src, count } = scripted(tree.source, (k) => (k === key ? 'reject' : 'ok'))
    const err = await new StaticStore(src)
      .getIndex('g1', 'ferry', readBudget(MIN_RETRY_MS - 100, Date.now()))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StaticReadError)
    expect(count(key)).toBe(1)
  })

  it("a shared read that hangs holds no request past its budget, and a short budget doesn't drop it for others", async () => {
    const { tree, index } = busShardTree()
    const key = shardFile(index, D, '317584')
    const { src, count } = scripted(tree.source, (k, n) => (k === key && n === 0 ? 'never' : 'ok'))
    const store = new StaticStore(src, { loadDeadlineMs: 1_000 })
    // Request A starts the read and has plenty of budget; request B joins it with only 300 ms left.
    const a = timed(store.stopDay(index, D, '317584', readBudget(5_000, Date.now())))
    const b = await timed(
      store.stopDay(index, D, '317584', readBudget(300, Date.now())).catch((e: unknown) => e),
    )
    expect(b.value).toMatchObject({ name: 'StaticReadError', what: 'shard', why: 'deadline' })
    expect(b.ms).toBeLessThan(300 + SLACK)
    expect(count(key)).toBe(1) // B left the shared read alone (and didn't retry without budget)
    // A waits out the read's own deadline, then retries once and gets the answer.
    const { value, ms } = await a
    expect(value?.events.length).toBeGreaterThan(0)
    expect(count(key)).toBe(2)
    expect(ms).toBeLessThan(1_000 + SLACK)
  })

  describe('a frozen clock (workerd moves Date.now only with I/O; Codex r1)', () => {
    it('a retry still ends at the budget: own deadline equal to the budget takes one budget, not two', async () => {
      const { tree, index } = busShardTree()
      const key = shardFile(index, D, '317584')
      const { src, count } = scripted(tree.source, (k) => (k === key ? 'never' : 'ok'))
      const store = new StaticStore(src, { now: () => 0, loadDeadlineMs: 200 })
      const { value: err, ms } = await timed(
        store.stopDay(index, D, '317584', readBudget(200, 0)).catch((e: unknown) => e),
      )
      expect(err).toMatchObject({ name: 'StaticReadError', what: 'shard', why: 'deadline' })
      expect(ms).toBeLessThan(200 + SLACK)
      expect(count(key)).toBeLessThanOrEqual(2)
    })

    it('a retry that would overrun a frozen budget is cut at the budget', async () => {
      const { tree, index } = busShardTree()
      const key = shardFile(index, D, '317584')
      const { src, count } = scripted(tree.source, (k) => (k === key ? 'never' : 'ok'))
      // 400 ms reads in a 600 ms budget: the clock says 600 ms are always left, so it retries; the timer ends it.
      const store = new StaticStore(src, { now: () => 0, loadDeadlineMs: 400 })
      // Timed from before the budget is made, since its timer starts there and stopDay's synchronous start runs before
      // timed() would begin; a timer can also fire a little early (CI 22 Oct: 588 ms against a 590 ms floor). Past the
      // one 400 ms read (no retry), short of two (the budget ignored).
      const t0 = performance.now()
      const budget = readBudget(600, 0)
      const err = await store.stopDay(index, D, '317584', budget).catch((e: unknown) => e)
      const ms = performance.now() - t0
      expect(err).toMatchObject({ name: 'StaticReadError', why: 'deadline' })
      expect(count(key)).toBe(2)
      expect(ms).toBeGreaterThanOrEqual(600 - EARLY)
      expect(ms).toBeLessThan(600 + SLACK)
    })

    it('a budget already spent starts no wait', async () => {
      const { tree, index } = busShardTree()
      const key = shardFile(index, D, '317584')
      const { src } = scripted(tree.source, (k) => (k === key ? 'never' : 'ok'))
      const store = new StaticStore(src, { now: () => 0, loadDeadlineMs: 1_000 })
      const spent = readBudget(0, 0)
      await new Promise((r) => setTimeout(r, 5))
      const { value: err, ms } = await timed(
        store.stopDay(index, D, '317584', spent).catch((e: unknown) => e),
      )
      expect(err).toBeInstanceOf(StaticReadError)
      expect(ms).toBeLessThan(SLACK)
    })
  })

  it('cold manifest: a rejected read is retried; two failures are a StaticReadError, logged once a minute', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const once = scripted(buildTree().source, (k, n) => (k === 'manifest.json' && n === 0 ? 'reject' : 'ok'))
    expect(await new StaticStore(once.src).currentGeneration('ferry', undefined, later())).toBe('g1')
    expect(once.count('manifest.json')).toBe(2)

    err.mockClear()
    const always = scripted(buildTree().source, (k) => (k === 'manifest.json' ? 'reject' : 'ok'))
    const store = new StaticStore(always.src)
    for (let i = 0; i < 2; i++) {
      const e = await store.currentGeneration('ferry', undefined, later()).catch((x: unknown) => x)
      expect(e).toMatchObject({ name: 'StaticReadError', what: 'manifest', why: 'error' })
    }
    expect(always.count('manifest.json')).toBe(4)
    const logged = err.mock.calls.map((c) => JSON.parse(c[0] as string))
    expect(logged).toEqual([
      expect.objectContaining({
        msg: 'static manifest read failed',
        name: 'Error',
        error: 'R2 internal error reading manifest.json',
        haveLastGood: false,
      }),
    ])
  })

  it('a stale manifest with waitUntil is served at once, and a failed background refresh keeps it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let t = 0
    const { src } = scripted(buildTree().source, (k, n) => (k === 'manifest.json' && n > 0 ? 'reject' : 'ok'))
    const store = new StaticStore(src, { now: () => t })
    expect(await store.currentGeneration('ferry', undefined, later())).toBe('g1')
    t = 61_000
    const bg: Promise<unknown>[] = []
    expect(await store.currentGeneration('ferry', (p) => bg.push(p), later())).toBe('g1')
    await Promise.all(bg)
    expect(await store.currentGeneration('ferry', undefined, later())).toBe('g1') // last good, after its retry
  })
})

describe('StaticStore reads without a budget (hub, health, ai, scripts): unchanged', () => {
  it('a rejecting index read rejects with its own error, read once, no retry', async () => {
    const key = indexKey('g1', 'ferry')
    const { src, count } = scripted(buildTree().source, (k) => (k === key ? 'reject' : 'ok'))
    const err = await new StaticStore(src).getIndex('g1', 'ferry').catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(StaticReadError)
    expect((err as Error).message).toBe(`R2 internal error reading ${key}`)
    expect(count(key)).toBe(1)
  })

  it('a hung shard read rejects with a DeadlineError at its deadline, read once', async () => {
    const { tree, index } = busShardTree()
    const key = shardFile(index, D, '317584')
    const { src, count } = scripted(tree.source, (k) => (k === key ? 'never' : 'ok'))
    const store = new StaticStore(src, { loadDeadlineMs: DEADLINE })
    const { value: err, ms } = await timed(store.stopDay(index, D, '317584').catch((e: unknown) => e))
    expect(err).toBeInstanceOf(DeadlineError)
    expect(err).not.toBeInstanceOf(StaticReadError)
    expect((err as Error).message).toBe(`${key}: no answer in ${DEADLINE} ms`) // the hub's error text, as before
    expect(count(key)).toBe(1)
    expect(ms).toBeLessThan(DEADLINE + SLACK)
  })

  it('a cold manifest read that fails gives null (as before), read once; a later one recovers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { src, count } = scripted(buildTree().source, (k, n) =>
      k === 'manifest.json' && n === 0 ? 'reject' : 'ok',
    )
    let t = 0
    const store = new StaticStore(src, { now: () => t })
    expect(await store.getManifest()).toBeNull()
    expect(count('manifest.json')).toBe(1)
    t += 1
    expect(await store.currentGeneration('ferry')).toBe('g1')
  })

  it('a stale manifest whose refresh fails falls back to the last good one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let t = 0
    const { src, count } = scripted(buildTree().source, (k, n) =>
      k === 'manifest.json' && n > 0 ? 'reject' : 'ok',
    )
    const store = new StaticStore(src, { now: () => t })
    expect(await store.currentGeneration('ferry')).toBe('g1')
    t = 61_000
    expect(await store.currentGeneration('ferry')).toBe('g1')
    expect(count('manifest.json')).toBe(2)
  })
})

describe('departures, trips, vehicles and passthroughs on failing static reads', () => {
  it('a bus shard read that times out twice: 503 static data unavailable (retryable), never 500, and logged', async () => {
    const { tree, index } = busShardTree()
    const key = shardFile(index, D, '317584')
    const { src, count } = scripted(tree.source, (k) => (k === key ? 'never' : 'ok'))
    const s = appFor(src, { mode: 'bus' })
    const res = await s.app.request('/v1/bus/stops/317584/departures')
    await expectUnavailable(res, 'shard deadline')
    expect(count(key)).toBe(2)
    expect(s.line('request')).toMatchObject({
      status: 503,
      error: 'static data unavailable',
      detail: 'shard deadline',
      retryable: true,
    })
    expect(s.line('static read failed')).toMatchObject({ what: 'shard', why: 'deadline' })
    expect(s.line('unhandled')).toBeUndefined()
  })

  it('a bus shard read that times out once: retried, 200', async () => {
    const { tree, index } = busShardTree()
    const key = shardFile(index, D, '317584')
    const { src } = scripted(tree.source, (k, n) => (k === key && n === 0 ? 'never' : 'ok'))
    const res = await appFor(src, { mode: 'bus' }).app.request('/v1/bus/stops/317584/departures')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { departures: unknown[] }).departures.length).toBeGreaterThan(0)
  })

  it('an index read that fails twice: 503 static data unavailable, not 500', async () => {
    const key = indexKey('g1', 'ferry')
    const { src } = scripted(buildTree().source, (k) => (k === key ? 'reject' : 'ok'))
    for (const path of ['/v1/ferry/stops/317584/departures', `/v1/ferry/trips/T1@${D}`]) {
      await expectUnavailable(await appFor(src).app.request(path), 'index error')
    }
  })

  describe('a fresh isolate whose manifest read fails twice', () => {
    const failing = () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      return scripted(buildTree().source, (k) => (k === 'manifest.json' ? 'reject' : 'ok'))
    }

    it('degrades to the RT snapshot generation once its index loads, and says so in the log', async () => {
      const { src, count } = failing()
      const s = appFor(src, { generation: 'g1' })
      const res = await s.app.request('/v1/ferry/stops/317584/departures')
      expect(res.status).toBe(200)
      const body = (await res.json()) as { staticGeneration: string; departures: unknown[] }
      expect(body.staticGeneration).toBe('g1')
      expect(body.departures.length).toBeGreaterThan(0)
      expect(count('manifest.json')).toBe(2)
      expect(s.line('static generation from the rt snapshot')).toMatchObject({
        mode: 'ferry',
        generation: 'g1',
        lastManifestGeneration: null,
        differs: false,
      })
      expect(s.line('request')).toMatchObject({ status: 200, degraded: ['generation-from-rt'] })
    })

    it('without an RT generation (bus, or no snapshot): 503 static data unavailable with the error field', async () => {
      const { src } = failing()
      for (const path of ['/v1/ferry/stops/317584/departures', `/v1/ferry/trips/T1@${D}`]) {
        const s = appFor(src, { generation: null })
        await expectUnavailable(await s.app.request(path), 'manifest error')
        expect(s.line('request')).toMatchObject({ status: 503, error: 'static data unavailable' })
      }
    })

    it("an RT generation whose index doesn't load is not used", async () => {
      const { src } = failing()
      const res = await appFor(src, { generation: 'g-gone' }).app.request('/v1/ferry/stops/317584/departures')
      await expectUnavailable(res, 'manifest error')
    })

    it('a spent budget answers the 503 without waiting on the snapshot fallback (Codex r1)', async () => {
      const { src } = failing()
      const store = new StaticStore(src, { validate: true, manifestMaxAgeMs: 0, loadDeadlineMs: DEADLINE })
      // A snapshot client that, like the real one, waits until its signal aborts and then has nothing.
      const slow = {
        get: (_wu: unknown, signal?: AbortSignal) =>
          new Promise((resolve) => signal?.addEventListener('abort', () => resolve(null), { once: true })),
        status: null,
        expired: false,
        raw: async () => null,
      } as unknown as SnapshotClient
      const app = createApp({
        store,
        snapshots: slow,
        snapshotsFor: () => slow,
        log: createLogger({}, () => {}),
        combinedFeeds: false,
        polledModes: ['ferry'],
        staticReadBudgetMs: 3 * DEADLINE,
      })
      const { value: res, ms } = await timed(
        Promise.resolve(app.request('/v1/ferry/stops/317584/departures')),
      )
      await expectUnavailable(res, 'manifest error')
      expect(ms).toBeLessThan(3 * DEADLINE + SLACK)
    })

    it('vehicles degrade to none rather than fail', async () => {
      const { src } = failing()
      const res = await appFor(src, { generation: null }).app.request('/v1/ferry/vehicles')
      expect(res.status).toBe(200)
      expect(((await res.json()) as { vehicles: unknown[] }).vehicles).toEqual([])
    })
  })

  it("a failed next-day top-up serves today's rows, and the log line says it was skipped", async () => {
    const tree = buildTree()
    const next = blobFile(tree, D, '317584')
    const { src, count } = scripted(tree.source, (k) => (k === next ? 'never' : 'ok'))
    // 23:00 on D0: only the cross-midnight LATE trip is left, so the board tops up from D.
    const s = appFor(src, { nowMs: epoch(D0, '23:00:00') * 1000 })
    const res = await s.app.request('/v1/ferry/stops/317584/departures')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { serviceDates: string[]; departures: Array<{ tripInstance: string }> }
    expect(body.departures.map((d) => d.tripInstance)).toEqual([`LATE@${D0}`])
    expect(body.serviceDates).not.toContain(D)
    expect(count(next)).toBe(2)
    expect(s.line('next-day top-up skipped')).toMatchObject({ what: 'stop-day', why: 'deadline' })
    expect(s.line('request')).toMatchObject({ status: 200, degraded: ['next-day-skipped'] })
  })

  it('trip detail: a stop-index read that hangs ends with the budget, and the trip answers unnamed (Codex r2)', async () => {
    for (const mode of ['ferry', 'train'] as const) {
      // The stations cache is per module: a generation no other test uses.
      const tree = buildTree(`trip-names-${Math.random()}`, TRIPS, mode)
      const { src } = scripted(tree.source, (k) => (k === `data/${mode}/stops.json` ? 'never' : 'ok'))
      const TRIP_BUDGET = 1_000 // healthy reads must fit (CI); the hung stops.json waits out the rest
      // A stop-index deadline far past the budget: only the budget can end the wait.
      const now = () => epoch(D, '07:55:00') * 1000
      const store = new StaticStore(src, { validate: true, manifestMaxAgeMs: 0, loadDeadlineMs: 5_000, now })
      const snaps = snapshots(null, mode)
      const app = createApp({
        store,
        snapshots: snaps,
        snapshotsFor: () => snaps,
        log: createLogger({}, () => {}),
        combinedFeeds: false,
        polledModes: [mode],
        staticReadBudgetMs: TRIP_BUDGET,
        now,
      })
      const { value: res, ms } = await timed(Promise.resolve(app.request(`/v1/${mode}/trips/T1@${D}`)))
      expect(res.status).toBe(200)
      const body = (await res.json()) as { stops: Array<{ name?: string }> }
      expect(body.stops.length).toBeGreaterThan(0)
      expect(body.stops.every((s) => s.name === undefined)).toBe(true)
      expect(ms).toBeLessThan(TRIP_BUDGET + SLACK)
    }
  })

  it('a trip whose generation index is missing is 503 static index missing, not 404 unknown trip', async () => {
    const tree = buildTree()
    tree.source.files.delete(indexKey('g1', 'ferry'))
    const s = appFor(tree.source)
    const res = await s.app.request(`/v1/ferry/trips/T1@${D}`)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'static index missing', detail: 'g1' })
  })

  it('/data and /schedule-data: a read that fails or never starts is a retryable 503 within the deadline', async () => {
    for (const b of ['reject', 'never'] as const) {
      const { src } = scripted(buildTree().source, (k) =>
        k === 'data/ferry/stops.json' || k === 'legacy/latest.json' ? b : 'ok',
      )
      const s = appFor(src, { passthroughDeadlineMs: DEADLINE })
      for (const path of ['/data/ferry/stops.json', '/schedule-data/latest.json']) {
        const { value: res, ms } = await timed(Promise.resolve(s.app.request(path)))
        await expectUnavailable(res, 'passthrough')
        expect(ms).toBeLessThan(DEADLINE + SLACK)
      }
    }
  })

  it('/data still streams a healthy object, and a missing geo tile is still an empty tile', async () => {
    const s = appFor(buildTree().source)
    const res = await s.app.request('/data/ferry/stops.json')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { stops: unknown[] }).stops.length).toBeGreaterThan(0)
    const tile = await s.app.request('/data/ferry/geo/r7hgd.json')
    expect(tile.status).toBe(200)
  })
})
