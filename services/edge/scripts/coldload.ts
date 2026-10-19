/**
 * Cold-start index load: CPU and memory of a fresh RtHub's first cycles, with every mode's real trip indexes
 * (RT_INDEX_MODES=ferry,train,tram,bus) served as gzip blobs through a real StaticStore, as from R2.
 *
 *   node --expose-gc --experimental-transform-types scripts/coldload.ts [--gtfs /tmp/bft-gtfs/x] \
 *     [--dates 20261020,20261021] [--runs 3]
 *
 * Each run is a fresh child process (like a fresh DO isolate). Workers freeze the clock during CPU work, so CPU is
 * process.cpuUsage() in Node (same V8). Memory: JS heap plus ArrayBuffer backing stores, sampled right after every
 * trip-index day is parsed (the parsed day is the transient peak), and the process's peak RSS growth.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { GenerationIndex, Manifest, Mode } from '@bft/core'
import { MemoryDataSource } from '../src/data/source.ts'
import { StaticStore } from '../src/data/static-store.ts'
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

class NullStorage implements HubStorage {
  private alarm: number | null = null
  async get<T>(): Promise<T | undefined> {
    return undefined
  }
  async put(): Promise<void> {}
  async getAlarm() {
    return this.alarm
  }
  async setAlarm(t: number) {
    this.alarm = t
  }
}

/** Child: one fresh hub, cycles until every mode is indexed. */
async function child(): Promise<void> {
  const source = await loadSource()
  const [y, m, d] = [DATES[1]?.slice(0, 4), DATES[1]?.slice(4, 6), DATES[1]?.slice(6, 8)]
  let now = Date.parse(`${y}-${m}-${d}T08:00:00+10:00`)
  const store = new StaticStore(source, { now: () => now })
  // Sample memory right after each day is parsed, while the parsed day is still alive.
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
  const Hub: typeof HubCore =
    IMPL === 'old' ? (await import('../src/rt/hub-core.old.ts' as string)).HubCore : HubCore
  const hub = new Hub({
    storage: new NullStorage(),
    // No realtime: this measures the index phase. (The snapshot build is measured by `spike`.)
    fetch: async () => new Response(null, { status: 304 }),
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
  const transientPeak = peak - base
  gc()
  gc()
  console.log(
    JSON.stringify({
      cycles,
      retainedMB: MB(mem() - base),
      impl: IMPL,
      live: LIVE,
      peakHeapPlusBuffersMB: MB(transientPeak),
      peakRssGrowthMB: MB((process.resourceUsage().maxRSS - rss0) * 1024),
    }),
  )
}

async function main(): Promise<void> {
  if (process.argv.includes('--child')) return child()
  await buildTree()
  const { execFileSync } = await import('node:child_process')
  for (let r = 0; r < RUNS; r++) {
    const out = execFileSync(
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
      ],
      { encoding: 'utf8', maxBuffer: 1 << 24 },
    )
    console.log(out.trim())
  }
}

await main()
