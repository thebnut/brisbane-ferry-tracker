import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CalendarDateRow, CalendarRow, GenerationIndex, Manifest, Mode } from '@bft/core'
import { addDays, ServiceCalendar } from '@bft/core'
import { describe, expect, it } from 'vitest'
import { type BuildOptions, runBuild } from '../src/build/build.ts'
import { StructuralError } from '../src/feed/load.ts'
import {
  type AttestedClosure,
  checkFeedEndDate,
  checkGoldenLandmarks,
  feedCoverage,
  type GoldenFact,
  type LandmarkEvidence,
  quarantineReasons,
  StructuralFailure,
  uncoveredDates,
} from '../src/validate/validators.ts'
import { readJsonFile } from './helpers.ts'
import { baseFeed, D, NOW, type SynthFeed, setCell, writeFeed } from './synth.ts'

const tmp = () => mkdtemp(join(tmpdir(), 'bft-val-'))
const build = async (feed: SynthFeed, outDir?: string, accept?: string[]) =>
  runBuild({
    feedDir: await writeFeed(feed),
    outDir: outDir ?? (await tmp()),
    nowMs: NOW,
    ...(accept ? { accept } : {}),
  })

/** Drop stop_times rows (not trips) matching `drop(row, trip row)`: the trips still run, skipping those stops. */
const withoutStopTimes = (f: SynthFeed, drop: (r: string[], trip: string[]) => boolean) => {
  const trips = new Map((f['trips.txt'] as string[][]).slice(1).map((t) => [t[2] as string, t]))
  f['stop_times.txt'] = (f['stop_times.txt'] as string[][]).filter(
    (r, i) => i === 0 || !drop(r, trips.get(r[0] as string) as string[]),
  )
  return f
}

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

  it('trailing garbage in a time', async () => {
    const f = baseFeed()
    setCell(f, 'stop_times.txt', 2, 2, '06:05:00garbage')
    expect((await structural(f)).join()).toMatch(/unparseable row/)
  })

  it('boarding rules outside 0-3', async () => {
    const f = baseFeed()
    setCell(f, 'stop_times.txt', 2, 5, '4')
    expect((await structural(f)).join()).toMatch(/pickup_type\/drop_off_type outside 0-3/)
  })

  it('feed_end_date earlier than today + 7', async () => {
    const f = baseFeed()
    setCell(f, 'feed_info.txt', 1, 4, '20261026')
    expect((await structural(f)).join()).toMatch(/feed_end_date 20261026 is before today\+7 \(20261027\)/)
    expect(checkFeedEndDate('20261027', '20261020')).toEqual([])
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

  it('accepts a staged generation on a later day when the feed is unchanged, and rejects unknown ids', async () => {
    const out = await tmp()
    const dir = await writeFeed(baseFeed())
    await runBuild({ feedDir: dir, outDir: out, nowMs: NOW })
    const swung = await writeFeed(fewerFerries())
    const q = await runBuild({ feedDir: swung, outDir: out, nowMs: NOW })
    const staged = q.modes.find((m) => m.mode === 'ferry')?.generation as string
    // Next day: the same feed rebuilds with a new window, so a new generation id, but the accept still applies.
    const nextDay = NOW + 86_400_000
    await expect(runBuild({ feedDir: swung, outDir: out, nowMs: nextDay, accept: ['nope'] })).rejects.toThrow(
      /unknown generation/,
    )
    const r = await runBuild({ feedDir: swung, outDir: out, nowMs: nextDay, accept: [staged] })
    const ferry = r.modes.find((m) => m.mode === 'ferry')
    expect(ferry?.generation).not.toBe(staged)
    expect(ferry?.accepted).toBe(true)
    expect((await readJsonFile<Manifest>(out, 'manifest.json')).modes.ferry?.current).toBe(ferry?.generation)
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

describe('dates outside the new feed (issue #93)', () => {
  /** TransLink's 20 Oct feed: feed_info and calendar both start on D, so D−1 (19 Oct) has no service in it. */
  const startingOn = (start: string, f = baseFeed()) => {
    setCell(f, 'feed_info.txt', 1, 3, start)
    for (const row of [1, 2]) setCell(f, 'calendar.txt', row, 8, start)
    return f
  }
  const withoutTrips = (f: SynthFeed, drop: (r: string[]) => boolean) => {
    const ids = new Set(
      (f['trips.txt'] as string[][])
        .slice(1)
        .filter(drop)
        .map((r) => r[2]),
    )
    f['trips.txt'] = (f['trips.txt'] as string[][]).filter((r) => !ids.has(r[2] as string))
    f['stop_times.txt'] = (f['stop_times.txt'] as string[][]).filter((r) => !ids.has(r[0] as string))
    return f
  }

  it('a new feed starting on D with the previous generation covering D−1: no quarantine, D−1 reported', async () => {
    const out = await tmp()
    const first = await build(baseFeed(), out)
    expect(first.uncoveredDates).toEqual([])
    expect(first.serviceDates[0]).toBe('20261019')
    const r = await build(startingOn(D), out)
    expect(r.modes.map((m) => [m.mode, m.quarantined])).toEqual([
      ['ferry', []],
      ['train', []],
      ['tram', []],
      ['bus', []],
    ])
    expect(r.coverage.start).toBe(D)
    expect(r.uncoveredDates).toEqual(['20261019'])
    // D−1 is left out of the generation, not published as an empty day.
    expect(r.serviceDates).toEqual([
      '20261020',
      '20261021',
      '20261022',
      '20261023',
      '20261024',
      '20261025',
      '20261026',
    ])
    const live = await readJsonFile<Manifest>(out, 'manifest.json')
    expect(live.quarantined).toEqual([])
    expect(live.modes.ferry?.current).toBe(r.modes[0]?.generation)
    expect(live.modes.ferry?.serviceDates).toEqual(r.serviceDates)
    const idx = await readJsonFile<GenerationIndex>(out, `static/${r.modes[0]?.generation}/ferry/index.json`)
    expect(Object.keys(idx.blobs)).toEqual(r.serviceDates)
    expect(Object.keys(idx.tripIndex ?? {})).toEqual(r.serviceDates)
    expect(idx.stats?.['20261019']).toBeUndefined()
  })

  it('without feed_start_date, the earliest calendar date with service is the start', async () => {
    const f = startingOn(D)
    setCell(f, 'feed_info.txt', 1, 3, '')
    const r = await build(f)
    expect(r.coverage).toEqual({ start: D, end: '20261231' })
    expect(r.uncoveredDates).toEqual(['20261019'])
    expect(
      feedCoverage(
        null,
        [
          {
            service_id: 'none',
            monday: '0',
            tuesday: '0',
            wednesday: '0',
            thursday: '0',
            friday: '0',
            saturday: '0',
            sunday: '0',
            start_date: '20261001',
            end_date: '20261231',
          },
          {
            service_id: 'a',
            monday: '1',
            tuesday: '0',
            wednesday: '0',
            thursday: '0',
            friday: '0',
            saturday: '0',
            sunday: '0',
            start_date: '20261020',
            end_date: '20261130',
          },
        ],
        [
          { service_id: 'b', date: '20261018', exception_type: '2' },
          { service_id: 'b', date: '20261205', exception_type: '1' },
        ],
      ),
    ).toEqual({ start: '20261020', end: '20261205' })
  })

  it('a real −100% drop on a date inside the new feed still quarantines', async () => {
    const out = await tmp()
    await build(baseFeed(), out)
    // The weekend ferry is gone from the new feed: Sat 24 and Sun 25 Oct lose their only ferry trip.
    const r = await build(
      withoutTrips(startingOn(D), (t) => t[2] === 'F1-we'),
      out,
    )
    const ferry = r.modes.find((m) => m.mode === 'ferry')
    expect(ferry?.quarantined).toContain('ferry 20261024: trip count 1 → 0 (-100%, limit ±20%)')
    expect(ferry?.quarantined).toContain('ferry 20261025: trip count 1 → 0 (-100%, limit ±20%)')
    expect(ferry?.quarantined.some((x) => x.includes('20261019'))).toBe(false)
    expect(r.uncoveredDates).toEqual(['20261019'])
    expect((await readJsonFile<Manifest>(out, 'manifest.json')).quarantined.map((q) => q.mode)).toEqual([
      'ferry',
    ])
  })

  it('a station losing service inside the new feed still quarantines', async () => {
    const out = await tmp()
    await build(baseFeed(), out)
    const f = startingOn(D)
    f['stop_times.txt'] = (f['stop_times.txt'] as string[][]).filter(
      (r) => r[3] !== '600100' && r[3] !== '600101',
    )
    const train = (await build(f, out)).modes.find((m) => m.mode === 'train')
    expect(train?.quarantined).toContain(
      "train 20261020: bowen-hills has no service and calendar_dates doesn't explain it",
    )
    expect(train?.quarantined.some((x) => x.includes('20261019'))).toBe(false)
  })

  it('a feed ending before D+6: dates after the end are skipped by the quarantine and reported', () => {
    const dates = [
      '20261019',
      '20261020',
      '20261021',
      '20261022',
      '20261023',
      '20261024',
      '20261025',
      '20261026',
    ]
    const coverage = { start: '20261001', end: '20261024' }
    expect(uncoveredDates(dates, coverage)).toEqual(['20261025', '20261026'])
    /** A generation with `inside` trips a day up to 24 Oct and `after` trips on 25 and 26 Oct (station a when > 0). */
    const mk = (inside: number, after: number): GenerationIndex => {
      const trips = (d: string) => (d > coverage.end ? after : inside)
      return {
        schemaVersion: 1,
        generation: 'g',
        mode: 'train',
        feedVersion: 'f',
        builtAt: '',
        serviceDates: dates,
        blobs: Object.fromEntries(
          dates.map((d) => [d, trips(d) ? { a: 'x' } : ({} as Record<string, string>)]),
        ),
        stats: Object.fromEntries(
          dates.map((d) => [d, { trips: trips(d), events: 0, stops: trips(d) ? 1 : 0 }]),
        ),
      }
    }
    const args = {
      mode: 'train' as const,
      previous: mk(10, 10),
      stationKeys: new Set(['a']),
      closureExplained: () => false,
    }
    // Without coverage the end looks like a total loss of service on 25 and 26 Oct.
    expect(quarantineReasons({ ...args, index: mk(10, 0) })).toHaveLength(4)
    expect(quarantineReasons({ ...args, index: mk(10, 0), coverage })).toEqual([])
    // A drop inside the validity still counts.
    expect(quarantineReasons({ ...args, index: mk(5, 0), coverage }).join('\n')).toMatch(
      /20261024: trip count 10 → 5/,
    )
    // The build itself still fails closed on such a feed: feed_end_date must be at least D+7.
    expect(checkFeedEndDate('20261024', '20261020')).toHaveLength(1)
  })

  it('a feed entirely outside the window fails closed', async () => {
    // Starts after the window (a wrong or future feed).
    expect((await structural(startingOn('20261028'))).join()).toMatch(
      /feed starts 20261028, after service date 20261020/,
    )
    // Starts tomorrow: today's boards would be empty, so this fails closed too.
    expect((await structural(startingOn('20261021'))).join()).toMatch(/doesn't cover today/)
    // Ended before the window (stale feed).
    const stale = baseFeed()
    setCell(stale, 'feed_info.txt', 1, 4, '20261015')
    expect((await structural(stale)).join()).toMatch(/feed_end_date 20261015 is before today\+7/)
  })

  it('golden facts still hold over the 7 covered days when D−1 is uncovered', async () => {
    // Synthetic trains run on weekdays only: 20–23 and 26 Oct, exactly the 5 days the facts need.
    const r = await runBuild({
      feedDir: await writeFeed(startingOn(D)),
      outDir: await tmp(),
      nowMs: NOW,
      modes: ['train'],
      golden: true,
    })
    expect(r.serviceDates).toHaveLength(7)
    // With D−1 uncovered, Central losing its stop_times rows is still caught.
    const f = withoutStopTimes(
      startingOn(D),
      (r, trip) => r[3]?.startsWith('6000') === true && trip[1] === 'WK',
    )
    await expect(
      runBuild({
        feedDir: await writeFeed(f),
        outDir: await tmp(),
        nowMs: NOW,
        modes: ['train'],
        golden: true,
      }),
    ).rejects.toThrow(/golden: Central station \(train central\) has service on 0 dates from 20261020/)
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

  it('without a previous generation, a weekend closure in the window is not flagged', () => {
    // 20261019 and 20261026 are both Mondays; the second has no service at b (trackwork-style calendar split).
    const next = idx({ '20261019': { trips: 5, keys: ['a', 'b'] }, '20261026': { trips: 5, keys: ['a'] } })
    expect(
      quarantineReasons({
        mode: 'train',
        index: next,
        previous: null,
        stationKeys: new Set(['a', 'b']),
        closureExplained: () => false,
      }),
    ).toEqual([])
  })
})

describe('gtfs-validator report gate', () => {
  it('fails only on ERROR notices', async () => {
    const { summarise } = await import('../src/validate/gtfs-validator.ts')
    const ok = summarise({
      notices: [
        { code: 'duplicate_route_name', severity: 'WARNING', totalNotices: 636 },
        { code: 'big_gap_in_service', severity: 'INFO', totalNotices: 3 },
      ],
    })
    expect(ok.errors).toEqual([])
    expect(ok.lines[0]).toBe('ERROR: none')
    const bad = summarise({
      notices: [{ code: 'foreign_key_violation', severity: 'ERROR', totalNotices: 2 }],
    })
    expect(bad.errors).toEqual(['foreign_key_violation (2)'])
  })
})

describe('checkGoldenLandmarks (closure-aware)', () => {
  const row = (service_id: string, days: string, start_date: string, end_date: string): CalendarRow => {
    const [monday, tuesday, wednesday, thursday, friday, saturday, sunday] = days.split('') as string[]
    return {
      service_id,
      monday,
      tuesday,
      wednesday,
      thursday,
      friday,
      saturday,
      sunday,
      start_date,
      end_date,
    } as CalendarRow
  }
  const dates = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))
  const dow = (d: string) => new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}T00:00:00Z`).getUTCDay()
  const BULIMBA: GoldenFact = { mode: 'ferry', key: '317584', label: 'Bulimba ferry terminal', minDays: 5 }
  const RIVERSIDE: GoldenFact = {
    mode: 'ferry',
    key: '317590',
    label: 'Riverside ferry terminal',
    minDays: 5,
  }
  const ATTESTED: AttestedClosure = {
    mode: 'ferry',
    key: '317584',
    from: '20261109',
    to: '20261213',
    source: 'notice',
  }

  // The real closure (feed 20261107-20270106, Bulimba closed 9 Nov–13 Dec): Mon–Thu service starts 14 Dec, Friday
  // service 18 Dec, weekend services removed by calendar_dates 14 Nov–13 Dec (Sunday added back on 25 Dec). CL is the
  // closure timetable: its trips run every day but don't board at Bulimba.
  const ROWS = [
    row('MT', '1111000', '20261214', '20270106'),
    row('FR', '0000100', '20261218', '20261218'),
    row('SA', '0000010', '20261107', '20270102'),
    row('SU', '0000001', '20261108', '20270103'),
    row('CL', '1111111', '20261107', '20270106'),
  ]
  const EXCEPTIONS: CalendarDateRow[] = [
    ...dates('20261114', 30).flatMap((date) =>
      dow(date) === 6
        ? [{ service_id: 'SA', date, exception_type: '2' }]
        : dow(date) === 0
          ? [{ service_id: 'SU', date, exception_type: '2' }]
          : [],
    ),
    { service_id: 'SU', date: '20261225', exception_type: '1' },
  ]
  const BULIMBA_SERVICES = new Set(['MT', 'FR', 'SA', 'SU'])

  interface Case {
    rows?: CalendarRow[]
    exceptions?: CalendarDateRow[]
    services?: Set<string>
    fact?: GoldenFact
    window?: string[]
    feedEnd?: string
    attested?: AttestedClosure[]
    served?: (date: string, byCalendar: boolean) => boolean
    routeRuns?: (date: string) => boolean
    previous?: (date: string) => 'served' | 'unserved' | undefined
  }
  const evidence = (calendar: ServiceCalendar, c: Case): LandmarkEvidence => {
    const services = c.services ?? BULIMBA_SERVICES
    const byCalendar = (d: string) => [...calendar.activeServices(d)].some((s) => services.has(s))
    return {
      fact: c.fact ?? BULIMBA,
      services,
      routes: new Set(['F1']),
      served: (d) => (c.served ? c.served(d, byCalendar(d)) : byCalendar(d)),
      routeRuns: c.routeRuns ?? (() => true),
      ...(c.previous ? { previous: c.previous } : {}),
    }
  }
  const check = (...cases: Case[]) => {
    const first = cases[0] as Case
    const rows = first.rows ?? ROWS
    const calendar = new ServiceCalendar(rows, first.exceptions ?? EXCEPTIONS)
    return checkGoldenLandmarks(
      cases.map((c) => evidence(calendar, c)),
      {
        calendar,
        calendarRows: rows,
        windowDates: first.window ?? dates('20261108', 8),
        feedEnd: first.feedEnd ?? '20270106',
        attested: first.attested ?? [],
      },
    )
  }
  /** The live 4 Nov generation (feed 20261103): service dates 3–10 Nov, no Bulimba stop-day on 9–10 Nov. */
  const LIVE_4_NOV = (d: string) => (d > '20261110' ? undefined : d >= '20261109' ? 'unserved' : 'served')

  it('the 9 Nov build: the earlier generation confirms 9–10 Nov, the weekday closure needs the attestation', () => {
    // 1 served + 2 confirmed by the live 4 Nov generation < 5. The 14–15 Nov removals show the closure is scheduled,
    // but don't count: one service's removal can't show another wasn't deleted.
    expect(check({ previous: LIVE_4_NOV })).toEqual([
      'golden: Bulimba ferry terminal (ferry 317584) has 1 served and 2 confirmed closed window dates, expected ≥ 5; ' +
        'closure scheduled but unconfirmed on 20261111 (MT), 20261112 (MT), 20261113 (FR), 20261114 (SA), 20261115 (SU) ' +
        "(the feed alone can't tell a closure from deleted stop_times: the live generation from an earlier feed or " +
        'an ATTESTED_CLOSURES entry confirms a date)',
    ])
    const notes: string[] = []
    const calendar = new ServiceCalendar(ROWS, EXCEPTIONS)
    expect(
      checkGoldenLandmarks([evidence(calendar, { previous: LIVE_4_NOV })], {
        calendar,
        calendarRows: ROWS,
        windowDates: dates('20261108', 8),
        feedEnd: '20270106',
        attested: [ATTESTED],
        note: (l) => notes.push(l),
      }),
    ).toEqual([])
    expect(notes.join()).toMatch(
      /24 service dates to 20270106, 1\/8 window dates served, closure confirmed on 20261109 \(MT; attested notice\), .*20261115 \(SU; attested notice\)$/,
    )
  })

  it('closure dates shown only by the calendar are not proof on their own', () => {
    expect(check({}).join('\n')).toMatch(
      /has 1 served and 0 confirmed closed window dates, expected ≥ 5; closure scheduled but unconfirmed on 20261109 \(MT\), .*20261115 \(SU\)/,
    )
    // A reviewed attestation confirms them, for every window of the closure and across the reopening.
    for (const start of ['20261108', '20261109', '20261120', '20261206', '20261213'])
      expect(check({ window: dates(start, 8), attested: [ATTESTED] })).toEqual([])
    // Only for its own landmark and dates.
    expect(check({ attested: [{ ...ATTESTED, key: '317590' }] })).toHaveLength(1)
    expect(check({ attested: [{ ...ATTESTED, to: '20261111' }] })).toHaveLength(1)
    expect(check({ attested: [{ ...ATTESTED, to: '20261112' }] })).toEqual([])
  })

  it("an attestation can't excuse what the calendar doesn't close, a lost stop-day or a missing reopening", () => {
    const attested = [{ ...ATTESTED, from: '20261101', to: '20270106' }]
    const daily = [row('D', '1111111', '20261101', '20270106')]
    expect(
      check({
        rows: daily,
        exceptions: [],
        services: new Set(['D']),
        attested,
        served: (d, cal) => cal && d !== '20261110',
      }),
    ).toEqual([
      'golden: Bulimba ferry terminal (ferry 317584) has a service boarding at it on 20261110, but the build has no stop-day there',
    ])
    const stripped = [
      row('D', '1111111', '20261101', '20270106'),
      row('W', '0000011', '20261101', '20270106'),
    ]
    // Five unscheduled weekdays, and only 3 served dates.
    expect(check({ rows: stripped, exceptions: [], services: new Set(['W']), attested })).toHaveLength(6)
    const ends = [row('D', '1111111', '20261101', '20261112')]
    expect(check({ rows: ends, exceptions: [], services: new Set(['D']), attested }).join()).toMatch(
      /none after it/,
    )
  })

  it('a healthy sibling landmark is still checked while the other is closed', () => {
    const sibling: Case = { fact: RIVERSIDE, services: new Set(['CL']) }
    expect(check({ attested: [ATTESTED] }, sibling)).toEqual([])
    const lostDay = { ...sibling, served: (d: string, cal: boolean) => cal && d !== '20261111' }
    expect(check({ attested: [ATTESTED] }, lostDay)).toEqual([
      'golden: Riverside ferry terminal (ferry 317590) has a service boarding at it on 20261111, but the build has no stop-day there',
    ])
  })

  it('the landmark removed from the whole feed fails', () => {
    expect(check({ services: new Set(), attested: [ATTESTED] }).join()).toMatch(
      /Bulimba ferry terminal \(ferry 317584\) has service on 0 dates from 20261108 to the feed end 20270106, expected ≥ 5/,
    )
  })

  it('a truncated feed with four days of service left fails', () => {
    const rows = [row('D', '1111111', '20261101', '20261111')]
    expect(check({ rows, exceptions: [], services: new Set(['D']), feedEnd: '20261111' }).join()).toMatch(
      /has service on 4 dates from 20261108 to the feed end 20261111, expected ≥ 5/,
    )
  })

  it('service that ends in the window without reopening fails, even with ≥ 5 dates', () => {
    const rows = [row('D', '1111111', '20261101', '20261112')]
    expect(check({ rows, exceptions: [], services: new Set(['D']) })).toEqual(
      ['20261113', '20261114', '20261115'].map(
        (d) =>
          `golden: Bulimba ferry terminal (ferry 317584) has no service on ${d} and none after it: a closure must reopen within the feed`,
      ),
    )
  })

  it('an expected in-window stop-day missing from the build fails', () => {
    expect(check({ attested: [ATTESTED], served: (d, cal) => cal && d !== '20261108' })).toEqual([
      'golden: Bulimba ferry terminal (ferry 317584) has a service boarding at it on 20261108, but the build has no stop-day there',
    ])
  })

  it("stripping the landmark's stop_times rows can't pass as a closure", () => {
    // A daily landmark served by D (every day) and W (weekends): D's trips lose their landmark rows, so D no longer
    // counts as a landmark service. The route still runs on weekdays and no landmark service closes those days.
    const rows = [row('D', '1111111', '20261101', '20270106'), row('W', '0000011', '20261101', '20270106')]
    expect(check({ rows, exceptions: [], services: new Set(['W']) })).toEqual([
      ...['20261109', '20261110', '20261111', '20261112', '20261113'].map(
        (d) =>
          `golden: Bulimba ferry terminal (ferry 317584) has no service on ${d} and the calendar doesn't schedule a closure`,
      ),
      'golden: Bulimba ferry terminal (ferry 317584) has 3 served and 0 confirmed closed window dates, expected ≥ 5',
    ])
    // With a later weekday timetable still serving it (X from 1 Dec) the gap looks like a delayed start, but nothing
    // confirms those dates: it fails, with or without the route running, and next to genuine weekend removals.
    const later = [...rows, row('X', '1111100', '20261201', '20270106')]
    const services = new Set(['W', 'X'])
    const weekendRemovals = ['20261108', '20261114', '20261115'].map((date) => ({
      service_id: 'W',
      date,
      exception_type: '2',
    }))
    for (const c of [{ routeRuns: () => true }, { routeRuns: () => false }, { exceptions: weekendRemovals }])
      expect(check({ rows: later, exceptions: [], services, ...c }).join('\n')).toMatch(
        /closure scheduled but unconfirmed on (20261108 \(W\), )?20261109 \(X\), 20261110 \(X\), 20261111 \(X\), 20261112 \(X\), 20261113 \(X\)/,
      )
  })

  it("one service's cancellations can't confirm dates another service's deleted calls left empty", () => {
    // A and B both serve the landmark daily; B is genuinely cancelled on four dates. A's landmark calls are deleted,
    // so those four dates are empty and look like B's scheduled closure: 4 served, 0 confirmed.
    const rows = [row('A', '1111111', '20261101', '20270106'), row('B', '1111111', '20261101', '20270106')]
    const exceptions = ['20261109', '20261110', '20261111', '20261112'].map((date) => ({
      service_id: 'B',
      date,
      exception_type: '2',
    }))
    for (const previous of [undefined, () => 'served' as const])
      expect(
        check({ rows, exceptions, services: new Set(['B']), ...(previous ? { previous } : {}) }),
      ).toEqual([
        'golden: Bulimba ferry terminal (ferry 317584) has 4 served and 0 confirmed closed window dates, expected ≥ 5; ' +
          'closure scheduled but unconfirmed on 20261109 (B), 20261110 (B), 20261111 (B), 20261112 (B) ' +
          "(the feed alone can't tell a closure from deleted stop_times: the live generation from an earlier feed or " +
          'an ATTESTED_CLOSURES entry confirms a date)',
      ])
  })

  it('weekday calls deleted from a weekday-only route still fail the five-date floor', () => {
    // Only the weekend route's calls survive, so weekdays aren't even expected: 3 served dates are still too few.
    const rows = [row('WD', '1111100', '20261101', '20270106'), row('WE', '0000011', '20261101', '20270106')]
    const weekend = (d: string) => dow(d) === 0 || dow(d) === 6
    expect(check({ rows, exceptions: [], services: new Set(['WE']), routeRuns: weekend })).toEqual([
      'golden: Bulimba ferry terminal (ferry 317584) has 3 served and 0 confirmed closed window dates, expected ≥ 5',
    ])
  })

  it('dates the live generation served are not confirmed closed; an attestation is', () => {
    const rows = [row('D', '1111111', '20261101', '20270106'), row('X', '1111111', '20261201', '20270106')]
    const served = () => 'served' as const
    expect(check({ rows, exceptions: [], services: new Set(['X']), previous: served }).join('\n')).toMatch(
      /has 0 served and 0 confirmed closed window dates, expected ≥ 5; closure scheduled but unconfirmed on 20261108 \(X\)/,
    )
    const attested = [{ ...ATTESTED, from: '20261101', to: '20261130' }]
    expect(check({ rows, exceptions: [], services: new Set(['X']), previous: served, attested })).toEqual([])
    // And dates it didn't serve, from an earlier feed, are.
    expect(check({ rows, exceptions: [], services: new Set(['X']), previous: () => 'unserved' })).toEqual([])
  })

  it('unconfirmed closure dates are tolerated while ≥ 5 window dates are served or confirmed (the old rule)', () => {
    // A daily landmark whose Saturday service starts a week late: one unconfirmed date, seven served.
    const rows = [row('WD', '1111101', '20261101', '20270106'), row('SA', '0000010', '20261115', '20270106')]
    expect(check({ rows, exceptions: [], services: new Set(['WD', 'SA']) })).toEqual([])
  })

  it('a type-2 removal of a daily service confirms that day', () => {
    const rows = [row('D', '1111111', '20261101', '20270106')]
    const exceptions = [{ service_id: 'D', date: '20261111', exception_type: '2' }]
    expect(check({ rows, exceptions, services: new Set(['D']) })).toEqual([])
    expect(
      check({ rows, exceptions, services: new Set(['D']), served: (d, cal) => cal && d !== '20261112' }),
    ).toHaveLength(1)
  })

  it('a type-1 added date counts as service and must be built', () => {
    const exceptions = [...EXCEPTIONS, { service_id: 'SU', date: '20261111', exception_type: '1' }]
    expect(check({ exceptions, attested: [ATTESTED] })).toEqual([])
    expect(check({ exceptions, attested: [ATTESTED], served: (d, cal) => cal && d !== '20261111' })).toEqual([
      'golden: Bulimba ferry terminal (ferry 317584) has a service boarding at it on 20261111, but the build has no stop-day there',
    ])
  })

  it("a weekday the landmark never runs and its routes don't run isn't expected", () => {
    const rows = [row('D', '1111110', '20261101', '20270106')]
    expect(
      check({
        rows,
        exceptions: [],
        services: new Set(['D']),
        routeRuns: (d) => d !== '20261108' && d !== '20261115',
      }),
    ).toEqual([])
    // But if a route does run that Sunday, the gap must be a scheduled closure.
    expect(check({ rows, exceptions: [], services: new Set(['D']) })).toHaveLength(2)
  })
})

describe('golden landmarks in the build (synthetic SEQ-shaped feed)', () => {
  const dates = (from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i))
  /** The synthetic ferries only alight at Riverside; add a return trip each day so it has stop-days, as in SEQ. */
  const withRiversideBoarding = (f: SynthFeed) => {
    for (const sid of ['WK', 'WE']) {
      f['trips.txt']?.push(['F1-1', sid, `F1-back-${sid}`, 'Hawthorne', '0', '', ''])
      f['stop_times.txt']?.push(
        [`F1-back-${sid}`, '12:00:00', '12:00:00', '317590', '10', '0', '0'],
        [`F1-back-${sid}`, '12:10:00', '12:10:00', '317586', '20', '0', '0'],
      )
    }
    return f
  }
  const build = (feed: SynthFeed, modes: Mode[], extra: Partial<BuildOptions> = {}) =>
    writeFeed(feed).then(async (feedDir) =>
      runBuild({ feedDir, outDir: await tmp(), nowMs: NOW, modes, golden: true, ...extra }),
    )
  /**
   * Bulimba closed for the window (19–26 Oct): its F1/F11 trips move to services starting 2 Nov (weekdays) and to
   * weekend service removed on 24/25 Oct; copies of the F1 trips that skip Bulimba keep the route running.
   */
  const closedBulimba = () => {
    const f = withRiversideBoarding(baseFeed())
    f['calendar.txt']?.push(['WKB', '1', '1', '1', '1', '1', '0', '0', '20261102', '20261231'])
    f['calendar.txt']?.push(['WEB', '0', '0', '0', '0', '0', '1', '1', '20261001', '20261231'])
    f['calendar_dates.txt']?.push(['WEB', '20261024', '2'], ['WEB', '20261025', '2'])
    const trips = f['trips.txt'] as string[][]
    const st = f['stop_times.txt'] as string[][]
    for (const t of trips.slice(1)) {
      if (!(t[0] as string).startsWith('F')) continue
      if (!st.some((r) => r[0] === t[2] && r[3] === '317584')) continue
      const skip = [...t]
      skip[2] = `${t[2]}-skip`
      trips.push(skip)
      for (const r of st.filter((r) => r[0] === t[2] && r[3] !== '317584')) st.push([skip[2], ...r.slice(1)])
      t[1] = t[1] === 'WK' ? 'WKB' : 'WEB'
    }
    return f
  }
  const BULIMBA_OCT: AttestedClosure = {
    mode: 'ferry',
    key: '317584',
    from: '20261019',
    to: '20261101',
    source: 'test',
  }

  it('an attested closure of Bulimba passes, Riverside stays checked; unattested it fails closed', async () => {
    const r = await build(closedBulimba(), ['ferry'], { attestedClosures: [BULIMBA_OCT] })
    expect(r.modes.map((m) => [m.mode, m.quarantined])).toEqual([['ferry', []]])
    await expect(build(closedBulimba(), ['ferry'], { attestedClosures: [] })).rejects.toThrow(
      /Bulimba ferry terminal \(ferry 317584\) has 0 served and 0 confirmed closed window dates, expected ≥ 5; closure scheduled but unconfirmed on 20261019 \(WKB\)/,
    )
  })

  it("Bulimba's stop_times rows deleted can't pass as a closure, attested or not", async () => {
    const f = withoutStopTimes(
      withRiversideBoarding(baseFeed()),
      (r, trip) => r[3] === '317584' && trip[1] === 'WK',
    )
    await expect(build(f, ['ferry'], { attestedClosures: [BULIMBA_OCT] })).rejects.toThrow(
      /golden: Bulimba ferry terminal \(ferry 317584\) has no service on 20261019 and the calendar doesn't schedule a closure/,
    )
  })

  it('Bulimba removed from the whole feed fails', async () => {
    await expect(
      build(
        withoutStopTimes(withRiversideBoarding(baseFeed()), (r) => r[3] === '317584'),
        ['ferry'],
      ),
    ).rejects.toThrow(/Bulimba ferry terminal \(ferry 317584\) has service on 0 dates/)
  })

  it('the closure is only reopened after the feed ends: fails', async () => {
    const f = closedBulimba()
    for (const r of f['calendar.txt'] as string[][]) if (r[0] === 'WKB') r[8] = '20270101'
    f['calendar_dates.txt']?.push(...dates('20261001', 92).flatMap((d) => [['WEB', d, '2']]))
    await expect(build(f, ['ferry'], { attestedClosures: [BULIMBA_OCT] })).rejects.toThrow(
      /Bulimba ferry terminal \(ferry 317584\) has service on 0 dates/,
    )
  })

  /**
   * Central closed for the whole window: every train trip that touches it moves to WKX (weekdays from 28 Oct), and
   * copies that call at a stand-in stop (1001) instead keep the line running, so no window trip gives Central its
   * station key and the other stations keep their boardings.
   */
  const closedCentral = () => {
    const f = baseFeed()
    f['calendar.txt']?.push(['WKX', '1', '1', '1', '1', '1', '0', '0', '20261028', '20261231'])
    const central = new Set(['600016', '600017'])
    const trips = f['trips.txt'] as string[][]
    const st = f['stop_times.txt'] as string[][]
    for (const t of trips.slice(1)) {
      if (!st.some((r) => r[0] === t[2] && central.has(r[3] as string))) continue
      const skip = [...t]
      skip[2] = `${t[2]}-skip`
      trips.push(skip)
      for (const r of st.filter((r) => r[0] === t[2]))
        st.push([skip[2], r[1], r[2], central.has(r[3] as string) ? '1001' : r[3], ...r.slice(4)] as string[])
      t[1] = 'WKX'
    }
    return f
  }
  const CENTRAL_OCT: AttestedClosure = {
    mode: 'train',
    key: 'central',
    from: '20261001',
    to: '20261027',
    source: 'test',
  }
  const trainBuild = (feed: SynthFeed, outDir: string, attestedClosures: AttestedClosure[]) =>
    writeFeed(feed).then((feedDir) =>
      runBuild({ feedDir, outDir, nowMs: NOW, modes: ['train'], golden: true, attestedClosures }),
    )

  it('a station closed for the whole window is still matched by name and checked against the whole feed', async () => {
    const r = await trainBuild(closedCentral(), await tmp(), [CENTRAL_OCT])
    expect(r.modes.map((m) => m.mode)).toEqual(['train'])
    await expect(trainBuild(closedCentral(), await tmp(), [])).rejects.toThrow(
      /Central station \(train central\) has 0 served and 0 confirmed closed window dates, expected ≥ 5; closure scheduled but unconfirmed on 20261019 \(WKX\)/,
    )
  })

  it('the live generation from an earlier feed confirms the dates it covers; a rebuild of this feed never does', async () => {
    // An earlier feed (its start date differs), its closure attested, goes live first.
    const out = await tmp()
    const earlier = closedCentral()
    setCell(earlier, 'feed_info.txt', 1, 3, '20261002')
    await trainBuild(earlier, out, [CENTRAL_OCT])
    // This feed, unattested: the live generation covers 19–26 Oct with no Central stop-day.
    const r = await trainBuild(closedCentral(), out, [])
    expect(r.modes.map((m) => m.mode)).toEqual(['train'])
    // Now the live generation is this feed's own: a rebuild over it, unattested, has no evidence.
    await expect(trainBuild(closedCentral(), out, [])).rejects.toThrow(
      /closure scheduled but unconfirmed on 20261019/,
    )
  })
})
