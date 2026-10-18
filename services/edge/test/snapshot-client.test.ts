import { describe, expect, it } from 'vitest'
import type { PullResult } from '../src/rt/hub-core.ts'
import { SnapshotClient } from '../src/snapshot-client.ts'
import { Clock } from './fixtures.ts'

const snap = (seq: number) =>
  JSON.stringify({
    header: {
      schemaVersion: 1,
      seq,
      staticGeneration: {},
      serviceDates: [],
      sourceTimestamp: 1,
      fetchedAt: 1,
    },
    trips: {},
    vehicles: [],
    alerts: [],
  })
const status = {
  seq: null,
  sourceTimestamp: null,
  fetchedAt: null,
  lastCycleAt: null,
  lastError: null,
  stats: null,
  generations: {},
}

describe('SnapshotClient stale-while-revalidate', () => {
  it('serves the isolate copy at once and refreshes in the background', async () => {
    const clock = new Clock(0)
    let seq = 1
    let release: () => void = () => {}
    let calls = 0
    const bg: Promise<unknown>[] = []
    const client = new SnapshotClient(
      {
        pull: async (): Promise<PullResult> => {
          calls++
          if (calls > 1) await new Promise<void>((r) => (release = r)) // a slow R2 read
          return { seq, json: snap(seq), status }
        },
        getRaw: async () => null,
      },
      clock.now,
      (p) => bg.push(p),
      null,
    )
    expect((await client.get())?.seq).toBe(1)
    clock.advance(11_000)
    seq = 2
    // The hub is slow now, but the request still resolves with the copy it has.
    expect((await client.get())?.seq).toBe(1)
    expect(bg).toHaveLength(1)
    release()
    await bg[0]
    expect((await client.get())?.seq).toBe(2)
    expect(calls).toBe(2)
  })

  it('waits for the refresh when the copy is older than 60 s', async () => {
    const clock = new Clock(0)
    let seq = 1
    const client = new SnapshotClient(
      { pull: async () => ({ seq, json: snap(seq), status }), getRaw: async () => null },
      clock.now,
      () => {},
      null,
    )
    await client.get()
    clock.advance(61_000)
    seq = 5
    expect((await client.get())?.seq).toBe(5)
  })

  it('re-review #4 failed refreshes are throttled too', async () => {
    const clock = new Clock(0)
    let calls = 0
    const client = new SnapshotClient(
      {
        pull: async () => {
          calls++
          throw new Error('r2 down')
        },
        getRaw: async () => null,
      },
      clock.now,
      () => {},
      null,
    )
    for (let i = 0; i < 5; i++) expect(await client.get()).toBeNull()
    expect(calls).toBe(1)
    clock.advance(10_000)
    await client.get()
    expect(calls).toBe(2)
  })
})
