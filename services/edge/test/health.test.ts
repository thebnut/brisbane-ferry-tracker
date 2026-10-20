import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'
import type { StaticStore } from '../src/data/static-store.ts'
import { checkPublished, HEALTH_MAX_AGE_S, healthDetail, healthReasons, rtAges } from '../src/health.ts'
import { createLogger } from '../src/log.ts'
import type { HubStatus } from '../src/rt/hub-core.ts'
import type { SnapshotClient } from '../src/snapshot-client.ts'

const NOW = 1_792_482_916_000 // 07:55:16Z, 20 Oct 2026

const status = (sourceAgeS: number, buildAgeS: number): HubStatus => ({
  seq: 11181,
  sourceTimestamp: Math.floor((NOW - sourceAgeS * 1000) / 1000),
  fetchedAt: NOW - buildAgeS * 1000,
  lastCycleAt: NOW - buildAgeS * 1000,
  lastError: null,
  stats: null,
  generations: {},
})

function capture() {
  const lines: Array<Record<string, unknown>> = []
  return { lines, log: createLogger({}, (l) => lines.push(JSON.parse(l))) }
}

/** An app whose health reads `st` (null: no status) and a manifest unless `manifest` is false. */
function app(st: HubStatus | null, manifest = true) {
  const { lines, log } = capture()
  const store = {
    getManifest: async () => (manifest ? { updatedAt: 'x', modes: { ferry: { current: 'g1' } } } : null),
  } as unknown as StaticStore
  const snapshots = { get: async () => null, status: st } as unknown as SnapshotClient
  const a = createApp({
    store,
    snapshots,
    log,
    now: () => NOW,
    combinedFeeds: false,
    polledModes: ['ferry'],
  })
  const requestLine = () => lines.find((l) => l.msg === 'request') as Record<string, unknown>
  return { a, requestLine }
}

describe('health reasons (R14-RT1)', () => {
  it('names each failing check, in a fixed order', () => {
    expect(healthReasons(true, { ageS: 20, buildAgeS: 5 })).toEqual([])
    expect(healthReasons(true, { ageS: HEALTH_MAX_AGE_S, buildAgeS: 5 })).toEqual(['source-age'])
    expect(healthReasons(true, { ageS: 20, buildAgeS: 130 })).toEqual(['build-age'])
    expect(healthReasons(false, { ageS: null, buildAgeS: null })).toEqual([
      'manifest',
      'source-age',
      'build-age',
    ])
    expect(healthDetail(['source-age', 'build-age'], { ageS: 446.2, buildAgeS: 130 })).toBe(
      'source-age 446s,build-age 130s',
    )
    expect(healthDetail(['manifest', 'source-age'], { ageS: null, buildAgeS: null })).toBe(
      'manifest,source-age none',
    )
    expect(rtAges(null, NOW)).toEqual({ ageS: null, buildAgeS: null })
  })

  it('a 503 logs why: an upstream freeze reads as source-age with its age', async () => {
    const s = app(status(446, 8))
    const res = await s.a.request('/v1/health')
    expect(res.status).toBe(503)
    expect(s.requestLine()).toMatchObject({ status: 503, error: 'health not ok', detail: 'source-age 446s' })
    // The body is unchanged: no error field.
    expect(await res.json()).not.toHaveProperty('error')
  })

  it('a stale published status reads as build-age, a missing manifest as manifest', async () => {
    const b = app(status(140, 135))
    await b.a.request('/v1/health')
    expect(b.requestLine()).toMatchObject({ detail: 'source-age 140s,build-age 135s' })
    const m = app(status(20, 5), false)
    expect((await m.a.request('/v1/health')).status).toBe(503)
    expect(m.requestLine()).toMatchObject({ detail: 'manifest' })
  })

  it('a healthy 200 logs no failure', async () => {
    const s = app(status(25, 10))
    expect((await s.a.request('/v1/health')).status).toBe(200)
    expect(s.requestLine()).not.toHaveProperty('error')
    expect(s.requestLine()).not.toHaveProperty('detail')
  })
})

describe('watchdog published-status check (R14-RT1)', () => {
  it('logs nothing while the published status is fresh', async () => {
    const { lines, log } = capture()
    expect(await checkPublished(async () => status(25, 30), NOW, log)).toEqual([])
    expect(lines).toEqual([])
  })

  it('logs rt stale with the reason and ages when the source is past health (an upstream freeze)', async () => {
    const { lines, log } = capture()
    const hub = { sourceTimestamp: status(446, 8).sourceTimestamp, fetchedAt: NOW - 8_000 }
    expect(await checkPublished(async () => status(446, 8), NOW, log, hub)).toEqual(['source-age'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      level: 'warn',
      msg: 'rt stale',
      reasons: ['source-age'],
      seq: 11181,
      hubAges: { buildAgeS: 8 },
    })
    expect(lines[0]?.ageS as number).toBeGreaterThan(440)
  })

  it('a status that stopped reaching readers reads as build-age, while the hub itself is fresh', async () => {
    const { lines, log } = capture()
    const hub = { sourceTimestamp: Math.floor(NOW / 1000) - 20, fetchedAt: NOW - 5_000 }
    expect(await checkPublished(async () => status(200, 180), NOW, log, hub)).toEqual([
      'source-age',
      'build-age',
    ])
    expect(lines[0]).toMatchObject({ msg: 'rt stale', hubAges: { ageS: 20, buildAgeS: 5 } })
  })

  it('no published status at all is stale; a failed read logs as itself', async () => {
    const a = capture()
    expect(await checkPublished(async () => null, NOW, a.log)).toEqual(['source-age', 'build-age'])
    expect(a.lines[0]?.msg).toBe('rt stale')
    const b = capture()
    expect(
      await checkPublished(
        async () => {
          throw new Error('r2 down')
        },
        NOW,
        b.log,
      ),
    ).toBeNull()
    expect(b.lines).toEqual([{ level: 'warn', msg: 'rt stale check failed', error: 'r2 down' }])
  })
})
