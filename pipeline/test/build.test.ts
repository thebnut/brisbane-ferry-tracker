import { createHash } from 'node:crypto'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  GenerationIndex,
  LinesFile,
  Manifest,
  StaticStopDay,
  StopIndexFile,
  TripIndexDay,
} from '@bft/core'
import { downstreamOf, StaticStopDay as StaticStopDaySchema, shardOf } from '@bft/core'
import { beforeAll, describe, expect, it } from 'vitest'
import { blobKey, shardKey } from '../src/build/blobs.ts'
import { type BuildResult, runBuild, windowDates } from '../src/build/build.ts'
import { geohashEncode } from '../src/build/geohash.ts'
import { listFiles } from '../src/publish/targets.ts'
import { parseAll, readGz, readJsonFile } from './helpers.ts'
import { baseFeed, D, NOW, writeFeed } from './synth.ts'

const tmp = () => mkdtemp(join(tmpdir(), 'bft-out-'))

let feedDir: string
let out: string
let res: BuildResult
const index = (mode: string) => res.modes.find((m) => m.mode === mode)?.index as GenerationIndex
/** A stop-day from its per-stop blob, or for sharded modes (bus) from its shard. */
const day = async (mode: string, key: string, date = D): Promise<StaticStopDay> => {
  const idx = index(mode)
  if (idx.shards) {
    const sha = idx.shards.byDate[date]?.[shardOf(key, idx.shards.count)] as string
    return (await readGz(out, shardKey(sha)))[key]
  }
  return readGz(out, blobKey(idx.blobs[date]?.[key] as string))
}

beforeAll(async () => {
  feedDir = await writeFeed(baseFeed())
  out = await tmp()
  res = await runBuild({ feedDir, outDir: out, nowMs: NOW })
})

describe('build window and outputs', () => {
  it('builds service days D−1..D+6 from the Brisbane date of the build instant', () => {
    expect(res.serviceDates).toEqual(windowDates(D))
    expect(res.serviceDates[0]).toBe('20261019')
    expect(res.serviceDates[7]).toBe('20261026')
    for (const m of res.modes) expect(m.index.serviceDates).toEqual(res.serviceDates)
  })

  it('writes only contract-valid files (zod parse every file)', async () => {
    const counts = await parseAll(out)
    expect(counts.manifest).toBe(1)
    expect(counts.index).toBe(4)
    expect(counts.tripIndex).toBe(32)
    expect(counts.stops).toBe(4)
    expect(counts.lines).toBe(4)
    expect(counts.legacy).toBe(1)
    expect(counts.shard).toBeGreaterThan(0)
  })

  it('writes manifest.json last with every mode current', async () => {
    const files = await listFiles(out)
    expect(files).not.toContain('manifest.staging.json')
    const m = await readJsonFile<Manifest>(out, 'manifest.json')
    expect(Object.keys(m.modes)).toEqual(['ferry', 'train', 'tram', 'bus'])
    expect(m.modes.ferry?.current).toBe(index('ferry').generation)
    expect(m.modes.ferry?.previous).toBeUndefined()
    expect(m.quarantined).toEqual([])
  })

  it('names generations feedVersion + build hash', () => {
    const g = index('ferry').generation
    expect(g).toMatch(/^20261001-20261231-[0-9a-f]{8}-[0-9a-f]{12}$/)
    expect(g.startsWith(res.feedVersion)).toBe(true)
    expect(new Set(res.modes.map((m) => m.generation)).size).toBe(4)
  })
})

describe('stop-day files', () => {
  it('ferry: express and all-stops at Bulimba, drop-off rules respected', async () => {
    const f = await day('ferry', '317584')
    expect(f.stopKey).toBe('317584')
    expect(f.events).toHaveLength(8)
    expect(f.events.map((e) => e[3])).toEqual([...f.events.map((e) => e[3])].sort((a, b) => a - b))
    const riverside = f.stops.findIndex((s) => s.id === '317590')
    const hawthorne = f.stops.findIndex((s) => s.id === '317586')
    expect(hawthorne).toBe(-1) // drop_off_type=1 there, so no downstream entry and no stop ref
    for (const ev of f.events) {
      const [, seq, , dep, routeIdx, , platformIdx, pickup, dir] = ev
      const ds = downstreamOf(f, ev)
      expect(f.stops[platformIdx]?.id).toBe('317584')
      expect(pickup).toBe(0)
      expect(dir).toBe(1)
      expect(ds).toEqual([
        riverside,
        f.routes[routeIdx]?.short === 'F11' ? 12 * 60 : 20 * 60,
        0,
        f.routes[routeIdx]?.short === 'F11' ? 10 : 20,
      ])
      expect(seq).toBeGreaterThan(0)
      expect(dep % 60).toBe(0)
    }
    expect(f.routes.find((r) => r.short === 'F11')).toEqual({
      id: 'F11-1',
      short: 'F11',
      long: 'Express CityCat',
      color: '0072CE',
      textColor: 'FFFFFF',
    })
  })

  it('ferry: no stop-day for a terminus that only drops off', () => {
    expect(index('ferry').blobs[D]?.['317590']).toBeUndefined()
    expect(index('ferry').blobs[D]?.['317586']).toBeDefined()
  })

  it('train: keys by parent station slug with platform fields', async () => {
    expect(Object.keys(index('train').blobs[D] ?? {}).sort()).toEqual([
      'bowen-hills',
      'central',
      'domestic-airport',
    ])
    const c = await day('train', 'central')
    // Trains towards the airport board at platform 2; trains arriving from the airport terminate here.
    expect(c.events).toHaveLength(3)
    for (const ev of c.events)
      expect(c.stops[ev[6]]).toEqual({
        id: '600017',
        name: 'Central station, platform 2',
        platform: '2',
        key: 'central',
      })
    const downstreamKeys = downstreamOf(c, c.events[0] as StaticStopDay['events'][number])
      .filter((_, i) => i % 4 === 0)
      .map((i) => c.stops[i]?.key)
    expect(downstreamKeys).toEqual(['bowen-hills', 'domestic-airport'])
  })

  it('train: a 24:xx departure stays on its service day with seconds past 86400', async () => {
    const c = await day('train', 'central')
    const late = c.events.filter((e) => e[3] >= 86400)
    expect(late).toHaveLength(1)
    expect(late[0]?.[3]).toBe(24 * 3600 + 15 * 60)
  })

  it('bus: loop repeating a stop gets a seqDelta that tells the visits apart', async () => {
    const f = await day('bus', '1001')
    const loop = f.events.find((e) => f.trips[e[0]] === 'B400-loop') as StaticStopDay['events'][number]
    expect(loop).toBeDefined()
    const ds = downstreamOf(f, loop)
    const quads = Array.from({ length: ds.length / 4 }, (_, i) => ds.slice(i * 4, i * 4 + 4))
    expect(quads.map((q) => [f.stops[q[0] as number]?.id, q[1], q[3]])).toEqual([
      ['1002', 300, 10],
      ['10802', 600, 20],
      ['1001', 1200, 30],
    ])
    // Empty trip_headsign falls back to the last stop's name.
    expect(f.headsigns[loop[5]]).toBe('Adelaide St, stop 1')
  })

  it('bus: the 24:30 trip is in the stop-day of the service date it belongs to', async () => {
    const f = await day('bus', '10802')
    expect(f.events.map((e) => e[3])).toEqual([7 * 3600, 9 * 3600 + 10 * 60, 24 * 3600 + 30 * 60])
    expect(f.routes.find((r) => r.short === '66')?.long).toBe('UQ - RBWH, "busway"')
  })

  it('weekend days use the weekend services', async () => {
    const sat = await day('ferry', '317584', '20261024')
    expect(sat.trips).toEqual(['F1-we'])
    expect(sat.serviceDate).toBe('20261024')
  })
})

describe('trip index, shards and stats', () => {
  it('lists every active trip with full sextuples, including no-pickup rows', async () => {
    const t: TripIndexDay = await readGz(out, blobKey(index('ferry').tripIndex?.[D] as string))
    expect(t.generation).toBe(index('ferry').generation)
    expect(t.trips.map((x) => x.id)).toEqual([...t.trips.map((x) => x.id)].sort())
    const f1 = t.trips.find((x) => x.id === 'F1-0') as TripIndexDay['trips'][number]
    expect(f1.st).toHaveLength(4 * 6)
    expect(f1.st.slice(18)).toEqual([
      t.stops.indexOf('317590'),
      40,
      6 * 3600 + 25 * 60,
      6 * 3600 + 25 * 60,
      1,
      0,
    ])
  })

  it('bus is shards only: no per-stop blobs, every served stop in its bucket', async () => {
    const idx = index('bus')
    const shards = idx.shards as NonNullable<GenerationIndex['shards']>
    expect(shards).toMatchObject({ count: 512, hash: 'fnv1a32' })
    expect(shards.byDate[D]).toHaveLength(512)
    expect(idx.blobs).toEqual({})
    const keys = ['10802', '1001', '1002']
    for (const key of keys) {
      const sha = shards.byDate[D]?.[shardOf(key, shards.count)] as string
      const shard = await readGz(out, shardKey(sha))
      expect(StaticStopDaySchema.parse(shard[key]).stopKey).toBe(key)
    }
    expect(shards.byDate[D]?.filter(Boolean).length).toBeLessThanOrEqual(keys.length)
    expect(index('ferry').shards).toBeUndefined()
    expect(Object.keys(index('ferry').blobs[D] ?? {}).length).toBeGreaterThan(0)
  })

  it('dedupes downstream vectors and names only boarding stops', async () => {
    const f = await day('ferry', '317584')
    // 8 departures, two distinct remaining patterns (F1 and F11 to Riverside).
    expect(f.downstreams).toHaveLength(2)
    expect(f.stops.find((s) => s.id === '317584')?.name).toBe('Bulimba ferry terminal')
    expect(f.stops.find((s) => s.id === '317590')).toEqual({ id: '317590' })
  })

  it('records per-date stats', () => {
    expect(index('ferry').stats?.[D]).toEqual({ trips: 8, events: 16, stops: 3 })
    expect(index('ferry').stats?.['20261024']).toEqual({ trips: 1, events: 1, stops: 1 })
  })
})

describe('client data', () => {
  it('train stops.json is keyed by station with platforms', async () => {
    const s = await readJsonFile<StopIndexFile>(out, 'data/train/stops.json')
    expect(s.generation).toBe(index('train').generation)
    expect(s.stops.find((x) => x.key === 'central')).toEqual({
      key: 'central',
      name: 'Central station',
      lat: -27.466,
      lon: 153.026,
      platforms: [
        { id: '600017', code: '2' },
        { id: '600016', code: '3' },
      ],
      routes: ['BDBR', 'BRBD'],
    })
  })

  it('geo tiles hold each stop in its geohash5 cell', async () => {
    const files = (await listFiles(out)).filter((f) => f.startsWith('data/bus/geo/'))
    const gh = geohashEncode(-27.468, 153.026, 5)
    expect(files).toContain(`data/bus/geo/${gh}.json`)
    const tile = await readJsonFile<{ stops: Array<{ key: string }> }>(out, `data/bus/geo/${gh}.json`)
    expect(tile.stops.map((s) => s.key)).toContain('1001')
  })

  it('lines.json carries colours and stopping patterns', async () => {
    const l = await readJsonFile<LinesFile>(out, 'data/ferry/lines.json')
    const f11 = l.lines.find((x) => x.short === 'F11')
    expect(f11).toMatchObject({ color: '0072CE', routeIds: ['F11-1'] })
    expect(f11?.patterns).toEqual([
      { directionId: 1, headsign: 'Riverside', stops: ['317584', '317590'], trips: 4 },
    ])
    const t = await readJsonFile<LinesFile>(out, 'data/train/lines.json')
    expect(t.lines.find((x) => x.short === 'BDBR')?.patterns[0]?.stops).toEqual([
      'domestic-airport',
      'bowen-hills',
      'central',
    ])
  })
})

describe('determinism', () => {
  const digestDir = async (dir: string, skip: (f: string) => boolean = () => false) => {
    const out: Record<string, string> = {}
    for (const f of await listFiles(dir))
      if (!skip(f))
        out[f] = createHash('sha256')
          .update(await readFile(join(dir, f)))
          .digest('hex')
    return out
  }

  it('same input → identical files and hashes', async () => {
    const out2 = await tmp()
    await runBuild({ feedDir, outDir: out2, nowMs: NOW })
    expect(await digestDir(out2)).toEqual(await digestDir(out))
  })

  it('a different build instant on the same date keeps every generation and blob', async () => {
    const out3 = await tmp()
    const r = await runBuild({ feedDir, outDir: out3, nowMs: NOW + 3600_000 })
    expect(r.modes.map((m) => m.generation)).toEqual(res.modes.map((m) => m.generation))
    const blobs = (f: string) => !f.startsWith('static/blobs/') && !f.startsWith('static/shards/')
    const a = await digestDir(out, blobs)
    const b = await digestDir(out3, blobs)
    expect(b).toEqual(a)
  })

  it('re-running into the same directory writes no new blobs', async () => {
    const r = await runBuild({ feedDir, outDir: out, nowMs: NOW })
    expect(r.blobsWritten).toBe(0)
    expect(r.blobsExisting).toBeGreaterThan(0)
    const m = await readJsonFile<Manifest>(out, 'manifest.json')
    expect(m.modes.ferry?.current).toBe(index('ferry').generation)
    expect(m.modes.ferry?.previous).toBeUndefined()
  })
})
