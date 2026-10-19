/**
 * Cold-start index load: CPU and memory of a fresh RtHub's first cycles, with every mode's real trip indexes
 * (RT_INDEX_MODES=ferry,train,tram,bus) served as gzip blobs through a real StaticStore, as from R2.
 *
 *   node --expose-gc --experimental-transform-types scripts/coldload.ts [--gtfs /tmp/bft-gtfs/x] [--feeds /tmp/bft-gtfs] \
 *     [--dates 20261020,20261021] [--runs 3]
 *
 * Each run is a fresh child process (like a fresh DO isolate) whose hub restores a snapshot from storage (one a fully
 * loaded hub built from the same feeds) and then runs full cycles: the sample combined realtime feeds in --feeds,
 * when present, are fetched, matched and rebuilt each cycle. Use --dates covering the feeds' day (the 18 Oct samples:
 * 20261017,20261018) for real matching. Workers freeze the clock during CPU work, so CPU is process.cpuUsage() in
 * Node (same V8). Memory: JS heap plus ArrayBuffer backing stores, sampled after every trip-index day is parsed and
 * again after it is indexed (both alive: the peak), absolute and as growth, plus the process's peak RSS growth.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { brisbaneDate, type GenerationIndex, type Manifest, type Mode } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import { MemoryDataSource } from '../src/data/source.ts'
import { StaticStore } from '../src/data/static-store.ts'
import { FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import { ModeIndex } from '../src/rt/build.ts'
import { parseRtModes } from '../src/rt/feeds.ts'
import { HubCore, type HubStorage } from '../src/rt/hub-core.ts'

import { buildTripIndexes } from './lib/gtfs-trip-index.ts'

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? '') : def
}

const GTFS = arg('gtfs', '/tmp/bft-gtfs/x') as string
const DATES = (arg('dates', '20261020,20261021') as string).split(',')
const RUNS = Number(arg('runs', '3'))
const TREE = arg('tree', join(process.env.TMPDIR ?? '/tmp', `bft-coldload-${DATES.join('-')}`)) as string
const FEEDS = arg('feeds', '/tmp/bft-gtfs') as string
const PREP = process.argv.includes('--prep')
const MODES: Mode[] = ['ferry', 'train', 'tram', 'bus']
/**
 * --impl old: compare with an older hub, copied locally first (not committed):
 * git show <base>:services/edge/src/rt/hub-core.ts > src/rt/hub-core.old.ts
 */
const IMPL = arg('impl', 'new') as string
/** --live: collect garbage before each memory sample (live peak; inflates CPU, so CPU comes from the other runs). */
const LIVE = process.argv.includes('--live')
const GEN = 'coldload'

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {})
const mem = () => {
  const m = process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}
const MB = (b: number) => +(b / 1e6).toFixed(1)

/** Write manifest, per-mode generation indexes and gzip trip-index blobs (the R2 layout) to TREE once. */
async function buildTree(): Promise<void> {
  if (existsSync(join(TREE, 'manifest.json'))) return
  const days = await buildTripIndexes(GTFS, DATES, GEN)
  await mkdir(TREE, { recursive: true })
  const manifest: Manifest = {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    modes: {},
    quarantined: [],
  }
  const sizes: Record<string, number> = {}
  for (const mode of MODES) {
    const index: GenerationIndex = {
      schemaVersion: 1,
      generation: GEN,
      mode,
      feedVersion: 'coldload',
      builtAt: new Date().toISOString(),
      serviceDates: DATES,
      blobs: {},
      tripIndex: {},
    }
    for (const d of DATES) {
      const day = days.get(`${mode}|${d}`)
      if (!day) continue
      const gz = gzipSync(JSON.stringify(day))
      const sha = createHash('sha256').update(gz).digest('hex')
      await writeFile(join(TREE, `blob-${sha}`), gz)
      ;(index.tripIndex as Record<string, string>)[d] = sha
      sizes[`${mode} ${d}`] = gz.byteLength
    }
    await writeFile(join(TREE, `index-${mode}.json`), JSON.stringify(index))
    manifest.modes[mode] = { current: GEN, serviceDates: DATES }
  }
  await writeFile(join(TREE, 'manifest.json'), JSON.stringify(manifest))
  console.error('trip-index blobs (gzip bytes):', sizes)
}

async function loadSource(): Promise<MemoryDataSource> {
  const files = new Map<string, Uint8Array>()
  for (const f of await readdir(TREE)) {
    const bytes = new Uint8Array(await readFile(join(TREE, f)))
    if (f === 'manifest.json') files.set('manifest.json', bytes)
    else if (f.startsWith('index-')) files.set(`static/${GEN}/${f.slice(6, -5)}/index.json`, bytes)
    else files.set(`static/blobs/${f.slice(5)}.json.gz`, bytes)
  }
  return new MemoryDataSource(files)
}

/** DO storage holding a restored snapshot (meta + chunks, as HubCore writes without R2), so restore() parses it. */
class SnapshotStorage implements HubStorage {
  private alarm: number | null = null
  private readonly data = new Map<string, unknown>()
  constructor(json: string | null) {
    if (!json) return
    const n = Math.ceil(json.length / CHUNK_CHARS)
    for (let i = 0; i < n; i++) this.data.set(`snap:${i}`, json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS))
    const seq = (JSON.parse(json) as { header: { seq: number } }).header.seq
    this.data.set('meta', { seq, lastCycleAt: 0, lastError: null, alertsAt: 0, snapChunks: n })
  }
  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined
  }
  async put(): Promise<void> {}
  async getAlarm() {
    return this.alarm
  }
  async setAlarm(t: number) {
    this.alarm = t
  }
}
const CHUNK_CHARS = 512 * 1024

/** The sample realtime feeds (combined), when present: a full first cycle, not just the index phase. */
async function feeds(): Promise<Map<string, Uint8Array> | null> {
  if (!FEEDS || !existsSync(join(FEEDS, 'tu.pb'))) return null
  const read = async (f: string) => new Uint8Array(await readFile(join(FEEDS, f)))
  return new Map([
    ['TripUpdates', await read('tu.pb')],
    ['VehiclePositions', await read('vp.pb')],
    ['alerts', await read('al.pb')],
  ])
}

/** Child: one fresh hub (restored snapshot, empty indexes), cycles until every mode is indexed. */
async function child(): Promise<void> {
  const source = await loadSource()
  const rt = await feeds()
  // The feeds' own time when they cover DATES[1] (so trips match), else 08:00 that day.
  const feedTime = rt
    ? Number(fromBinary(FeedMessageSchema, rt.get('TripUpdates') as Uint8Array).header?.timestamp ?? 0n) *
      1000
    : 0
  const [y, m, d] = [DATES[1]?.slice(0, 4), DATES[1]?.slice(4, 6), DATES[1]?.slice(6, 8)]
  let now =
    feedTime && brisbaneDate(feedTime) === DATES[1] ? feedTime : Date.parse(`${y}-${m}-${d}T08:00:00+10:00`)
  const store = new StaticStore(source, { now: () => now })
  // Sample after each day is parsed and again after it is indexed (the parsed day and the new compact arrays are
  // both alive then: the peak).
  let peak = 0
  const sample = <T>(v: T): T => {
    if (LIVE) gc()
    peak = Math.max(peak, mem())
    return v
  }
  const decode = store.decodeTripIndexDay.bind(store)
  store.decodeTripIndexDay = async (b) => sample(await decode(b))
  const day = store.tripIndexDay.bind(store)
  store.tripIndexDay = async (i, dt) => sample(await day(i, dt))
  const addDay = ModeIndex.prototype.addDay
  ModeIndex.prototype.addDay = function (this: ModeIndex, x) {
    addDay.call(this, x)
    sample(x)
  }
  const Hub: typeof HubCore =
    IMPL === 'old' ? (await import('../src/rt/hub-core.old.ts' as string)).HubCore : HubCore
  const snapFile = join(TREE, 'snapshot.json')
  const restored = PREP || !existsSync(snapFile) ? null : await readFile(snapFile, 'utf8')
  const hub = new Hub({
    storage: new SnapshotStorage(restored),
    fetch: async (url: string) => {
      const body = rt?.get(url.replace(/^.*\/SEQ\//, ''))
      return body ? new Response(body as unknown as ArrayBuffer) : new Response(null, { status: 304 })
    },
    now: () => now,
    store,
    config: parseRtModes('all', MODES.join(',')),
    upstream: 'https://up.test/api/realtime/SEQ',
  })
  gc()
  gc()
  const base = mem()
  const rss0 = process.resourceUsage().maxRSS
  const cycles: Array<{ cpuMs: number; wallMs: number; loaded: string[]; error: string | null }> = []
  for (let i = 0; i < 12 && Object.keys(hub.status().generations).length < MODES.length; i++) {
    const c0 = process.cpuUsage()
    const w0 = performance.now()
    await hub.cycle()
    const c = process.cpuUsage(c0)
    cycles.push({
      cpuMs: +((c.user + c.system) / 1000).toFixed(0),
      wallMs: +(performance.now() - w0).toFixed(0),
      loaded: Object.keys(hub.status().generations),
      error: hub.status().lastError,
    })
    now += 15_000
  }
  const stats = hub.status().stats
  if (PREP) {
    await writeFile(snapFile, (await hub.pull(null)).json ?? '')
    return
  }
  gc()
  gc()
  console.log(
    JSON.stringify({
      impl: IMPL,
      live: LIVE,
      feeds: rt != null,
      restoredSnapshotMB: MB(restored?.length ?? 0),
      matched: stats
        ? Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, `${v.matched}/${v.total}`]))
        : null,
      cycles,
      // Absolute = the whole process's JS heap + ArrayBuffers, including this script's in-memory copy of every blob
      // (the DO reads R2 instead) and the restored snapshot; growth = above the fresh hub before its first cycle.
      baseMB: MB(base),
      peakMB: MB(peak),
      peakGrowthMB: MB(peak - base),
      retainedMB: MB(mem()),
      retainedGrowthMB: MB(mem() - base),
      peakRssGrowthMB: MB((process.resourceUsage().maxRSS - rss0) * 1024),
    }),
  )
}

async function main(): Promise<void> {
  if (process.argv.includes('--child')) return child()
  await buildTree()
  const { execFileSync } = await import('node:child_process')
  const run = (extra: string[]) =>
    execFileSync(
      process.execPath,
      [
        '--expose-gc',
        '--experimental-transform-types',
        '--no-warnings',
        '--max-old-space-size=128',
        process.argv[1] as string,
        '--child',
        '--impl',
        IMPL,
        ...(LIVE ? ['--live'] : []),
        '--dates',
        DATES.join(','),
        '--tree',
        TREE,
        '--feeds',
        FEEDS,
        ...extra,
      ],
      { encoding: 'utf8', maxBuffer: 1 << 24 },
    )
  // The snapshot a restarted hub restores: what a fully loaded hub built from these feeds.
  if (!existsSync(join(TREE, 'snapshot.json'))) run(['--prep'])
  for (let r = 0; r < RUNS; r++) console.log(run([]).trim())
}

await main()
