/** Contract additions for the static pipeline: GenerationIndex shards and stats, StaticShard, client data files. */
import { describe, expect, it } from 'vitest'
import { GenerationIndex, GeoTileFile, LinesFile, StaticShard, StopIndexFile } from '../src/index.ts'
import { stopDay } from './helpers.ts'

const sha = (c: string) => c.repeat(64)

const baseIndex = {
  schemaVersion: 1,
  generation: '20261017-20261216-abcd1234-0123456789ab',
  mode: 'bus',
  feedVersion: '20261017-20261216-abcd1234',
  builtAt: '2026-10-19T17:15:00.000Z',
  serviceDates: ['20261020'],
  blobs: { '20261020': { '10802': sha('a') } },
} as const

describe('GenerationIndex', () => {
  it('accepts an index without shards or stats (ferry, train, tram)', () => {
    expect(GenerationIndex.parse(baseIndex).shards).toBeUndefined()
  })
  it('accepts bus shards and per-date stats', () => {
    const idx = GenerationIndex.parse({
      ...baseIndex,
      tripIndex: { '20261020': sha('c') },
      shards: { '20261020': { '10802': sha('b') } },
      stats: { '20261020': { trips: 20072, events: 529557, stops: 12235 } },
    })
    expect(idx.shards?.['20261020']?.['10802']).toBe(sha('b'))
  })
  it('rejects a shard hash that is not sha256 hex', () => {
    expect(() =>
      GenerationIndex.parse({ ...baseIndex, shards: { '20261020': { '10802': 'nope' } } }),
    ).toThrow()
  })
  it('rejects a bad service date key in shards', () => {
    expect(() =>
      GenerationIndex.parse({ ...baseIndex, shards: { '2026-10-20': { '10802': sha('b') } } }),
    ).toThrow()
  })
})

describe('StaticShard', () => {
  it('maps stop keys to complete stop-day files', () => {
    const day = stopDay('20261020', '10802', [
      {
        id: 't1',
        route: '66',
        stops: [
          ['10802', '08:00:00'],
          ['1002', '08:10:00'],
        ],
      },
    ])
    expect(Object.keys(StaticShard.parse({ '10802': day }))).toEqual(['10802'])
    expect(() => StaticShard.parse({ '10802': { ...day, events: 'x' } })).toThrow()
  })
})

describe('client data files', () => {
  it('parse the stop index, a geo tile and lines', () => {
    StopIndexFile.parse({
      schemaVersion: 1,
      mode: 'train',
      generation: 'g',
      stops: [
        {
          key: 'central',
          name: 'Central station',
          lat: -27.466,
          lon: 153.026,
          platforms: [{ id: '600018', code: '1' }],
          routes: ['BRCA'],
        },
      ],
    })
    GeoTileFile.parse({
      schemaVersion: 1,
      mode: 'bus',
      generation: 'g',
      geohash: 'r7hgd',
      stops: [{ key: '1', name: 'x', lat: 0, lon: 0 }],
    })
    LinesFile.parse({
      schemaVersion: 1,
      mode: 'ferry',
      generation: 'g',
      lines: [
        {
          short: 'F11',
          color: '00A1E0',
          routeIds: ['F11-4398'],
          patterns: [{ directionId: 0, headsign: 'x', stops: ['a', 'b'], trips: 3 }],
        },
      ],
    })
    expect(() =>
      GeoTileFile.parse({ schemaVersion: 1, mode: 'bus', generation: 'g', geohash: 'r7h', stops: [] }),
    ).toThrow()
  })
})
