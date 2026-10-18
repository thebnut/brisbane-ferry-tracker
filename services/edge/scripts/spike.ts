/**
 * Phase 0 spike: CPU per RtHub alarm cycle (decode + match + snapshot build + serialise), per feed layout, and
 * memory for two service days of trip indexes. Workers freeze Date.now() during execution, so CPU is measured
 * here in Node (same V8, same code path: src/rt/build.ts) with process.cpuUsage() and performance.now().
 *
 *   node --expose-gc scripts/spike.ts [--gtfs /tmp/bft-gtfs/x] [--dates 20261017,20261018] [--fresh] [--runs 40]
 *
 * Feeds: the sample protobufs in /tmp/bft-gtfs (Saturday 18 Oct ~13:44 AEST), or --fresh to fetch them now.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { Mode, TripIndexDay } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { type FeedMessage, FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { buildAlerts, buildSnapshot, ModeIndex } from '../src/rt/build.ts'
import { FEED_MODE_SUFFIX, MODES } from '../src/rt/feeds.ts'
import { buildTripIndexes } from './lib/gtfs-trip-index.ts'

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? '') : def
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const GTFS = arg('gtfs', '/tmp/bft-gtfs/x') as string
const DATES = (arg('dates', '20261017,20261018') as string).split(',')
const RUNS = Number(arg('runs', '40'))
const CACHE = arg('cache', join(process.env.TMPDIR ?? '/tmp', 'bft-spike-cache')) as string
const UPSTREAM = 'https://gtfsrt.api.translink.com.au/api/realtime/SEQ'

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {})
const heap = () => {
  gc()
  gc()
  return process.memoryUsage().heapUsed
}
const unzipMaybe = (b: Buffer) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : b)

async function loadIndexes(): Promise<Map<string, TripIndexDay>> {
  const file = join(CACHE, `trip-index-${DATES.join('-')}.json`)
  if (existsSync(file)) return new Map(JSON.parse(await readFile(file, 'utf8')))
  const t0 = performance.now()
  const m = await buildTripIndexes(GTFS, DATES)
  console.error(`built trip indexes in ${Math.round(performance.now() - t0)} ms`)
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, JSON.stringify([...m]))
  return m
}

async function feedBytes(key: string, sample: string | undefined): Promise<Uint8Array> {
  if (flag('fresh') || !sample || !existsSync(sample)) {
    const res = await fetch(`${UPSTREAM}/${key}`)
    if (!res.ok) throw new Error(`${key}: HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  }
  return unzipMaybe(await readFile(sample))
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number
}

interface Layout {
  name: string
  modes: Mode[]
  tu: Array<{ mode?: Mode; bytes: Uint8Array }>
  vp: Array<{ mode?: Mode; bytes: Uint8Array }>
}

async function main() {
  const days = await loadIndexes()
  const al = await feedBytes('alerts', '/tmp/bft-gtfs/al.pb')

  // Memory: two service days of trip indexes per mode, as the hub holds them (parsed JSON + matcher maps).
  const memory: Record<string, { trips: number; jsonMB: number; heapMB: number }> = {}
  const indexes: Partial<Record<Mode, ModeIndex>> = {}
  for (const mode of MODES) {
    const json = DATES.map((d) => JSON.stringify(days.get(`${mode}|${d}`) ?? null))
    const before = heap()
    const parsed = json
      .map((j) => JSON.parse(j) as TripIndexDay | null)
      .filter((x): x is TripIndexDay => x != null)
    const idx = new ModeIndex(mode, parsed)
    const after = heap()
    indexes[mode] = idx
    memory[mode] = {
      trips: idx.matcher.size,
      jsonMB: +(json.reduce((a, j) => a + j.length, 0) / 1e6).toFixed(2),
      heapMB: +((after - before) / 1e6).toFixed(1),
    }
  }

  const combinedTu = await feedBytes('TripUpdates', '/tmp/bft-gtfs/tu.pb')
  const combinedVp = await feedBytes('VehiclePositions', '/tmp/bft-gtfs/vp.pb')
  const perMode = async (kind: string, mode: Mode) =>
    feedBytes(`${kind}/${FEED_MODE_SUFFIX[mode]}`, `/tmp/bft-gtfs/rt/${kind}_${FEED_MODE_SUFFIX[mode]}.pb`)

  const layouts: Layout[] = [
    {
      name: 'combined (all modes)',
      modes: [...MODES],
      tu: [{ bytes: combinedTu }],
      vp: [{ bytes: combinedVp }],
    },
  ]
  for (const set of [
    ['ferry'],
    ['train'],
    ['ferry', 'train'],
    ['ferry', 'train', 'tram'],
    ['bus'],
    [...MODES],
  ] as Mode[][]) {
    layouts.push({
      name: `per-mode ${set.join('+')}`,
      modes: set,
      tu: await Promise.all(set.map(async (m) => ({ mode: m, bytes: await perMode('TripUpdates', m) }))),
      vp: await Promise.all(set.map(async (m) => ({ mode: m, bytes: await perMode('VehiclePositions', m) }))),
    })
  }

  const alertsFeed = fromBinary(FeedMessageSchema, al)
  const results = []
  for (const L of layouts) {
    const idx: Partial<Record<Mode, ModeIndex>> = {}
    for (const m of L.modes) idx[m] = indexes[m]
    const cpu = {
      decode: [] as number[],
      build: [] as number[],
      serialise: [] as number[],
      total: [] as number[],
    }
    let out: ReturnType<typeof buildSnapshot> | null = null
    let json = ''
    let entities = 0
    let stopUpdates = 0
    for (let run = 0; run < RUNS + 5; run++) {
      const c0 = process.cpuUsage()
      const tu: Array<{ mode?: Mode; feed: FeedMessage }> = L.tu.map((f) => ({
        mode: f.mode,
        feed: fromBinary(FeedMessageSchema, f.bytes),
      }))
      const vp: Array<{ mode?: Mode; feed: FeedMessage }> = L.vp.map((f) => ({
        mode: f.mode,
        feed: fromBinary(FeedMessageSchema, f.bytes),
      }))
      const c1 = process.cpuUsage(c0)
      out = buildSnapshot({
        seq: run,
        nowMs: Number(tu[0]?.feed.header?.timestamp ?? 0n) * 1000,
        indexes: idx,
        tripUpdates: tu,
        vehiclePositions: vp,
        alerts: buildAlerts(alertsFeed),
        previous: out?.snapshot,
      })
      const c2 = process.cpuUsage(c0)
      json = JSON.stringify(out.snapshot)
      const c3 = process.cpuUsage(c0)
      if (run >= 5) {
        const ms = (u: NodeJS.CpuUsage) => (u.user + u.system) / 1000
        cpu.decode.push(ms(c1))
        cpu.build.push(ms(c2) - ms(c1))
        cpu.serialise.push(ms(c3) - ms(c2))
        cpu.total.push(ms(c3))
      }
      if (run === 0) {
        entities = tu.reduce((a, f) => a + f.feed.entity.length, 0)
        stopUpdates = tu.reduce(
          (a, f) => a + f.feed.entity.reduce((b, e) => b + (e.tripUpdate?.stopTimeUpdate.length ?? 0), 0),
          0,
        )
      }
    }
    const snap = out?.snapshot
    const gz = (await import('node:zlib')).gzipSync(json).length
    results.push({
      layout: L.name,
      bytes: {
        tu: L.tu.reduce((a, f) => a + f.bytes.length, 0),
        vp: L.vp.reduce((a, f) => a + f.bytes.length, 0),
      },
      entities,
      stopUpdates,
      snapshot: {
        trips: Object.keys(snap?.trips ?? {}).length,
        vehicles: snap?.vehicles.length,
        jsonKB: Math.round(json.length / 1024),
        gzKB: Math.round(gz / 1024),
      },
      stats: snap?.header.stats,
      cpuMs: Object.fromEntries(
        Object.entries(cpu).map(([k, v]) => [
          k,
          { p50: +pct(v, 50).toFixed(2), p95: +pct(v, 95).toFixed(2) },
        ]),
      ),
      weekdayPeakEstimateMs: +(pct(cpu.total, 50) * 2).toFixed(1),
    })
  }

  const report = {
    at: new Date().toISOString(),
    node: process.version,
    dates: DATES,
    runs: RUNS,
    fresh: flag('fresh'),
    memory,
    results,
  }
  console.log(JSON.stringify(report, null, 2))
}

await main()
