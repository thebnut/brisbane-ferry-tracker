import { describe, expect, it } from 'vitest'
import { createLogger } from '../src/log.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { HubCore } from '../src/rt/hub-core.ts'
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

const TU = 'TripUpdates/Ferry'
const VP = 'VehiclePositions/Ferry'

/** A hub on a 30 s cycle (staging) or 15 s (production), logging into `lines`. */
function setup(cycleMs: number) {
  const clock = new Clock(epoch(D, '07:45:00') * 1000)
  const up = new FakeUpstream()
  const lines: Array<Record<string, unknown>> = []
  const hub = new HubCore({
    storage: new FakeStorage(),
    fetch: up.fetch,
    now: clock.now,
    store: storeFor(buildTree(), clock.now),
    config: parseRtModes('ferry'),
    upstream: 'https://up.test/api/realtime/SEQ',
    fetchTimeoutMs: 50,
    cycleMs,
    log: createLogger({}, (l) => lines.push(JSON.parse(l))),
  })
  const nowS = () => Math.floor(clock.t / 1000)
  /** TransLink's feeds as of header time `ts`; `n` changes the bytes (a new delay) without touching the header. */
  const publish = (ts: number, n = 0) => {
    up.set(
      TU,
      feed(ts, [
        tripUpdate('e1', { tripId: 'T1', startDate: D, routeId: 'F1-4055' }, [
          { seq: 1, stopId: '317584', depTime: epoch(D, '08:02:00') + n },
        ]),
      ]),
    )
    up.set(VP, feed(nowS() - 15, [vehicle('V1', 'T1', D, -27.45, 153.05 + n / 1e5)]))
  }
  const poll = async () => {
    await hub.cycle()
    clock.advance(cycleMs)
  }
  const msgs = (m: string) => lines.filter((l) => l.msg === m)
  return { clock, up, hub, nowS, publish, poll, msgs }
}

describe('hub: TransLink header freeze (R14-RT1)', () => {
  for (const cycleMs of [30_000, 15_000]) {
    it(`a header that stops advancing while every fetch succeeds logs once, then recovers (${cycleMs / 1000} s)`, async () => {
      const h = setup(cycleMs)
      // Normal: the header advances (20 s behind), and the bytes change every poll.
      for (let i = 0; i < 6; i++) {
        h.publish(h.nowS() - 20, i)
        await h.poll()
      }
      expect(h.msgs('rt source stale')).toEqual([])
      // Frozen for 7 minutes: new bytes every poll (so the hub rebuilds), the same header time.
      const frozen = h.nowS() - 20
      for (let i = 0; i < 420_000 / cycleMs; i++) {
        h.publish(frozen, 100 + i)
        await h.poll()
      }
      const stale = h.msgs('rt source stale')
      expect(stale).toHaveLength(1)
      expect(stale[0]).toMatchObject({ level: 'warn', feed: TU, sourceTimestamp: frozen })
      expect(stale[0]?.ageS as number).toBeGreaterThan(90)
      expect(stale[0]?.seq as number).toBeGreaterThan(0)
      expect(h.hub.staleSources()).toEqual([TU])
      // TransLink catches up.
      h.publish(h.nowS() - 20, 999)
      await h.poll()
      const rec = h.msgs('rt source recovered')
      expect(rec).toHaveLength(1)
      expect(rec[0]).toMatchObject({ feed: TU })
      expect(rec[0]?.staleS as number).toBeGreaterThanOrEqual(400)
      expect(h.hub.staleSources()).toEqual([])
      expect(h.msgs('rt source stale')).toHaveLength(1)
    })
  }

  it('304s count as successful polls of the same header', async () => {
    const h = setup(30_000)
    h.publish(h.nowS() - 20)
    for (let i = 0; i < 6; i++) await h.poll() // the same bytes: 304 after the first
    expect(h.up.calls.some((c) => c.ifNoneMatch != null)).toBe(true)
    expect(h.msgs('rt source stale').map((l) => l.feed)).toEqual([TU, VP])
  })

  it('failed fetches never count as a frozen source', async () => {
    const h = setup(30_000)
    h.publish(h.nowS() - 20)
    await h.poll()
    h.up.fail.add(TU)
    h.up.fail.add(VP)
    for (let i = 0; i < 10; i++) await h.poll()
    expect(h.msgs('rt source stale')).toEqual([])
  })
})
