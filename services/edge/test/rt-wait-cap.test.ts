/**
 * The 19 Oct peak stall, part two: departures that waited on a slow hub or R2 for seconds (and, once their caller had
 * gone, for minutes). A request now waits at most RT_WAIT_MS for realtime, stops waiting when its caller aborts, and
 * the whole request is cut off at REQUEST_DEADLINE_MS. The hub's R2 publish no longer writes one document at a time.
 */
import { DeparturesResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import { FetcherDataSource } from '../src/data/source.ts'
import { AbandonedError, within } from '../src/deadline.ts'
import { silentLogger } from '../src/log.ts'
import { ABANDONED_STATUS, isBounded, withRequestDeadline } from '../src/request-deadline.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { CYCLE_MS, HubCore, modeLatestKey, type PullResult, R2_LATEST_KEY } from '../src/rt/hub-core.ts'
import {
  type HubClient,
  parseRtWait,
  RT_WAIT_MS,
  SNAPSHOT_REFRESH_DEADLINE_MS,
  SnapshotClient,
} from '../src/snapshot-client.ts'
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
  vehicle,
} from './fixtures.ts'

const CAP = 40
/** Timer jitter on a busy runner; the stall this guards against lasted minutes. */
const SLACK = 150
/** Refresh deadline and stale wait well above the cap, so only the cap can explain a prompt answer. */
const timing = { refreshDeadlineMs: 2_000, staleWaitMs: 1_500, requestWaitMs: CAP }

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A hub whose pulls answer after `delayMs` (the slow hub/R2 of the peak), counting calls. */
function slowHub(delayMs: () => number, answer: () => PullResult) {
  const hub = {
    pulls: 0,
    pull: async (): Promise<PullResult> => {
      hub.pulls++
      await sleep(delayMs())
      return answer()
    },
    getRaw: async () => null,
  } satisfies HubClient & { pulls: number }
  return hub
}

async function timed<T>(p: Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await p
  return { value, ms: performance.now() - t0 }
}

describe('RT_WAIT_MS', () => {
  it('parses with a default and clamps to 100 ms..the refresh deadline', () => {
    expect(parseRtWait(undefined)).toBe(RT_WAIT_MS)
    expect(parseRtWait('nope')).toBe(RT_WAIT_MS)
    expect(parseRtWait('0')).toBe(RT_WAIT_MS)
    expect(parseRtWait('20')).toBe(100)
    expect(parseRtWait('1500')).toBe(1500)
    expect(parseRtWait('60000')).toBe(SNAPSHOT_REFRESH_DEADLINE_MS)
    expect(RT_WAIT_MS).toBeGreaterThanOrEqual(1_000)
    expect(RT_WAIT_MS).toBeLessThanOrEqual(1_500)
  })

  it('cold, hub slower than the cap: null within the cap, and the late answer still commits', async () => {
    const hub = slowHub(
      () => 200,
      () => ({ seq: 1, json: snap(1), status: status(1) }),
    )
    const c = new SnapshotClient(hub, Date.now, () => {}, null, 'ferry', undefined, timing)
    const { value, ms } = await timed(c.get())
    expect(value).toBeNull()
    expect(ms).toBeLessThan(CAP + SLACK)
    await sleep(250)
    expect(c.hubCalls).toBe(1)
    expect((await c.get())?.seq).toBe(1)
  })

  it('the caller aborting ends its wait at once; the shared refresh carries on and commits', async () => {
    const hub = slowHub(
      () => 200,
      () => ({ seq: 1, json: snap(1), status: status(1) }),
    )
    const c = new SnapshotClient(hub, Date.now, () => {}, null, 'ferry', undefined, {
      ...timing,
      requestWaitMs: 1_500,
    })
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 20)
    const { value, ms } = await timed(c.get(undefined, ctl.signal))
    expect(value).toBeNull()
    expect(ms).toBeLessThan(20 + SLACK)
    await sleep(250)
    expect((await c.get())?.seq).toBe(1)
    expect(hub.pulls).toBe(1)
  })

  it('within(): an already-aborted signal rejects with AbandonedError and leaves the promise alone', async () => {
    let settled = false
    const p = sleep(30).then(() => {
      settled = true
    })
    const ctl = new AbortController()
    ctl.abort()
    await expect(within(p, 1_000, 'x', ctl.signal)).rejects.toBeInstanceOf(AbandonedError)
    await p
    expect(settled).toBe(true)
  })
})

describe('departures with a slow hub (peak stall)', () => {
  const nowMs = epoch(D, '07:55:00') * 1000

  function app(hub: HubClient, clock: Clock) {
    const snapshots = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, timing)
    return createApp({
      store: storeFor(buildTree(), clock.now),
      snapshots,
      snapshotsFor: () => snapshots,
      now: clock.now,
      log: silentLogger,
      combinedFeeds: false,
      polledModes: ['ferry'],
    })
  }

  it('expired copy, slow hub: scheduled rows reported stale within the cap, then live once the hub lands', async () => {
    const clock = new Clock(nowMs)
    const hub = slowHub(
      () => 300,
      () => ({ seq: 1, json: snap(1, Math.floor(clock.t / 1000), clock.t), status: status(1) }),
    )
    const a = app(hub, clock)
    // Warm the static caches first, so the timing below is the realtime wait alone.
    await a.request('/v1/ferry/stops/317584/departures')
    await sleep(350)
    clock.advance(61_000)
    hub.pull = async () => {
      hub.pulls++
      await sleep(300)
      return { seq: 2, json: snap(2, Math.floor(clock.t / 1000), clock.t), status: status(2) }
    }
    const { value: res, ms } = await timed(Promise.resolve(a.request('/v1/ferry/stops/317584/departures')))
    expect(res.status).toBe(200)
    const body = DeparturesResponse.parse(await res.json())
    // An expired copy is never live: stale, scheduled rows.
    expect(body.rtState).toBe('stale')
    expect(body.departures.length).toBeGreaterThan(0)
    expect(body.departures.every((d) => d.status === 'scheduled')).toBe(true)
    expect(ms).toBeLessThan(CAP + SLACK)
    await sleep(350)
    const later = DeparturesResponse.parse(
      await (await a.request('/v1/ferry/stops/317584/departures')).json(),
    )
    expect(later.rtState).toBe('live')
  })

  it('first request of a cold isolate: unavailable within the cap (static reads are fast)', async () => {
    const clock = new Clock(nowMs)
    const hub = slowHub(
      () => 5_000,
      () => ({ seq: 1, json: snap(1), status: status(1) }),
    )
    const a = app(hub, clock)
    const { value: res, ms } = await timed(Promise.resolve(a.request('/v1/ferry/stops/317584/departures')))
    const body = DeparturesResponse.parse(await res.json())
    expect(body.rtState).toBe('unavailable')
    expect(body.departures.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(CAP + SLACK + 200)
  })

  it("an aborted request stops waiting on the hub at once (the request's signal reaches the wait)", async () => {
    const clock = new Clock(nowMs)
    const hub = slowHub(
      () => 5_000,
      () => ({ seq: 1, json: snap(1), status: status(1) }),
    )
    const snapshots = new SnapshotClient(hub, clock.now, () => {}, null, 'ferry', undefined, {
      ...timing,
      requestWaitMs: 2_000,
    })
    const a = createApp({
      store: storeFor(buildTree(), clock.now),
      snapshots,
      snapshotsFor: () => snapshots,
      now: clock.now,
      log: silentLogger,
      combinedFeeds: false,
      polledModes: ['ferry'],
    })
    const ctl = new AbortController()
    const req = new Request('http://x/v1/ferry/stops/317584/departures', { signal: ctl.signal })
    setTimeout(() => ctl.abort(), 30)
    const { ms } = await timed(Promise.resolve(a.request(req)))
    expect(ms).toBeLessThan(30 + SLACK + 200)
  })
})

describe('request deadline', () => {
  const never = () => new Promise<Response>(() => {})

  it('only bounds plain reads', () => {
    expect(isBounded(new Request('http://x/v1/ferry/stops/1/departures'))).toBe(true)
    expect(isBounded(new Request('http://x/v1/ask', { method: 'POST', body: '{}' }))).toBe(false)
    expect(isBounded(new Request('http://x/mcp', { method: 'POST', body: '{}' }))).toBe(false)
    expect(isBounded(new Request('http://x/__spike/rt'))).toBe(false)
    expect(isBounded(new Request('http://x/v1/x', { headers: { upgrade: 'websocket' } }))).toBe(false)
  })

  it('a handler that never answers gets a 503 timeout at the deadline', async () => {
    const cuts: string[] = []
    const { value: res, ms } = await timed(
      withRequestDeadline(new Request('http://x/v1/ferry/stops/1/departures'), never, {
        ms: 40,
        build: 'abc',
        onCut: (o) => cuts.push(o.why),
      }),
    )
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(((await res.json()) as { error: string }).error).toBe('timeout')
    expect(ms).toBeLessThan(40 + SLACK)
    expect(cuts).toEqual(['deadline'])
  })

  it("the caller's abort ends the request at once", async () => {
    const ctl = new AbortController()
    const cuts: string[] = []
    setTimeout(() => ctl.abort(), 20)
    const { value: res, ms } = await timed(
      withRequestDeadline(new Request('http://x/v1/health', { signal: ctl.signal }), never, {
        ms: 5_000,
        onCut: (o) => cuts.push(o.why),
      }),
    )
    expect(res.status).toBe(ABANDONED_STATUS)
    expect(ms).toBeLessThan(20 + SLACK)
    expect(cuts).toEqual(['abandoned'])
  })

  it('a prompt answer passes through untouched; POSTs are not raced', async () => {
    const ok = await withRequestDeadline(new Request('http://x/v1/health'), async () => new Response('hi'), {
      ms: 40,
    })
    expect(await ok.text()).toBe('hi')
    const slowPost = withRequestDeadline(
      new Request('http://x/v1/ask', { method: 'POST', body: '{}' }),
      async () => {
        await sleep(80)
        return new Response('answered')
      },
      { ms: 20 },
    )
    expect(await (await slowPost).text()).toBe('answered')
  })
})

describe('data Worker reads carry a timeout signal', () => {
  it('the subrequest is aborted at its timeout, so it cannot stay open', async () => {
    let seen: AbortSignal | undefined
    const src = new FetcherDataSource(
      {
        fetch: (_input: string, init?: RequestInit) => {
          seen = init?.signal ?? undefined
          return new Promise<Response>((_, reject) =>
            seen?.addEventListener('abort', () => reject(seen?.reason), { once: true }),
          )
        },
      },
      'https://bft-data.internal',
      30,
    )
    await expect(src.get('manifest.json')).rejects.toBeTruthy()
    expect(seen?.aborted).toBe(true)
  })
})

describe('RtHub publish and timings', () => {
  /** An R2 whose PUTs take `delayMs`, recording how many were in flight at once. */
  class SlowR2 {
    readonly files = new Map<string, string>()
    readonly order: string[] = []
    inFlight = 0
    maxInFlight = 0
    constructor(private readonly delayMs: number) {}
    async put(key: string, value: Uint8Array | string) {
      this.inFlight++
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
      await sleep(this.delayMs)
      this.inFlight--
      this.order.push(key)
      this.files.set(key, typeof value === 'string' ? value : new TextDecoder().decode(value))
    }
    async get(key: string) {
      const v = this.files.get(key)
      return v == null ? null : { text: async () => v }
    }
  }

  function hub(r2: SlowR2, profile = false) {
    const clock = new Clock(epoch(D, '07:55:00') * 1000)
    const up = new FakeUpstream()
    const nowS = () => Math.floor(clock.t / 1000)
    for (const m of ['Ferry', 'Rail']) {
      up.set(
        `TripUpdates/${m}`,
        feed(nowS(), [
          tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [
            { seq: 1, stopId: '317584', depTime: epoch(D, '08:02:00') },
          ]),
        ]),
      )
      up.set(`VehiclePositions/${m}`, feed(nowS(), [vehicle('V1', 'T1', D, -27.45, 153.05)]))
    }
    up.set('alerts', feed(nowS(), []))
    const lines: Array<{ msg: string; fields?: Record<string, unknown> }> = []
    const log = {
      info: (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, fields }),
      warn: (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, fields }),
      error: (msg: string, fields?: Record<string, unknown>) => lines.push({ msg, fields }),
      child: () => log,
    }
    const core = new HubCore({
      storage: new FakeStorage(),
      fetch: up.fetch,
      now: Date.now,
      store: storeFor(buildTree(), clock.now),
      config: parseRtModes('ferry,train'),
      upstream: 'https://up.test/api/realtime/SEQ',
      fetchTimeoutMs: 50,
      r2,
      profile,
      log,
    })
    return { core, clock, lines }
  }

  it('writes the mode and alerts documents in parallel, and the pointer only after them', async () => {
    const r2 = new SlowR2(30)
    const { core } = hub(r2)
    await core.cycle()
    const docs = [modeLatestKey('ferry'), modeLatestKey('train')]
    expect(r2.maxInFlight).toBeGreaterThanOrEqual(docs.length)
    expect(r2.order.at(-1)).toBe(R2_LATEST_KEY)
    for (const k of docs) expect(r2.order.indexOf(k)).toBeLessThan(r2.order.indexOf(R2_LATEST_KEY))
    expect(core.lastTimings?.r2Puts).toBe(r2.order.length)
    // Two documents and an alerts document in parallel, then the pointer: about two PUT times, not four.
    expect(core.lastTimings?.publish).toBeLessThan(30 * 4)
  })

  it('records per-phase timings each poll and logs them with RT_PROFILE', async () => {
    const r2 = new SlowR2(5)
    const { core, clock, lines } = hub(r2, true)
    await core.cycle()
    clock.advance(CYCLE_MS)
    const t = core.lastTimings
    expect(t).not.toBeNull()
    for (const k of [
      'restore',
      'indexes',
      'fetch',
      'decode',
      'build',
      'persist',
      'publish',
      'total',
    ] as const)
      expect(t?.[k]).toBeGreaterThanOrEqual(0)
    expect(t?.feeds).toBeGreaterThan(0)
    expect(t?.rebuilt).toBe(true)
    expect(t?.r2Chars).toBeGreaterThan(0)
    const line = lines.find((l) => l.msg === 'rt cycle timings')
    expect(line?.fields?.publish).toBe(t?.publish)
  })

  it('without RT_PROFILE a fast poll logs no timings', async () => {
    const r2 = new SlowR2(1)
    const { core, lines } = hub(r2, false)
    await core.cycle()
    expect(core.lastTimings).not.toBeNull()
    expect(lines.some((l) => l.msg === 'rt cycle timings')).toBe(false)
  })
})
