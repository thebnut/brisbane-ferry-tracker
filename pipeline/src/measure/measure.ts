/**
 * Phase 0 measurements (transit-architecture.md §5 "Phase 0 measurements"):
 *   pnpm --filter @bft/pipeline measure --gtfs /tmp/bft-gtfs/x --date 20261020
 * Builds the real feed twice (D, then D+1 into the same directory, as the next day's run would), and benchmarks three
 * storage layouts: per-stop blobs (built), grouped shards (built, bus), and pattern + trip-times (computed here).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { brotliCompressSync, constants } from 'node:zlib'
import type { Mode } from '@bft/core'
import { addDays, shardOf } from '@bft/core'
import { gzipJson, sha256Hex } from '../build/blobs.ts'
import { ALL_MODES, type BuildResult, runBuild } from '../build/build.ts'
import { activeTrips, headsignOf } from '../build/stop-days.ts'
import type { Feed, TripRow } from '../feed/load.ts'
import { resolveFeed } from '../feed/source.ts'
import { publish } from '../publish/publish.ts'
import { DirTarget } from '../publish/targets.ts'

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    gtfs: { type: 'string', default: '/tmp/bft-gtfs/x' },
    date: { type: 'string', default: '20261020' },
  },
})
const D = values.date as string

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0
}
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`
const br = (s: string) => brotliCompressSync(s, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length

interface Sample {
  key: string
  gz: number
  br?: number
  raw: number
  hashNoDate: string
  isNew: boolean
}
const samples = new Map<string, Sample[]>() // `${mode}|${date}`

const work = await mkdtemp(join(tmpdir(), 'bft-measure-'))
const feed = await resolveFeed(values.gtfs, work)
const outDir = join(work, 'out')

const t0 = performance.now()
const res: BuildResult = await runBuild({
  feedDir: feed.dir,
  outDir,
  nowMs: Date.parse(`${D.slice(0, 4)}-${D.slice(4, 6)}-${D.slice(6, 8)}T03:15:00+10:00`),
  date: D,
  onStopDay: ({ mode, date, key, json, gzBytes, isNew }) => {
    const k = `${mode}|${date}`
    const list = samples.get(k) ?? []
    list.push({
      key,
      gz: gzBytes,
      raw: json.length,
      hashNoDate: sha256Hex(json.replace(/"serviceDate":"\d{8}",/, '')),
      isNew,
      ...(date === D ? { br: br(json) } : {}),
    })
    samples.set(k, list)
  },
})
const buildSecs = (performance.now() - t0) / 1000
const rssMb = process.resourceUsage().maxRSS / 1024

// First-run publish to an empty target: every file is a Class A PUT.
const first = await publish(outDir, new DirTarget(join(work, 'target')))

// The next day's run, same feed, into the same directory.
const t1 = performance.now()
const next = await runBuild({
  feedDir: feed.dir,
  outDir,
  nowMs: Date.parse(`${D.slice(0, 4)}-${D.slice(4, 6)}-${D.slice(6, 8)}T03:15:00+10:00`) + 86_400_000,
  date: addDays(D, 1),
  previous: new DirTarget(outDir),
})
const nextSecs = (performance.now() - t1) / 1000
const second = await publish(outDir, new DirTarget(join(work, 'target')))

const lines: string[] = []
const out = (s = '') => lines.push(s)

out(`Feed ${res.feedVersion}, service date D = ${D}, window ${res.serviceDates[0]}..${res.serviceDates[7]}.`)
out(
  `Build: ${buildSecs.toFixed(1)} s wall, peak RSS ${rssMb.toFixed(0)} MB (this process, incl. the measurement hooks).`,
)
out()
out(
  '| Mode | Stop-day files on D | gz total (D) | br total (D) | br vs gz | median gz | p95 gz | max gz | gz total, 8 days |',
)
out('|---|---|---|---|---|---|---|---|---|')
for (const mode of ALL_MODES) {
  const day = samples.get(`${mode}|${D}`) ?? []
  const gz = day.map((s) => s.gz)
  const gzTot = gz.reduce((a, b) => a + b, 0)
  const brTot = day.reduce((a, s) => a + (s.br ?? 0), 0)
  const all8 = res.serviceDates
    .flatMap((d) => samples.get(`${mode}|${d}`) ?? [])
    .reduce((a, s) => a + s.gz, 0)
  out(
    `| ${mode} | ${day.length} | ${mb(gzTot)} | ${mb(brTot)} | ${(((brTot - gzTot) / gzTot) * 100).toFixed(0)}% | ${kb(q(gz, 0.5))} | ${kb(q(gz, 0.95))} | ${kb(Math.max(...gz))} | ${mb(all8)} |`,
  )
}
out()

// Dedupe across the 8 days.
let files8 = 0
let distinctNoDate = 0
const tripIdxFiles = res.serviceDates.length * res.modes.length
for (const mode of ALL_MODES) {
  const all = res.serviceDates.flatMap((d) => samples.get(`${mode}|${d}`) ?? [])
  files8 += all.length
  distinctNoDate += new Set(all.map((s) => `${mode}|${s.hashNoDate}`)).size
}
out(
  `Files: ${files8} stop-day blobs + ${tripIdxFiles} trip indexes over 8 days (${Math.round(files8 / 8)} stop-days a day).`,
)
out(
  `Distinct blobs after dedupe: ${files8} (every blob carries its serviceDate, so no two days share one). ` +
    `Without the serviceDate field: ${distinctNoDate} (${((1 - distinctNoDate / files8) * 100).toFixed(0)}% fewer).`,
)
out(
  `R2 Class A per run: first run ${first.puts} PUTs (${mb(first.bytes)}); next day's run on the same feed ${second.puts} PUTs ` +
    `(${second.skipped} of ${second.checks} content files already present; Class B HEADs = ${second.checks}). ` +
    `Next-day build ${nextSecs.toFixed(1)} s, ${next.blobsWritten} new blobs.`,
)
out()

// Layout benchmark (bus on D, the hard case; other modes are small enough that the layout barely matters).
const busIndex = res.modes.find((m) => m.mode === 'bus')?.index
const busDay = samples.get(`bus|${D}`) ?? []
const shardHashes = new Map<string, number>()
if (busIndex) {
  const { statSync } = await import('node:fs')
  for (const sha of busIndex.shards?.byDate[D] ?? [])
    if (sha && !shardHashes.has(sha))
      shardHashes.set(sha, statSync(join(outDir, `static/shards/${sha}.json.gz`)).size)
}
const shardSizes = [...shardHashes.values()]
const shardTot = shardSizes.reduce((a, b) => a + b, 0)
const perStopRead = busDay.reduce((a, s) => a + s.gz, 0) / Math.max(1, busDay.length)
// Stop-weighted mean of the shard a bus lookup has to read (keys from the build hook: bus has no per-stop blob map).
const busKeys = busDay.map((x) => x.key)
const shardRead = busIndex?.shards
  ? busKeys.reduce((a, key) => {
      const sha = busIndex.shards?.byDate[D]?.[shardOf(key, busIndex.shards?.count ?? 1)]
      return a + (sha ? (shardHashes.get(sha) ?? 0) : 0)
    }, 0) / Math.max(1, busKeys.length)
  : 0

const pt = patternTripTimes(res.feed, 'bus', D, res)
out(
  '| Layout (bus, one day) | Files a day | Total gz | Bytes read per stop lookup (mean) | Largest single read | Notes |',
)
out('|---|---|---|---|---|---|')
out(
  `| Per-stop blobs (built) | ${busDay.length} | ${mb(busDay.reduce((a, s) => a + s.gz, 0))} | ${kb(perStopRead)} | ${kb(Math.max(...busDay.map((s) => s.gz)))} | One GET per board; content-addressed, trivially cacheable |`,
)
out(
  `| Grouped shards (built, ${shardSizes.length} a day) | ${shardSizes.length} | ${mb(shardTot)} | ${kb(shardRead)} | ${kb(Math.max(...shardSizes))} | Fits the 20k-file assets limit; a shard changes when any member changes |`,
)
out(
  `| Pattern + trip-times (computed) | ${pt.stopFiles} + 2 | ${mb(pt.total)} | ${kb(pt.meanStop)} + ${kb(pt.shared)} shared | ${kb(pt.maxStop)} + ${kb(pt.shared)} | Stop files drop downstream; client needs the day's pattern and time tables (${kb(pt.patterns)} + ${kb(pt.times)}) |`,
)
out()
console.log(lines.join('\n'))
await rm(work, { recursive: true, force: true })

/**
 * "Pattern + trip-times": per mode-day, a table of distinct stop patterns (stop ids + drop-off rules), a table of
 * distinct time profiles (arrival/departure offsets from the trip's first departure), and per-stop files whose
 * events reference [tripIdx, patternIdx, position, profileIdx, depS, routeIdx, headsignIdx, pickup, dir].
 */
function patternTripTimes(feed: Feed, mode: Mode, date: string, r: BuildResult) {
  const st = feed.stopTimes
  const trips = activeTrips(feed, mode, feed.calendar.activeServices(date))
  const patterns = new Map<string, number>()
  const profiles = new Map<string, number>()
  const tripMeta = new Map<number, { p: number; t: number }>()
  for (const ti of trips) {
    const t = feed.trips[ti] as TripRow
    const stops: Array<string | number> = []
    const times: number[] = []
    const base = st.dep[t.start] as number
    for (let k = t.start; k < t.start + t.count; k++) {
      stops.push(
        (feed.stops[st.stop[k] as number] as { id: string }).id,
        st.dropOff[k] as number,
        st.pickup[k] as number,
      )
      times.push((st.arr[k] as number) - base, (st.dep[k] as number) - base)
    }
    const pk = JSON.stringify(stops)
    const tk = JSON.stringify(times)
    if (!patterns.has(pk)) patterns.set(pk, patterns.size)
    if (!profiles.has(tk)) profiles.set(tk, profiles.size)
    tripMeta.set(ti, { p: patterns.get(pk) as number, t: profiles.get(tk) as number })
  }
  const patternsGz = gzipJson(`[${[...patterns.keys()].join(',')}]`).length
  const timesGz = gzipJson(`[${[...profiles.keys()].join(',')}]`).length
  const byStop = new Map<string, Array<number[]>>()
  for (const ti of trips) {
    const t = feed.trips[ti] as TripRow
    const m = tripMeta.get(ti) as { p: number; t: number }
    for (let k = t.start; k < t.start + t.count - 1; k++) {
      if (st.pickup[k] === 1) continue
      const key = r.keys.keyOf(mode, st.stop[k] as number)
      const list = byStop.get(key) ?? []
      list.push([ti, m.p, k - t.start, m.t, st.dep[k] as number])
      byStop.set(key, list)
    }
  }
  const sizes: number[] = []
  for (const [, evs] of byStop) {
    evs.sort((a, b) => (a[4] as number) - (b[4] as number))
    const tripIds: string[] = []
    const heads: string[] = []
    const rows = evs.map(([ti, p, pos, prof, dep]) => {
      const t = feed.trips[ti as number] as TripRow
      let tIdx = tripIds.indexOf(t.id)
      if (tIdx < 0) tIdx = tripIds.push(t.id) - 1
      const h = headsignOf(feed, t)
      let hIdx = heads.indexOf(h)
      if (hIdx < 0) hIdx = heads.push(h) - 1
      return [tIdx, p, pos, prof, dep, hIdx, t.directionId]
    })
    sizes.push(gzipJson(JSON.stringify({ trips: tripIds, headsigns: heads, events: rows })).length)
  }
  const stopTotal = sizes.reduce((a, b) => a + b, 0)
  return {
    stopFiles: sizes.length,
    patterns: patternsGz,
    times: timesGz,
    shared: patternsGz + timesGz,
    total: stopTotal + patternsGz + timesGz,
    meanStop: stopTotal / Math.max(1, sizes.length),
    maxStop: Math.max(...sizes),
  }
}
