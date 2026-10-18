import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GenerationIndex, Manifest } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { runBuild } from '../src/build/build.ts'
import { StructuralError } from '../src/feed/load.ts'
import {
  checkFeedEndDate,
  checkGoldenFacts,
  quarantineReasons,
  StructuralFailure,
} from '../src/validate/validators.ts'
import { readJsonFile } from './helpers.ts'
import { baseFeed, NOW, type SynthFeed, setCell, writeFeed } from './synth.ts'

const tmp = () => mkdtemp(join(tmpdir(), 'bft-val-'))
const build = async (feed: SynthFeed, outDir?: string, accept?: string[]) =>
  runBuild({
    feedDir: await writeFeed(feed),
    outDir: outDir ?? (await tmp()),
    nowMs: NOW,
    ...(accept ? { accept } : {}),
  })

/** Run a build expected to fail closed; returns the problems and checks nothing was written. */
async function structural(feed: SynthFeed): Promise<string[]> {
  const out = await tmp()
  const err = await build(feed, out).then(
    () => null,
    (e: unknown) => e,
  )
  expect(err instanceof StructuralError || err instanceof StructuralFailure).toBe(true)
  expect(existsSync(join(out, 'manifest.json'))).toBe(false)
  return (err as StructuralError).problems
}

describe('structural corruption fails closed', () => {
  it('missing file', async () => {
    const dir = await writeFeed(baseFeed())
    await rm(join(dir, 'stops.txt'))
    const out = await tmp()
    await expect(runBuild({ feedDir: dir, outDir: out, nowMs: NOW })).rejects.toThrow(/missing stops.txt/)
    expect(existsSync(join(out, 'manifest.json'))).toBe(false)
  })

  it('unparseable file (unterminated quote)', async () => {
    const dir = await writeFeed(baseFeed())
    await writeFile(join(dir, 'trips.txt'), 'route_id,service_id,trip_id\r\nF1-1,WK,"broken\r\n')
    await expect(runBuild({ feedDir: dir, outDir: await tmp(), nowMs: NOW })).rejects.toThrow(
      /trips.txt: unparseable/,
    )
  })

  it('missing required column', async () => {
    const f = baseFeed()
    f['stops.txt'] = (f['stops.txt'] ?? []).map((r) => r.filter((_, i) => i !== 4))
    expect((await structural(f)).join()).toMatch(/stops.txt: missing column stop_lat/)
  })

  it('stop_times referencing an unknown stop', async () => {
    const f = baseFeed()
    setCell(f, 'stop_times.txt', 3, 3, 'nope')
    expect((await structural(f)).join()).toMatch(/stop_id nope not found/)
  })

  it('stop_times referencing an unknown trip', async () => {
    const f = baseFeed()
    setCell(f, 'stop_times.txt', 3, 0, 'ghost')
    expect((await structural(f)).join()).toMatch(/trip_id ghost not found/)
  })

  it('trip with an unknown route or service', async () => {
    const f = baseFeed()
    setCell(f, 'trips.txt', 1, 0, 'X9')
    setCell(f, 'trips.txt', 2, 1, 'NOSERVICE')
    const p = (await structural(f)).join('\n')
    expect(p).toMatch(/route_id X9 not found/)
    expect(p).toMatch(/service_id NOSERVICE not found/)
  })

  it('broken parent_station', async () => {
    const f = baseFeed()
    const row = (f['stops.txt'] as string[][]).find((r) => r[0] === '600016') as string[]
    row[9] = 'place_missing'
    expect((await structural(f)).join()).toMatch(/parent_station place_missing not found/)
  })

  it('malformed time', async () => {
    const f = baseFeed()
    setCell(f, 'stop_times.txt', 2, 2, '7am')
    expect((await structural(f)).join()).toMatch(/unparseable row/)
  })

  it('feed_end_date earlier than today + 7', async () => {
    const f = baseFeed()
    setCell(f, 'feed_info.txt', 1, 4, '20261026')
    expect((await structural(f)).join()).toMatch(/feed_end_date 20261026 is before today\+7 \(20261027\)/)
    expect(checkFeedEndDate('20261027', '20261020')).toEqual([])
  })

  it('golden facts: a real-feed landmark disappearing', () => {
    const idx = (blobs: GenerationIndex['blobs']) => ({ blobs }) as GenerationIndex
    const full = Object.fromEntries(
      ['1', '2', '3', '4', '5'].map((d) => [`2026102${d}`, { '317584': 'x', '317590': 'x' }]),
    )
    expect(checkGoldenFacts({ ferry: idx(full) }).join()).toBe('')
    const lost = Object.fromEntries(
      Object.entries(full).map(([d, m]) => [d, d === '20261021' ? { '317590': 'x' } : m]),
    )
    expect(checkGoldenFacts({ ferry: idx(lost) }).join()).toMatch(
      /Bulimba ferry terminal \(ferry 317584\) has service on 4 days/,
    )
  })
})

describe('plausible service changes are quarantined', () => {
  /** Drop most ferry weekday trips: a > 20% swing. */
  const fewerFerries = () => {
    const f = baseFeed()
    const drop = new Set(['F1-1', 'F1-2', 'F1-3', 'F11-1', 'F11-2'])
    f['trips.txt'] = (f['trips.txt'] as string[][]).filter((r) => !drop.has(r[2] as string))
    f['stop_times.txt'] = (f['stop_times.txt'] as string[][]).filter((r) => !drop.has(r[0] as string))
    return f
  }

  it('publishes to staging, keeps the live generation and records reasons', async () => {
    const out = await tmp()
    const first = await build(baseFeed(), out)
    const oldFerry = first.modes.find((m) => m.mode === 'ferry')?.generation as string
    const second = await build(fewerFerries(), out)
    const ferry = second.modes.find((m) => m.mode === 'ferry')
    expect(ferry?.quarantined.join('\n')).toMatch(/ferry 20261020: trip count 8 → 3 \(-62%, limit ±20%\)/)
    // Train/tram/bus changed generation (new feed hash) but not materially: they go live.
    expect(second.modes.filter((m) => m.quarantined.length).map((m) => m.mode)).toEqual(['ferry'])

    const live = await readJsonFile<Manifest>(out, 'manifest.json')
    expect(live.modes.ferry?.current).toBe(oldFerry)
    expect(live.modes.train?.current).toBe(second.modes.find((m) => m.mode === 'train')?.generation)
    expect(live.modes.train?.previous).toBe(first.modes.find((m) => m.mode === 'train')?.generation)
    expect(live.quarantined).toEqual([
      { generation: ferry?.generation, mode: 'ferry', reasons: ferry?.quarantined },
    ])

    const staging = await readJsonFile<Manifest>(out, 'manifest.staging.json')
    expect(staging.modes.ferry).toMatchObject({ current: ferry?.generation, previous: oldFerry })
    // Quarantined client data stays out of the live paths.
    const liveStops = await readJsonFile<{ generation: string }>(out, 'data/ferry/stops.json')
    expect(liveStops.generation).toBe(oldFerry)
    const stagedStops = await readJsonFile<{ generation: string }>(out, 'staging/data/ferry/stops.json')
    expect(stagedStops.generation).toBe(ferry?.generation)
    expect(existsSync(join(out, 'staging/legacy/latest.json'))).toBe(true)

    // workflow_dispatch accept=<generation> promotes it.
    const third = await build(fewerFerries(), out, [ferry?.generation as string])
    expect(third.modes.find((m) => m.mode === 'ferry')).toMatchObject({ accepted: true })
    const promoted = await readJsonFile<Manifest>(out, 'manifest.json')
    expect(promoted.modes.ferry).toMatchObject({ current: ferry?.generation, previous: oldFerry })
    expect(promoted.quarantined).toEqual([])
  })

  it('a station losing all service without a calendar_dates explanation', async () => {
    const out = await tmp()
    await build(baseFeed(), out)
    // Trains stop calling at Bowen Hills: same trip counts, but the station vanishes.
    const f = baseFeed()
    f['stop_times.txt'] = (f['stop_times.txt'] as string[][]).filter(
      (r) => r[3] !== '600100' && r[3] !== '600101',
    )
    const r = await build(f, out)
    const train = r.modes.find((m) => m.mode === 'train')
    expect(train?.quarantined).toContain(
      "train 20261020: bowen-hills has no service and calendar_dates doesn't explain it",
    )
    expect(train?.quarantined.some((x) => x.includes('trip count'))).toBe(false)
  })
})

describe('quarantineReasons', () => {
  const idx = (dates: Record<string, { trips: number; keys: string[] }>): GenerationIndex => ({
    schemaVersion: 1,
    generation: 'g',
    mode: 'train',
    feedVersion: 'f',
    builtAt: '',
    serviceDates: Object.keys(dates),
    blobs: Object.fromEntries(
      Object.entries(dates).map(([d, v]) => [d, Object.fromEntries(v.keys.map((k) => [k, 'x']))]),
    ),
    stats: Object.fromEntries(
      Object.entries(dates).map(([d, v]) => [d, { trips: v.trips, events: 0, stops: v.keys.length }]),
    ),
  })

  it('allows a swing of exactly 20%', () => {
    const prev = idx({ '20261020': { trips: 100, keys: ['a'] } })
    const ok = quarantineReasons({
      mode: 'train',
      index: idx({ '20261020': { trips: 80, keys: ['a'] } }),
      previous: prev,
      closureExplained: () => false,
    })
    expect(ok).toEqual([])
    const bad = quarantineReasons({
      mode: 'train',
      index: idx({ '20261020': { trips: 79, keys: ['a'] } }),
      previous: prev,
      closureExplained: () => false,
    })
    expect(bad).toHaveLength(1)
  })

  it('lets a calendar_dates closure through', () => {
    const prev = idx({ '20261020': { trips: 10, keys: ['a', 'b'] } })
    const next = idx({ '20261020': { trips: 10, keys: ['a'] } })
    const args = { mode: 'train' as const, index: next, previous: prev, stationKeys: new Set(['a', 'b']) }
    expect(quarantineReasons({ ...args, closureExplained: () => false })).toHaveLength(1)
    expect(quarantineReasons({ ...args, closureExplained: (k, d) => k === 'b' && d === '20261020' })).toEqual(
      [],
    )
  })

  it('without a previous generation, compares the same weekday within the window', () => {
    // 20261019 and 20261026 are both Mondays.
    const next = idx({ '20261019': { trips: 5, keys: ['a', 'b'] }, '20261026': { trips: 5, keys: ['a'] } })
    expect(
      quarantineReasons({
        mode: 'train',
        index: next,
        previous: null,
        stationKeys: new Set(['a', 'b']),
        closureExplained: () => false,
      }),
    ).toEqual(["train 20261026: b has no service and calendar_dates doesn't explain it"])
  })
})
