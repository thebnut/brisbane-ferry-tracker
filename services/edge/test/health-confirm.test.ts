/**
 * THE-111: /v1/health judged the isolate's cached hub status, up to a minute older than the R2 pointer, so a healthy
 * hub read as `source-age 121s`; and a new isolate gave up after RT_WAIT_MS with `source-age none,build-age none`.
 * Health now confirms a would-be 503 with one forced refresh, and waits up to the refresh deadline when it has nothing.
 */
import { HealthResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import type { StaticStore } from '../src/data/static-store.ts'
import { createLogger } from '../src/log.ts'
import type { HubStatus, PullResult } from '../src/rt/hub-core.ts'
import {
  type HubClient,
  RT_WAIT_MS,
  SNAPSHOT_REFRESH_DEADLINE_MS,
  SnapshotClient,
  STATUS_CONFIRM_MIN_MS,
} from '../src/snapshot-client.ts'

const NOW = 1_792_482_916_000

/** A hub status `sourceAgeS` and `buildAgeS` old at `at` (ms). */
const status = (at: number, sourceAgeS: number, buildAgeS: number): HubStatus => ({
  seq: 11181,
  sourceTimestamp: Math.floor((at - sourceAgeS * 1000) / 1000),
  fetchedAt: at - buildAgeS * 1000,
  lastCycleAt: at - buildAgeS * 1000,
  lastError: null,
  stats: null,
  generations: {},
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SNAP = JSON.stringify({
  header: {
    schemaVersion: 1,
    seq: 1,
    staticGeneration: {},
    serviceDates: [],
    sourceTimestamp: 1,
    fetchedAt: 1,
  },
  trips: {},
  vehicles: [],
  alerts: [],
})

/** A hub whose pulls answer snapshot seq 1 and `answer()` after `delayMs`, or never when delayMs is null. */
function hub(answer: () => HubStatus, delayMs: () => number | null = () => 0) {
  const h = {
    pulls: 0,
    pull: async (since: number | null): Promise<PullResult> => {
      h.pulls++
      const d = delayMs()
      if (d == null) return new Promise(() => {})
      if (d > 0) await sleep(d)
      return { seq: 1, json: since === 1 ? null : SNAP, status: answer() }
    },
    getRaw: async () => null,
  } satisfies HubClient & { pulls: number }
  return h
}

function setup(client: SnapshotClient, now: () => number) {
  const lines: Array<Record<string, unknown>> = []
  const log = createLogger({}, (l) => lines.push(JSON.parse(l)))
  const store = {
    getManifest: async () => ({ updatedAt: 'x', modes: { ferry: { current: 'g1' } } }),
  } as unknown as StaticStore
  const a = createApp({ store, snapshots: client, log, now, combinedFeeds: false, polledModes: ['ferry'] })
  const health = async () => {
    const res = await a.request('/v1/health')
    return { status: res.status, body: HealthResponse.parse(await res.json()) }
  }
  const line = (msg: string) => lines.find((l) => l.msg === msg)
  return { health, line, lines }
}

/**
 * A warm isolate on a manual clock: its copy was loaded at NOW (from a hub answering `first`), then the clock moves to
 * NOW + `laterS`. A wide maxStale keeps that copy served (the quiet-isolate case). The hub then answers `then`.
 */
async function warm(first: HubStatus, laterS: number, then: (at: number) => HubStatus) {
  let t = NOW
  let answer: () => HubStatus = () => first
  let delay = 0
  // After the load, pulls take 20 ms (an R2 read takes ~1 s), so get()'s background refresh hasn't landed when
  // health judges the copy.
  const h = hub(
    () => answer(),
    () => delay,
  )
  const client = new SnapshotClient(
    h,
    () => t,
    () => {},
    null,
    'alerts',
    600_000,
  )
  await client.get()
  t = NOW + laterS * 1000
  answer = () => then(t)
  delay = 20
  return { h, client, ...setup(client, () => t) }
}

describe('health confirms before failing (THE-111)', () => {
  it('a healthy cached status answers 200 with no refresh', async () => {
    const w = await warm(status(NOW, 20, 5), 5, (at) => status(at, 20, 5))
    const pulls = w.h.pulls
    const r = await w.health()
    expect(r.status).toBe(200)
    expect(w.h.pulls).toBe(pulls)
    expect(w.line('health refreshed')).toBeUndefined()
  })

  it('a cached status over 120 s whose fresh read is ok answers 200, and logs health refreshed', async () => {
    // Cached: TransLink 20 s behind at load, 105 s ago: 125 s now. The pointer is fresh: 20 s.
    const w = await warm(status(NOW, 20, 5), 105, (at) => status(at, 20, 5))
    const r = await w.health()
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, reasons: [], rt: { ageS: 20, buildAgeS: 5 } })
    expect(w.line('health refreshed')).toMatchObject({
      level: 'info',
      cachedAgeS: 125,
      cachedBuildAgeS: 110,
      ageS: 20,
      buildAgeS: 5,
    })
    expect(w.line('request')).not.toHaveProperty('detail')
  })

  it('a really stale source still fails, on the fresh read, with the pre-refresh ages and confirmed', async () => {
    const w = await warm(status(NOW, 20, 5), 105, (at) => status(at, 279, 14))
    const r = await w.health()
    expect(r).toMatchObject({ status: 503, body: { ok: false, reasons: ['source-age'] } })
    expect(w.line('request')).toMatchObject({
      status: 503,
      error: 'health not ok',
      detail: 'source-age 279s',
      cachedAgeS: 125,
      cachedBuildAgeS: 110,
      confirmed: true,
    })
    expect(w.line('health refreshed')).toBeUndefined()
  })

  it('a second stale check within STATUS_CONFIRM_MIN_MS reads nothing and logs confirmed: false', async () => {
    const w = await warm(status(NOW, 20, 5), 105, (at) => status(at, 279, 14))
    expect((await w.health()).status).toBe(503)
    const pulls = w.h.pulls
    w.lines.length = 0
    const r = await w.health()
    expect(r).toMatchObject({ status: 503, body: { reasons: ['source-age'] } })
    expect(w.h.pulls).toBe(pulls)
    expect(w.line('request')).toMatchObject({ detail: 'source-age 279s', cachedAgeS: 279, confirmed: false })
  })

  it('the forced refresh skips the attempt throttle but runs at most once per STATUS_CONFIRM_MIN_MS', async () => {
    let t = NOW
    const h = hub(() => status(t, 279, 14))
    const client = new SnapshotClient(
      h,
      () => t,
      () => {},
      null,
      'alerts',
      600_000,
    )
    await client.get()
    expect(h.pulls).toBe(1)
    // Inside the 10 s attempt throttle, get() asks nothing; refreshStatus still reads the hub, once.
    t += 2_000
    await client.get()
    expect(h.pulls).toBe(1)
    expect((await client.refreshStatus()).refreshed).toBe(true)
    expect(h.pulls).toBe(2)
    t += STATUS_CONFIRM_MIN_MS - 1
    expect((await client.refreshStatus()).refreshed).toBe(false)
    expect(h.pulls).toBe(2)
    t += 1
    expect((await client.refreshStatus()).refreshed).toBe(true)
    expect(h.pulls).toBe(3)
  })

  it('the forced refresh reads the hub, not the Cache API', async () => {
    let t = NOW
    const h = hub(() => status(t, 20, 5))
    let matches = 0
    const cache = {
      match: async () => {
        matches++
        return undefined
      },
      put: async () => {},
    }
    const client = new SnapshotClient(
      h,
      () => t,
      () => {},
      cache,
      'alerts',
      600_000,
    )
    await client.get()
    expect(matches).toBe(1)
    t += 2_000
    await client.refreshStatus()
    expect(matches).toBe(1)
    expect(h.pulls).toBe(2)
  })
})

describe('health on a new isolate (THE-111)', () => {
  // Real timers: the app and client share Date.now.
  it('waits past RT_WAIT_MS for a slow first refresh, up to the refresh deadline', async () => {
    const delay = RT_WAIT_MS + 400
    expect(delay).toBeLessThan(SNAPSHOT_REFRESH_DEADLINE_MS)
    const h = hub(
      () => status(Date.now(), 20, 5),
      () => delay,
    )
    const s = setup(new SnapshotClient(h, Date.now, () => {}, null, 'alerts'), Date.now)
    const r = await s.health()
    expect(r).toMatchObject({ status: 200, body: { ok: true, reasons: [] } })
    expect(h.pulls).toBe(1)
  })

  it('with still no status at the deadline answers 503 unavailable, saying how long it waited', async () => {
    const h = hub(
      () => status(Date.now(), 20, 5),
      () => null,
    )
    const s = setup(new SnapshotClient(h, Date.now, () => {}, null, 'alerts'), Date.now)
    const t0 = Date.now()
    const r = await s.health()
    const ms = Date.now() - t0
    expect(r).toMatchObject({ status: 503, body: { ok: false, reasons: ['unavailable'] } })
    expect(r.body.rt).toMatchObject({ ageS: null, buildAgeS: null })
    expect(ms).toBeGreaterThanOrEqual(SNAPSHOT_REFRESH_DEADLINE_MS - 50)
    expect(ms).toBeLessThan(SNAPSHOT_REFRESH_DEADLINE_MS + 500)
    const detail = s.line('request')?.detail as string
    expect(detail).toMatch(/^status unavailable \(waited \d+ms\)$/)
    expect(Number(detail.match(/\d+/)?.[0])).toBeGreaterThanOrEqual(SNAPSHOT_REFRESH_DEADLINE_MS - 50)
    expect(s.line('request')).toMatchObject({ confirmed: true, cachedAgeS: null })
  })

  it('board routes keep RT_WAIT_MS: get() on the same slow first refresh gives up at the cap', async () => {
    const h = hub(
      () => status(Date.now(), 20, 5),
      () => RT_WAIT_MS + 400,
    )
    const client = new SnapshotClient(h, Date.now, () => {}, null, 'alerts')
    const t0 = Date.now()
    expect(await client.get()).toBeNull()
    const ms = Date.now() - t0
    expect(ms).toBeGreaterThanOrEqual(RT_WAIT_MS - 50)
    expect(ms).toBeLessThan(RT_WAIT_MS + 300)
    expect(client.status).toBeNull()
  })
})
