import { gzipSync } from 'node:zlib'
import { type GenerationIndex, shardOf } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { stopDay } from '../../../packages/core/test/helpers.ts'
import { MemoryDataSource } from '../src/data/source.ts'
import { mayHaveStop, StaticStore, shardKey, TRIP_INDEX_CACHE_MAX_BYTES } from '../src/data/static-store.ts'

const D = '20261020'
const SHA = 'a'.repeat(64)

describe('StaticStore shards (bus on the assets backend)', () => {
  const day = stopDay(D, '1234', [
    {
      id: 'B1',
      route: '66-4055',
      stops: [
        ['1234', '08:00:00'],
        ['5678', '08:10:00'],
      ],
    },
  ])
  const count = 8
  const byDate: (string | null)[] = Array.from({ length: count }, () => null)
  byDate[shardOf('1234', count)] = SHA
  const index: GenerationIndex = {
    schemaVersion: 1,
    generation: 'g1',
    mode: 'bus',
    feedVersion: 'fv',
    builtAt: '2026-10-19T17:15:00Z',
    serviceDates: [D],
    blobs: { [D]: {} },
    shards: { count, hash: 'fnv1a32', byDate: { [D]: byDate } },
  }
  const src = new MemoryDataSource(
    new Map([[shardKey(SHA), new Uint8Array(gzipSync(JSON.stringify({ '1234': day })))]]),
  )
  const store = new StaticStore(src, { validate: true })

  it('reads a stop-day out of its shard', async () => {
    expect(await store.stopDay(index, D, '1234')).toEqual(day)
  })

  it('a stop in an empty bucket is unknown; a stop missing from its shard reads as null', async () => {
    const other = ['1', '2', '3', '4', '5', '6', '7', '8', '9'].find(
      (k) => shardOf(k, count) !== shardOf('1234', count),
    ) as string
    expect(mayHaveStop(index, other)).toBe(false)
    const sibling = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].find(
      (k) => shardOf(k, count) === shardOf('1234', count),
    )
    if (sibling) expect(await store.stopDay(index, D, sibling)).toBeNull()
  })
})

describe('StaticStore trip-index caching', () => {
  const idx = (sha: string) => ({ tripIndex: { [D]: sha } }) as unknown as GenerationIndex
  const day = {
    schemaVersion: 1,
    mode: 'bus',
    serviceDate: D,
    generation: 'g',
    routes: [],
    stops: [],
    trips: [],
  }

  it('caches small trip indexes and re-reads large ones (bus) instead of pinning them', async () => {
    const small = 'b'.repeat(64)
    const large = 'c'.repeat(64)
    const big = { ...day, pad: 'x'.repeat(TRIP_INDEX_CACHE_MAX_BYTES + 10) }
    const src = new MemoryDataSource(
      new Map([
        [`static/blobs/${small}.json.gz`, new TextEncoder().encode(JSON.stringify(day))],
        [`static/blobs/${large}.json.gz`, new TextEncoder().encode(JSON.stringify(big))],
      ]),
    )
    const store = new StaticStore(src)
    for (let i = 0; i < 3; i++) {
      await store.tripIndexDay(idx(small), D)
      await store.tripIndexDay(idx(large), D)
    }
    expect(src.reads.filter((k) => k.includes(small))).toHaveLength(1)
    expect(src.reads.filter((k) => k.includes(large))).toHaveLength(3)
  })

  it('concurrent loads of either size share one read', async () => {
    const small = 'd'.repeat(64)
    const large = 'e'.repeat(64)
    const big = { ...day, pad: 'x'.repeat(TRIP_INDEX_CACHE_MAX_BYTES + 10) }
    const src = new MemoryDataSource(
      new Map([
        [`static/blobs/${small}.json.gz`, new TextEncoder().encode(JSON.stringify(day))],
        [`static/blobs/${large}.json.gz`, new TextEncoder().encode(JSON.stringify(big))],
      ]),
    )
    const store = new StaticStore(src)
    const [a, b] = await Promise.all([store.tripIndexDay(idx(large), D), store.tripIndexDay(idx(large), D)])
    expect(a).toBe(b)
    await Promise.all([store.tripIndexDay(idx(small), D), store.tripIndexDay(idx(small), D)])
    expect(src.reads.filter((k) => k.includes(large))).toHaveLength(1)
    expect(src.reads.filter((k) => k.includes(small))).toHaveLength(1)
    // Once settled, a large one is not retained: the next call reads again.
    await store.tripIndexDay(idx(large), D)
    expect(src.reads.filter((k) => k.includes(large))).toHaveLength(2)
  })
})
