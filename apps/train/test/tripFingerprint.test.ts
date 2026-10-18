import { gtfsToEpoch, TripResponse } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { onConnect, onCycle, type PushState, tripFingerprint } from '../app/lib/tripFingerprint.ts'

const AM8 = gtfsToEpoch('20261020', 8 * 3600) * 1000

async function tripAt(ms: number): Promise<TripResponse> {
  const d = (await (
    await handleFixtureApi(new URL('http://x/__fixtures/v1/train/stops/central/departures?limit=20'), AM8)
  ).json()) as { departures: Array<{ tripInstance: string; gps: boolean }> }
  const key = d.departures.find((x) => x.gps)?.tripInstance ?? ''
  return TripResponse.parse(
    await (
      await handleFixtureApi(new URL(`http://x/__fixtures/v1/train/trips/${encodeURIComponent(key)}`), ms)
    ).json(),
  )
}

describe('WebSocket push fingerprint', () => {
  it('ignores envelope timestamps, changes when the train moves', async () => {
    const a = await tripAt(AM8)
    const sameCycle = await tripAt(AM8 + 3000)
    expect(sameCycle.generatedAt).not.toBe(a.generatedAt)
    expect(tripFingerprint(sameCycle)).toBe(tripFingerprint(a))
    expect(tripFingerprint(await tripAt(AM8 + 60_000))).not.toBe(tripFingerprint(a))
  })
  it('covers every rendered field: occupancy, scheduled times, platform corrections', async () => {
    const a = await tripAt(AM8)
    const fp = tripFingerprint(a)
    const v = a.vehicle ?? { id: 'v', lat: 0, lon: 0, ts: 0 }
    expect(tripFingerprint({ ...a, vehicle: { ...v, occupancy: 'FULL' } })).not.toBe(fp)
    const stops = a.stops.map((s, i) => (i === 1 ? { ...s, scheduledPlatform: '9' } : s))
    expect(tripFingerprint({ ...a, stops })).not.toBe(fp)
    const sched = a.stops.map((s, i) => (i === 1 ? { ...s, schedDep: (s.schedDep ?? 0) + 60 } : s))
    expect(tripFingerprint({ ...a, stops: sched })).not.toBe(fp)
  })
})

describe('push decisions', () => {
  it('a newer trip seen on a new connection is broadcast to every viewer, then cycles tick', async () => {
    const a = await tripAt(AM8)
    const b = await tripAt(AM8 + 60_000)
    const state: PushState = { last: null }
    expect(onConnect(state, a, a.tripInstance).kind).toBe('broadcast') // first viewer
    expect(onConnect(state, a, a.tripInstance).kind).toBe('send-new') // second viewer, same data
    expect(onConnect(state, b, a.tripInstance).kind).toBe('broadcast') // third viewer brings newer data: everyone
    const tick = onCycle(state, b, a.tripInstance)
    expect(tick.kind).toBe('tick')
    expect(JSON.parse(tick.body)).toMatchObject({ type: 'tick', tripInstance: a.tripInstance })
  })
  it('a failed load tells viewers to poll instead of leaving them on stale data', () => {
    const state: PushState = { last: 'x' }
    expect(onCycle(state, null, 'T@20261020')).toMatchObject({ kind: 'unavailable' })
    expect(JSON.parse(onConnect(state, null, 'T@20261020').body)).toEqual({
      type: 'unavailable',
      tripInstance: 'T@20261020',
    })
  })
})
