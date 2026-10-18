/**
 * The static build (transit-architecture.md §3.2): feed → per-mode generations for service days D−1..D+6.
 *
 * Output layout (common.md "Shared storage layout"), written into `outDir`:
 *   static/blobs/{sha}.json.gz, static/shards/{sha}.json.gz, static/{generation}/{mode}/index.json,
 *   data/{mode}/{stops,lines}.json, data/{mode}/geo/{geohash5}.json, legacy/latest.json,
 *   manifest.staging.json (only when something is quarantined), manifest.json (always last).
 * A quarantined mode's client data goes under staging/ so live readers never see it.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Mode } from '@bft/core'
import {
  addDays,
  brisbaneDate,
  GenerationIndex,
  GeoTileFile,
  LinesFile,
  Manifest,
  SCHEMA_VERSION,
  StaticStopDay,
  StopIndexFile,
  shardOf,
  TripIndexDay,
} from '@bft/core'
import { readCsvObjects } from '../feed/csv.ts'
import { type Feed, loadFeed, type TripRow } from '../feed/load.ts'
import { feedContentHash } from '../feed/source.ts'
import { DirTarget, type Reader, readJson } from '../publish/targets.ts'
import {
  checkFeedEndDate,
  checkGoldenFacts,
  quarantineReasons,
  StructuralFailure,
} from '../validate/validators.ts'
import { BlobWriter, gzipJson, sha256Hex } from './blobs.ts'
import { buildClientData } from './client-data.ts'
import { buildStopKeys, type StopKeys } from './keys.ts'
import { buildLegacyLatest } from './legacy.ts'
import { collectModeDay, stopDayFile, tripIndexFile } from './stop-days.ts'

/** Bump when the builder's output for the same feed changes, so generations change with it. */
export const FORMAT_VERSION = 1
export const ALL_MODES: Mode[] = ['ferry', 'train', 'tram', 'bus']
/** Modes whose stop-days are also grouped into shards (for the assets backend's file limit). */
export const SHARDED_MODES: Mode[] = ['bus']
export const DEFAULT_SHARDS = 512

export interface BuildOptions {
  feedDir: string
  outDir: string
  /** The build instant, epoch ms (also builtAt and the legacy `generated`). */
  nowMs: number
  /** Service date D (YYYYMMDD); defaults to the Brisbane date of nowMs. */
  date?: string
  modes?: Mode[]
  shards?: number
  /** Where to read the previous manifest and indexes from; defaults to outDir. */
  previous?: Reader
  /** Generations promoted despite quarantine (workflow_dispatch accept=<generation>). */
  accept?: string[]
  /** Apply SEQ golden facts (default: when agency is Translink). */
  golden?: boolean
  legacy?: boolean
  /** Measurement hook, called for every stop-day blob. */
  onStopDay?: (info: { mode: Mode; date: string; key: string; json: string; gzBytes: number; isNew: boolean }) => void
  log?: (msg: string) => void
}

export interface ModeResult {
  mode: Mode
  generation: string
  index: GenerationIndex
  quarantined: string[]
  accepted: boolean
}

export interface BuildResult {
  feedVersion: string
  serviceDates: string[]
  modes: ModeResult[]
  manifest: Manifest
  staging: Manifest | null
  blobsWritten: number
  blobsExisting: number
  /** Files written to outDir this run (content-addressed ones only when new). */
  filesWritten: number
  feed: Feed
  keys: StopKeys
}

export function windowDates(d: string): string[] {
  return Array.from({ length: 8 }, (_, i) => addDays(d, i - 1))
}

export async function feedVersionOf(feed: Feed): Promise<string> {
  const h = await feedContentHash(feed.dir)
  return `${feed.feedInfo?.startDate ?? 'x'}-${feed.feedInfo?.endDate ?? 'x'}-${h.slice(0, 8)}`
}


export async function runBuild(opts: BuildOptions): Promise<BuildResult> {
  const log = opts.log ?? (() => {})
  const modes = opts.modes ?? ALL_MODES
  const shardCount = opts.shards ?? DEFAULT_SHARDS
  const d = opts.date ?? brisbaneDate(opts.nowMs)
  const dates = windowDates(d)
  const builtAt = new Date(opts.nowMs).toISOString()
  let filesWritten = 0
  const writeOut = async (key: string, text: string) => {
    const p = join(opts.outDir, key)
    await mkdir(dirname(p), { recursive: true })
    await writeFile(p, text)
    filesWritten++
  }

  log(`loading feed ${opts.feedDir} for service dates ${dates[0]}..${dates[7]}`)
  const feed = await loadFeed(opts.feedDir, { windowDates: dates })
  log(`loaded ${feed.trips.length}/${feed.tripRowsTotal} trips, ${feed.stopTimes.stop.length}/${feed.stopTimeRowsTotal} stop_times`)

  const structural = checkFeedEndDate(feed.feedInfo?.endDate, d)
  if (structural.length) throw new StructuralFailure(structural)

  const feedVersion = await feedVersionOf(feed)
  const keys = buildStopKeys(feed)
  const writer = new BlobWriter(opts.outDir)
  const active = new Map(dates.map((date) => [date, feed.calendar.activeServices(date)]))

  const built: Array<{
    mode: Mode
    index: GenerationIndex
    tripsByDate: Map<string, number[]>
    windowTrips: Set<number>
    servedKeys: Set<string>
  }> = []
  for (const mode of modes) {
    const blobs: GenerationIndex['blobs'] = {}
    const shardsByDate: Record<string, Array<string | null>> = {}
    const stats: NonNullable<GenerationIndex['stats']> = {}
    const tripsByDate = new Map<string, number[]>()
    const servedKeys = new Set<string>()
    const windowTrips = new Set<number>()
    const sharded = SHARDED_MODES.includes(mode)
    for (const date of dates) {
      const day = collectModeDay(feed, keys, mode, date, active.get(date) as Set<string>)
      tripsByDate.set(date, day.trips)
      for (const t of day.trips) windowTrips.add(t)
      stats[date] = { trips: day.trips.length, events: day.events, stops: day.keys.length }
      const dayBlobs: Record<string, string> = {}
      const dayShards: Array<string | null> = sharded ? new Array(shardCount).fill(null) : []
      // Sharded modes visit stops grouped by shard bucket, so each shard is assembled and flushed in turn.
      const order = sharded
        ? [...day.keys].sort((a, b) => shardOf(a, shardCount) - shardOf(b, shardCount) || (a < b ? -1 : a > b ? 1 : 0))
        : day.keys
      let shardParts: string[] = []
      let shardMembers: string[] = []
      let shardBucket = -1
      const flushShard = async () => {
        if (!shardMembers.length) return
        const info = await writer.put('shard', `{${shardParts.join(',')}}`)
        dayShards[shardBucket] = info.sha
        shardParts = []
        shardMembers = []
      }
      for (const key of order) {
        const json = JSON.stringify(checked(StaticStopDay, stopDayFile(feed, keys, day, key), `${mode} ${date} ${key}`))
        // Sharded modes (bus) exist only inside shards: no per-stop blob, no per-stop index entry.
        if (!sharded) {
          const info = await writer.put('blob', json)
          dayBlobs[key] = info.sha
          opts.onStopDay?.({ mode, date, key, json, gzBytes: info.gzBytes, isNew: info.isNew })
        } else if (opts.onStopDay) {
          opts.onStopDay({ mode, date, key, json, gzBytes: gzipJson(json).length, isNew: false })
        }
        servedKeys.add(`${date}|${key}`)
        if (sharded) {
          const b = shardOf(key, shardCount)
          if (b !== shardBucket) {
            await flushShard()
            shardBucket = b
          }
          shardParts.push(`${JSON.stringify(key)}:${json}`)
          shardMembers.push(key)
        }
      }
      await flushShard()
      if (!sharded) blobs[date] = sortRecord(dayBlobs)
      if (sharded) shardsByDate[date] = dayShards
    }
    const buildHash = sha256Hex(
      JSON.stringify({ FORMAT_VERSION, SCHEMA_VERSION, feedVersion, mode, dates, blobs, shards: sharded ? shardsByDate : null }),
    ).slice(0, 12)
    const generation = `${feedVersion}-${buildHash}`
    const index: GenerationIndex = {
      schemaVersion: SCHEMA_VERSION,
      generation,
      mode,
      feedVersion,
      builtAt,
      serviceDates: dates,
      blobs,
      tripIndex: {},
      stats,
    }
    if (sharded) index.shards = { count: shardCount, hash: 'fnv1a32', byDate: shardsByDate }
    for (const date of dates) {
      const day = { mode, serviceDate: date, trips: tripsByDate.get(date) as number[], buckets: new Map(), keys: [], events: 0 }
      const info = await writer.put(
        'blob',
        JSON.stringify(checked(TripIndexDay, tripIndexFile(feed, day, generation), `${mode} ${date} trip index`)),
      )
      ;(index.tripIndex as Record<string, string>)[date] = info.sha
    }
    built.push({ mode, index, tripsByDate, windowTrips, servedKeys })
    log(`${mode}: generation ${generation}, ${Object.values(stats).reduce((a, s) => a + s.events, 0)} events over 8 days`)
  }

  // Structural: golden facts on the real feed.
  const isSeq = opts.golden ?? /translink/i.test(await agencyName(feed))
  if (isSeq) {
    const problems = checkGoldenFacts((mode, date, key) =>
      Boolean(built.find((b) => b.mode === mode)?.servedKeys.has(`${date}|${key}`)), dates)
    if (problems.length) throw new StructuralFailure(problems)
  }

  // Quarantine checks against the previous generation of each mode.
  const previousReader = opts.previous ?? new DirTarget(opts.outDir)
  const prevManifest = await readJson<Manifest>(previousReader, 'manifest.json')
  const prevStaging = await readJson<Manifest>(previousReader, 'manifest.staging.json')
  const accept = new Set(opts.accept ?? [])
  const results: ModeResult[] = []
  for (const b of built) {
    const prevGen = prevManifest?.modes[b.mode]?.current
    const previous =
      prevGen && prevGen !== b.index.generation
        ? await readJson<GenerationIndex>(previousReader, `static/${prevGen}/${b.mode}/index.json`)
        : null
    const reasons =
      b.mode === 'bus'
        ? quarantineReasons({ mode: b.mode, index: b.index, previous, closureExplained: () => false })
        : quarantineReasons({
            mode: b.mode,
            index: b.index,
            previous,
            // Stations this generation or the previous one serves anywhere in the window.
            stationKeys: new Set(
              [b.index, previous].flatMap((i) => Object.values(i?.blobs ?? {}).flatMap((m) => Object.keys(m))),
            ),
            closureExplained: closureExplainer(feed, keys, b.mode),
          })
    results.push({
      mode: b.mode,
      generation: b.index.generation,
      index: b.index,
      quarantined: reasons,
      accepted: reasons.length > 0 && acceptsGeneration(accept, b.mode, b.index, prevStaging),
    })
  }

  // Indexes, then client data (live or staging), then legacy, then manifests.
  // An accept id must name this build's generation or a staged one from the same feed; anything else is a mistake.
  for (const id of accept) {
    const known =
      results.some((r) => r.generation === id) ||
      results.some((r) => acceptsGeneration(new Set([id]), r.mode, r.index, prevStaging))
    if (!known) {
      const staged = prevStaging?.quarantined.find((q) => q.generation === id)
      throw new Error(
        staged
          ? `--accept ${id}: that ${staged.mode} generation was built from feed ${feedVersionOfGeneration(id)}, ` +
              `but this build's feed is ${feedVersion}; review this build's quarantine instead`
          : `--accept ${id}: unknown generation (not this build's and not in manifest.staging.json)`,
      )
    }
  }

  // Indexes are immutable once written: a rebuild of the same generation keeps the first builtAt.
  for (const b of built) {
    const key = `static/${b.index.generation}/${b.mode}/index.json`
    if (!existsSync(join(opts.outDir, key))) await writeOut(key, JSON.stringify(checked(GenerationIndex, b.index, key)))
  }
  for (const r of results) {
    const b = built.find((x) => x.mode === r.mode) as (typeof built)[number]
    const live = r.quarantined.length === 0 || r.accepted
    const prefix = live ? '' : 'staging/'
    const cd = buildClientData(feed, keys, r.mode, [...b.windowTrips].sort((x, y) => x - y), r.generation)
    await writeOut(`${prefix}data/${r.mode}/stops.json`, JSON.stringify(checked(StopIndexFile, cd.stops, `${r.mode} stops.json`)))
    await writeOut(`${prefix}data/${r.mode}/lines.json`, JSON.stringify(checked(LinesFile, cd.lines, `${r.mode} lines.json`)))
    for (const tile of cd.geo) await writeOut(`${prefix}data/${r.mode}/geo/${tile.geohash}.json`, JSON.stringify(checked(GeoTileFile, tile, `${r.mode} geo ${tile.geohash}`)))
    if (r.mode === 'ferry' && opts.legacy !== false)
      await writeOut(`${prefix}legacy/latest.json`, buildLegacyLatest(feed, opts.nowMs))
  }

  const { manifest, staging } = nextManifests(prevManifest, results, builtAt)
  checked(Manifest, manifest, 'manifest.json')
  if (staging) checked(Manifest, staging, 'manifest.staging.json')
  if (staging) await writeOut('manifest.staging.json', JSON.stringify(staging, null, 2))
  await writeOut('manifest.json', JSON.stringify(manifest, null, 2))

  return {
    feedVersion,
    serviceDates: dates,
    modes: results,
    manifest,
    staging,
    blobsWritten: writer.newCount,
    blobsExisting: writer.existingCount,
    filesWritten: filesWritten + writer.newCount,
    feed,
    keys,
  }
}

/** The new live manifest (quarantined modes keep their previous generation) and, if needed, a staging manifest. */
export function nextManifests(
  prev: Manifest | null,
  results: Pick<ModeResult, 'mode' | 'generation' | 'index' | 'quarantined' | 'accepted'>[],
  updatedAt: string,
): { manifest: Manifest; staging: Manifest | null } {
  const modes: Manifest['modes'] = { ...(prev?.modes ?? {}) }
  const stagingModes: Manifest['modes'] = { ...(prev?.modes ?? {}) }
  const quarantined: Manifest['quarantined'] = []
  for (const r of results) {
    const old = prev?.modes[r.mode]
    const entry = {
      current: r.generation,
      ...(old && old.current !== r.generation
        ? { previous: old.current }
        : old?.previous
          ? { previous: old.previous }
          : {}),
      serviceDates: r.index.serviceDates,
    }
    stagingModes[r.mode] = entry
    if (r.quarantined.length === 0 || r.accepted) modes[r.mode] = entry
    if (r.quarantined.length > 0 && !r.accepted)
      quarantined.push({ generation: r.generation, mode: r.mode, reasons: r.quarantined })
  }
  const manifest: Manifest = { schemaVersion: SCHEMA_VERSION, updatedAt, modes: sortModes(modes), quarantined }
  const staging = quarantined.length
    ? { schemaVersion: SCHEMA_VERSION, updatedAt, modes: sortModes(stagingModes), quarantined }
    : null
  return { manifest, staging: staging as Manifest | null }
}

function sortModes(m: Manifest['modes']): Manifest['modes'] {
  const out: Manifest['modes'] = {}
  for (const mode of ALL_MODES) if (m[mode]) out[mode] = m[mode]
  return out
}

function sortRecord<T>(r: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {}
  for (const k of Object.keys(r).sort()) out[k] = r[k] as T
  return out
}

async function agencyName(feed: Feed): Promise<string> {
  const rows = await readCsvObjects(join(feed.dir, 'agency.txt'))
  return rows[0]?.agency_name ?? ''
}

/** A closure is explained when calendar_dates removes, on that date, a service of some trip that serves the stop. */
function closureExplainer(feed: Feed, keys: StopKeys, mode: Mode): (key: string, date: string) => boolean {
  const servicesByKey = new Map<string, Set<string>>()
  for (const t of feed.trips as TripRow[]) {
    if (feed.routes.get(t.routeId)?.mode !== mode) continue
    for (let r = t.start; r < t.start + t.count; r++) {
      const key = keys.keyOf(mode, feed.stopTimes.stop[r] as number)
      let s = servicesByKey.get(key)
      if (!s) {
        s = new Set()
        servicesByKey.set(key, s)
      }
      s.add(t.serviceId)
    }
  }
  return (key, date) => {
    for (const sid of servicesByKey.get(key) ?? []) if (feed.calendar.isExplicitlyRemoved(sid, date)) return true
    return false
  }
}


/** "{start}-{end}-{sha8}-{build12}" → "{start}-{end}-{sha8}". */
export function feedVersionOfGeneration(generation: string): string {
  return generation.replace(/-[0-9a-f]{12}$/, '')
}

/**
 * Accept promotes a quarantined mode when the id is this build's generation, or a generation quarantined in the
 * previous staging manifest for the same mode and the same feed content (the next day's run rebuilds the same feed
 * with a new date window, hence a new generation id; Codex PR41 #2).
 */
export function acceptsGeneration(
  accept: Set<string>,
  mode: Mode,
  index: GenerationIndex,
  prevStaging: Manifest | null,
): boolean {
  if (accept.has(index.generation)) return true
  for (const q of prevStaging?.quarantined ?? [])
    if (q.mode === mode && accept.has(q.generation) && feedVersionOfGeneration(q.generation) === index.feedVersion)
      return true
  return false
}

/** Contract check of every output before it is written (Codex PR41 #1): a violation is structural, exit 2. */
function checked<T>(schema: { safeParse(v: unknown): { success: boolean; error?: { message: string } } }, value: T, what: string): T {
  const r = schema.safeParse(value)
  if (!r.success) throw new StructuralFailure([`output ${what} violates the contract: ${r.error?.message.slice(0, 500)}`])
  return value
}
