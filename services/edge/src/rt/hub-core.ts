/**
 * The RtHub poller, independent of the Durable Object runtime so tests can drive it with a fake clock, fake
 * storage and a fake upstream (transit-architecture.md §3.3, ADR-0003). `hub.ts` wraps it in the DO class.
 *
 * Scheduler robustness (Codex finding 8):
 * - `alarm()` re-arms the next alarm **first**, before any work, and again in `finally` if it is missing.
 * - Each upstream fetch has a 5 s timeout. Errors never escape `alarm()`, so the runtime's retry/backoff
 *   never takes over the cadence.
 * - `ensureRunning()` (called by the Worker's 1-minute cron) re-arms the chain when the last completed cycle is
 *   more than 45 s old or no alarm is set.
 */
import { type Alert, addDays, brisbaneDate, type Manifest, Mode, type RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import type { AlertSummariser } from '../ai/alert-summary.ts'
import { decodeText, gzip, isGzip } from '../data/source.ts'
import type { StaticStore } from '../data/static-store.ts'
import { type FeedMessage, FeedMessageSchema } from '../gen/gtfs-realtime_pb.js'
import { errorMessage, type Logger, silentLogger } from '../log.ts'
import { buildAlerts, buildSnapshot, ModeIndex } from './build.ts'
import { COMBINED_KEY, decodeCombined, encodeCombined, INDEX_BYTES, type SectionInput } from './combined.ts'
import { type FeedSpec, feedsFor, type RtConfig } from './feeds.ts'
import { SourceWatch } from './source-watch.ts'
import {
  alertsDocument,
  documentBody,
  documentContent,
  documentJson,
  mergeDocuments,
  type SnapshotScope,
  splitSnapshot,
} from './split.ts'

export const CYCLE_MS = 15_000
/** Alarm cadence that keeps the object resident (it is evicted after ~10 s idle); polls still run every CYCLE_MS. */
export const KEEPALIVE_MS = 7_500
const POLL_SLACK_MS = 500
export const ALERTS_EVERY_MS = 60_000
export const FETCH_TIMEOUT_MS = 5_000
export const WATCHDOG_STALE_MS = 45_000
export const RAW_PERSIST_EVERY_MS = 60_000
/** How often the hub logs its stop_sequence mismatch counters (R20-T1), when any are non-zero. */
export const SEQ_LOG_EVERY_MS = 10 * 60_000
/** A poll whose wall time reaches this logs its phase timings even without RT_PROFILE. */
export const SLOW_CYCLE_MS = 2_500
/**
 * With no document to commit, the pointer is rewritten at most this often, only to keep its hub status (source
 * timestamp, fetchedAt, lastError) fresh for /v1/health, /v1/alerts and mode readers whose document is unchanged.
 * Every 3rd 15 s poll in production, every 2nd 30 s poll on staging; health's 120 s thresholds keep ample margin.
 */
export const POINTER_HEARTBEAT_MS = 45_000
/** DO storage values are capped (2 MiB on SQLite-backed objects); chunk well below that. */
const CHUNK_BYTES = 1 << 20
const CHUNK_CHARS = 512 * 1024

export interface HubStorage {
  get<T>(key: string): Promise<T | undefined>
  put(entries: Record<string, unknown>): Promise<void>
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number): Promise<void>
  deleteAlarm?(): Promise<void>
}

export const R2_LATEST_KEY = 'rt/latest.json'
export const R2_KEEP_SNAPSHOTS = 240
/**
 * Snapshots go to a fixed ring of R2_KEEP_SNAPSHOTS keys that the hub overwrites (no deletes: Brett's standing
 * rule). Readers confirm the object's header seq matches the pointer, since a slot is reused every 240 polls.
 */
export const snapshotKey = (seq: number) => `rt/snapshot-${seq % R2_KEEP_SNAPSHOTS}.json`

/** The header seq of a snapshot JSON without parsing it all (JSON.stringify writes header.schemaVersion, seq first). */
export function snapshotSeq(json: string): number | null {
  const m = /^\{"header":\{"schemaVersion":\d+,"seq":(\d+)/.exec(json)
  if (m) return Number(m[1])
  try {
    return (JSON.parse(json) as RtSnapshot).header.seq
  } catch {
    return null
  }
}

/** rt/latest.json: which snapshot is current, plus the hub status for /v1/health. */
export interface R2Pointer {
  seq: number
  /** Combined snapshot key (older hubs only; per-scope documents are in `files`). */
  key?: string
  /**
   * Per-scope documents: the alerts document (rewritten only when alerts change) and, from hubs before the combined
   * object, each mode's snapshot.
   */
  files?: Partial<Record<SnapshotScope, { key: string; seq: number }>>
  /** The combined mode object (rt/modes/combined.dat) and the snapshot seq it was written at. */
  combined?: { key: string; seq: number }
  fetchedAt: number
  status: HubStatus
}

/** Ring key of a per-scope snapshot document. */
/** The per-mode document an edge isolate refreshes from with one read (overwritten every poll). */
export const modeLatestKey = (mode: Mode) => `rt/${mode}/latest.json`

export const scopeKey = (scope: SnapshotScope, seq: number) =>
  `rt/${scope}/snapshot-${seq % R2_KEEP_SNAPSHOTS}.json`

export interface R2Like {
  /** `range`: only those bytes (R2 clamps a length past the end of the object). */
  get?(
    key: string,
    opts?: { range: { offset: number; length: number } },
  ): Promise<{
    text(): Promise<string>
    arrayBuffer?(): Promise<ArrayBuffer>
    customMetadata?: Record<string, string>
  } | null>
  put(
    key: string,
    value: Uint8Array | string,
    opts?: {
      httpMetadata?: { contentType?: string; contentEncoding?: string; cacheControl?: string }
      customMetadata?: Record<string, string>
    },
  ): Promise<unknown>
}

export interface HubDeps {
  storage: HubStorage
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  now: () => number
  store: StaticStore
  config: RtConfig
  upstream: string
  r2?: R2Like
  log?: Logger
  /** Alarm interval; 15 s by default (RT_CYCLE_MS). */
  cycleMs?: number
  /** Per upstream fetch; 5 s in production, shorter in tests. */
  fetchTimeoutMs?: number
  /** Log the phase timings of every poll (RT_PROFILE=1), not just slow ones. */
  profile?: boolean
  /**
   * R2 layout of the mode documents (RT_R2_LAYOUT): `documents` (one object per mode, the default) or `combined`
   * (one object, ranged reads). Readers of this release read both, chosen by the pointer; readers of earlier releases
   * read only `documents`. So: deploy with `documents`, then switch to `combined`; switch back before rolling back.
   */
  layout?: 'documents' | 'combined'
  /**
   * Store the snapshot documents gzip-compressed (RT_R2_COMPRESS=gzip): each per-mode and alerts document, and each
   * section of the combined object (whose index stays plain, for ranged reads). Readers of this release read plain
   * and compressed alike (gzip's magic bytes); readers and restores of earlier releases do not read compressed
   * combined sections. So, like `layout`: deploy with it off, then turn it on; turn it off before rolling back.
   */
  compress?: boolean
  /**
   * Plain-English alert summaries (ai/alert-summary.ts). Kicked after each alerts fetch and never awaited; the
   * snapshot carries whatever summaries it holds, and is rebuilt when a new one arrives.
   */
  summaries?: AlertSummariser
}

/**
 * Wall time per phase of one poll, for the "rt cycle timings" log. In workerd the clock only advances across I/O, so
 * pure-CPU phases (decode, build) read ~0 there; the I/O phases are what this measures.
 */
export interface CycleTimings {
  restore: number
  indexes: number
  fetch: number
  decode: number
  build: number
  persist: number
  publish: number
  total: number
  feeds: number
  changed: number
  rebuilt: boolean
  r2Puts: number
  r2Chars: number
}

export interface RawFeed {
  bytes: Uint8Array
  etag: string | null
  fetchedAt: number
}

export interface HubStatus {
  seq: number | null
  sourceTimestamp: number | null
  fetchedAt: number | null
  lastCycleAt: number | null
  lastError: string | null
  stats: RtSnapshot['header']['stats'] | null
  generations: Partial<Record<Mode, string>>
  /** When this hub instance (DO isolate) started, and any trip-index load in progress: eviction diagnostics. */
  startedAt?: number
  loading?: { mode: Mode; generation: string; loaded: number; of: number } | null
}

export interface WatchdogResult {
  rearmed: boolean
  lastCycleAt: number
  alarm: number | null
  /** The hub's current snapshot: TransLink's header time (s) and when it was built (ms). */
  sourceTimestamp: number | null
  fetchedAt: number | null
}

export interface PullResult {
  seq: number | null
  /** The snapshot JSON, or null when the caller already has `seq` (or there is none yet). */
  json: string | null
  status: HubStatus
}

interface Meta {
  seq: number
  lastCycleAt: number
  lastError: string | null
  alertsAt: number
  snapChunks: number
}

interface Published {
  /** documentContent() of what the key holds. */
  content: string
  key: string
  seq: number
  /** A mode document's stored bytes (gzip or plain JSON), carried unchanged into the next combined object. */
  section?: Uint8Array
}

interface LoadedMode {
  generation: string
  dates: string[]
  index: ModeIndex
}

export class HubCore {
  private readonly feeds: FeedSpec[]
  private readonly log: Logger
  private meta: Meta = { seq: 0, lastCycleAt: 0, lastError: null, alertsAt: 0, snapChunks: 0 }
  private restored = false
  /** The restore in flight, shared by every caller (see restore). */
  private restoring: Promise<void> | null = null
  private snapshot: RtSnapshot | null = null
  private snapshotJson: string | null = null
  private readonly raw = new Map<string, RawFeed>()
  private readonly decoded = new Map<string, FeedMessage>()
  private readonly modes = new Map<Mode, LoadedMode>()
  /** One-day-per-cycle reload of an already indexed mode (stepReload), so steady state stays light. */
  private pending: {
    mode: Mode
    generation: string
    dates: string[]
    index: ModeIndex
    loaded: number
  } | null = null
  private alerts: Alert[] = []
  /** The summaries version (AlertSummariser.version) the current snapshot was built with. */
  private summariesBuilt = -1
  private running: Promise<void> | null = null
  private rawPersistedAt = 0
  private seqLoggedAt = 0
  /** Trip key → mode of the current snapshot, for the per-mode split. */
  private tripModes = new Map<string, Mode>()
  /**
   * What each scope's R2 document holds (its content, without the per-poll header fields) and under which key and
   * seq. A scope whose content is unchanged is not rewritten; the pointer keeps naming its older seq.
   */
  private published = new Map<SnapshotScope, Published>()
  /** When the pointer was last written (0: not since this instance started). */
  private pointerAt = 0
  /** A publish skipped the pointer, so it lags the snapshot: write it once POINTER_HEARTBEAT_MS has passed. */
  private pointerOwed = false
  /** An alerts document moved to a new ring slot that no pointer names yet. */
  private alertsMoved = false
  /** Snapshot seq of the last combined object written (0: none since this instance started). */
  private combinedSeq = 0
  private drillDead = false
  /** The current snapshot still needs publishing to R2 (a publish failed, or it was just rebuilt). */
  private r2Pending = false
  private readonly startedAt: number
  private readonly cycleMs: number
  private readonly layout: 'documents' | 'combined'
  private readonly compress: boolean
  private readonly alarmMs: number
  private lastPollStart = Number.NEGATIVE_INFINITY
  /** Phase timings of the last completed poll (tests, and the log line). */
  lastTimings: CycleTimings | null = null
  /** R2 writes of the poll in progress, for its timings. */
  private puts = { n: 0, chars: 0 }
  /** TransLink header times per feed: logs a feed whose time stands still while its fetches succeed (R14-RT1). */
  private readonly sources: SourceWatch

  constructor(private readonly d: HubDeps) {
    this.feeds = feedsFor(d.config)
    this.startedAt = d.now()
    this.cycleMs = d.cycleMs ?? CYCLE_MS
    this.layout = d.layout ?? 'documents'
    this.compress = d.compress ?? false
    this.alarmMs = Math.min(KEEPALIVE_MS, this.cycleMs)
    this.log = d.log ?? silentLogger
    this.sources = new SourceWatch(this.log, this.cycleMs)
  }

  // ---------------------------------------------------------------- scheduling

  /**
   * The alarm fires every KEEPALIVE_MS (7.5 s) and polls when a full cycle (15 s) has passed since the last poll.
   * Measured on staging: an object idle for ~10 s between alarms is evicted, so a 15 s chain got a fresh isolate on
   * every alarm, lost its trip indexes and paid the restore each time. The in-between alarms do no work.
   */
  async alarm(): Promise<void> {
    // Watchdog drill: behave like a chain whose retries are exhausted (no work, no re-arm) until ensureRunning.
    if (this.drillDead) return
    // Re-arm first: whatever happens below, the chain continues.
    const started = this.d.now()
    await this.d.storage.setAlarm(started + this.alarmMs)
    try {
      if (started - this.lastPollStart >= this.cycleMs - POLL_SLACK_MS) {
        this.lastPollStart = started
        await this.cycle()
      }
    } catch (e) {
      this.meta.lastError = errorMessage(e)
      this.log.error('rt cycle failed', { error: this.meta.lastError })
    } finally {
      if ((await this.d.storage.getAlarm()) == null)
        await this.d.storage.setAlarm(this.d.now() + this.alarmMs)
    }
  }

  /**
   * Watchdog (1-minute cron). Re-arms when no alarm is set or the last completed cycle is older than 45 s. Also
   * reports the hub's own source and build times, so the cron can tell a stale source from a stale published status.
   */
  async ensureRunning(): Promise<WatchdogResult> {
    await this.restore()
    const now = this.d.now()
    const alarm = await this.d.storage.getAlarm()
    const stale = now - this.meta.lastCycleAt > WATCHDOG_STALE_MS
    const h = this.snapshot?.header
    const times = { sourceTimestamp: h?.sourceTimestamp ?? null, fetchedAt: h?.fetchedAt ?? null }
    if (alarm == null || stale) {
      this.drillDead = false
      await this.d.storage.setAlarm(now)
      this.log.warn('rt watchdog re-armed alarm', { alarm, lastCycleAt: this.meta.lastCycleAt, stale })
      return { rearmed: true, lastCycleAt: this.meta.lastCycleAt, alarm: now, ...times }
    }
    return { rearmed: false, lastCycleAt: this.meta.lastCycleAt, alarm, ...times }
  }

  // ---------------------------------------------------------------- read API (RPC)

  /** The snapshot as JSON: the whole of it, or one scope's document (the same split R2 readers get). */
  async pull(sinceSeq?: number | null, scope?: SnapshotScope): Promise<PullResult> {
    await this.restore()
    const seq = this.snapshot?.header.seq ?? (this.snapshotJson ? this.meta.seq : null)
    if (seq != null && seq === sinceSeq) return { seq, json: null, status: this.status() }
    if (!scope || !this.snapshot) return { seq, json: this.fullJson(), status: this.status() }
    const doc =
      scope === 'alerts'
        ? alertsDocument(this.snapshot)
        : (splitSnapshot(this.snapshot, this.tripModes, [scope])[scope] as RtSnapshot)
    return { seq, json: JSON.stringify(doc), status: this.status() }
  }

  /** The full snapshot JSON, serialised lazily (with R2 bound only the per-scope documents are written). */
  private fullJson(): string | null {
    if (this.snapshotJson == null && this.snapshot) this.snapshotJson = JSON.stringify(this.snapshot)
    return this.snapshotJson
  }

  /** Last raw protobuf for a feed key (memory, then DO storage). Never fetches upstream. */
  async getRaw(key: string): Promise<RawFeed | null> {
    const mem = this.raw.get(key)
    if (mem) return mem
    const head = await this.d.storage.get<{ etag: string | null; fetchedAt: number; chunks: number }>(
      `raw:${key}`,
    )
    if (!head) return null
    const parts: Uint8Array[] = []
    for (let i = 0; i < head.chunks; i++) {
      const p = await this.d.storage.get<Uint8Array>(`raw:${key}:${i}`)
      if (!p) return null
      parts.push(p)
    }
    const feed = { bytes: concat(parts), etag: head.etag, fetchedAt: head.fetchedAt }
    this.raw.set(key, feed)
    return feed
  }

  status(): HubStatus {
    const h = this.snapshot?.header
    const generations: Partial<Record<Mode, string>> = {}
    for (const [m, l] of this.modes) generations[m] = l.generation
    return {
      seq: h?.seq ?? null,
      sourceTimestamp: h?.sourceTimestamp ?? null,
      fetchedAt: h?.fetchedAt ?? null,
      lastCycleAt: this.meta.lastCycleAt || null,
      lastError: this.meta.lastError,
      stats: h?.stats ?? null,
      generations,
      startedAt: this.startedAt,
      loading: this.pending
        ? {
            mode: this.pending.mode,
            generation: this.pending.generation,
            loaded: this.pending.loaded,
            of: this.pending.dates.length,
          }
        : null,
    }
  }

  /** Watchdog drill: kill the alarm chain (delete the alarm, and make any in-flight alarm skip its re-arm). */
  async killForDrill(): Promise<{ killedAt: number }> {
    this.drillDead = true
    await this.d.storage.deleteAlarm?.()
    return { killedAt: this.d.now() }
  }

  /** Phase 0 spike: decode the stored feeds and rebuild the snapshot `runs` times (no I/O, no writes). */
  async benchmark(runs: number): Promise<{ runs: number; seq: number | null }> {
    await this.restore()
    const indexes: Partial<Record<Mode, ModeIndex>> = {}
    for (const [m, l] of this.modes) indexes[m] = l.index
    for (let i = 0; i < runs; i++) {
      const decode = (kind: FeedSpec['kind']) =>
        this.feeds
          .filter((f) => f.kind === kind && this.raw.has(f.key))
          .map((f) => ({
            mode: f.mode,
            feed: fromBinary(FeedMessageSchema, (this.raw.get(f.key) as RawFeed).bytes),
          }))
      const { snapshot } = buildSnapshot({
        seq: this.meta.seq,
        nowMs: this.d.now(),
        indexes,
        tripUpdates: decode('TripUpdates'),
        vehiclePositions: decode('VehiclePositions'),
        alerts: this.alerts,
        previous: this.snapshot,
      })
      JSON.stringify(snapshot)
    }
    return { runs, seq: this.snapshot?.header.seq ?? null }
  }

  // ---------------------------------------------------------------- the cycle

  /** One poll cycle. Concurrent callers share the same run. */
  cycle(): Promise<void> {
    if (!this.running) this.running = this.runCycle().finally(() => (this.running = null))
    return this.running
  }

  private async runCycle(): Promise<void> {
    const t = { at: this.d.now() }
    const lap = () => {
      const n = this.d.now()
      const ms = n - t.at
      t.at = n
      return ms
    }
    const started = t.at
    this.puts = { n: 0, chars: 0 }
    const tm: Omit<CycleTimings, 'total' | 'r2Puts' | 'r2Chars'> = {
      restore: 0,
      indexes: 0,
      fetch: 0,
      decode: 0,
      build: 0,
      persist: 0,
      publish: 0,
      feeds: 0,
      changed: 0,
      rebuilt: false,
    }
    try {
      await this.runCycleTimed(lap, tm)
    } finally {
      const timings: CycleTimings = {
        ...tm,
        total: this.d.now() - started,
        r2Puts: this.puts.n,
        r2Chars: this.puts.chars,
      }
      this.lastTimings = timings
      if (this.d.profile || timings.total >= SLOW_CYCLE_MS) {
        const fields = { ...timings, seq: this.meta.seq }
        if (timings.total >= SLOW_CYCLE_MS) this.log.warn('rt cycle timings', fields)
        else this.log.info('rt cycle timings', fields)
      }
    }
  }

  private async runCycleTimed(
    lap: () => number,
    tm: Omit<CycleTimings, 'total' | 'r2Puts' | 'r2Chars'>,
  ): Promise<void> {
    await this.restore()
    tm.restore = lap()
    const now = this.d.now()
    const errors: string[] = []

    const indexesChanged = await this.stepIndexes(now, errors).catch((e) => {
      errors.push(`static: ${errorMessage(e)}`)
      return false
    })
    tm.indexes = lap()

    const due = this.feeds.filter((f) => f.kind !== 'alerts' || now - this.meta.alertsAt >= ALERTS_EVERY_MS)
    const fetched = await Promise.all(due.map((f) => this.fetchFeed(f, now)))
    tm.fetch = lap()
    tm.feeds = due.length
    const changed: FeedSpec[] = []
    fetched.forEach((r, i) => {
      const f = due[i] as FeedSpec
      if (r.error) errors.push(`${f.key}: ${r.error}`)
      if (!r.raw) {
        // 304: the same bytes, so the same header time, from a successful fetch.
        if (!r.error) this.watchSource(f, this.decoded.get(f.key), now)
        return
      }
      // Decode before adopting: a corrupt body keeps the previous good bytes (and stays out of the legacy proxy).
      try {
        const msg = fromBinary(FeedMessageSchema, r.raw.bytes)
        this.raw.set(f.key, r.raw)
        this.decoded.set(f.key, msg)
        this.watchSource(f, msg, now)
        if (f.kind === 'alerts') this.alerts = buildAlerts(msg, this.routeModes(), this.stopModes())
        changed.push(f)
      } catch (e) {
        errors.push(`${f.key}: decode failed: ${errorMessage(e)}`)
      }
    })
    const alertsFetched =
      due.some((f) => f.kind === 'alerts') && !fetched.some((r, i) => due[i]?.kind === 'alerts' && r.error)
    if (alertsFetched) this.meta.alertsAt = now

    // Alert modes come from the loaded routes and stops, so re-derive them when an index swaps in.
    const alertsFeed = this.decoded.get('alerts')
    if (indexesChanged && alertsFeed && !changed.some((f) => f.kind === 'alerts')) {
      this.alerts = buildAlerts(alertsFeed, this.routeModes(), this.stopModes())
    }

    tm.decode = lap()
    tm.changed = changed.length
    const writes: Record<string, unknown> = {}
    let rebuilt = false
    // A summary that arrived since the last build rewrites the alerts document (through a new snapshot and seq). The
    // stored summaries load first (one read, then a no-op), so alerts just refetched after a restart keep theirs.
    const summaries = this.d.summaries
    if (summaries) await summaries.load()
    const summariesMoved = summaries != null && summaries.version !== this.summariesBuilt
    if (changed.length > 0 || indexesChanged || !this.snapshot || summariesMoved) {
      const indexes: Partial<Record<Mode, ModeIndex>> = {}
      for (const [m, l] of this.modes) indexes[m] = l.index
      const pick = (kind: FeedSpec['kind']) =>
        this.feeds
          .filter((f) => f.kind === kind && this.decoded.has(f.key))
          .map((f) => ({ mode: f.mode, feed: this.decoded.get(f.key) as FeedMessage }))
      const tripUpdates = pick('TripUpdates')
      if (tripUpdates.length > 0) {
        const version = summaries?.version ?? -1
        const { snapshot, tripModes } = buildSnapshot({
          seq: this.meta.seq + 1,
          nowMs: now,
          indexes,
          tripUpdates,
          vehiclePositions: pick('VehiclePositions'),
          alerts: summaries ? summaries.attach(this.alerts) : this.alerts,
          previous: this.snapshot,
          unloadedModes: this.d.config.indexModes.filter((m) => !this.modes.has(m)),
        })
        this.snapshot = snapshot
        this.tripModes = tripModes
        this.summariesBuilt = version
        this.snapshotJson = null
        this.meta.seq = snapshot.header.seq
        rebuilt = true
        this.logSeqStats(snapshot, now)
        // With R2 bound the snapshot lives there as per-scope documents (merged back after a restart); keeping a
        // second copy in DO storage every cycle costs CPU.
        if (!this.d.r2) Object.assign(writes, this.snapshotWrites(this.fullJson() as string))
        // With R2 the stored copy isn't kept up to date, so meta stops naming it (a restore reads R2 instead).
        else this.meta.snapChunks = 0
      }
    }
    tm.build = lap()
    tm.rebuilt = rebuilt
    // Raw protobufs only matter after a restart (the legacy proxy serves memory first, and the hub refetches within
    // 15 s), so persist them at most once a minute: every cycle cost Free-plan CPU on staging.
    if (now - this.rawPersistedAt >= RAW_PERSIST_EVERY_MS) {
      for (const [key, raw] of this.raw) Object.assign(writes, this.rawWrites(key, raw))
      this.rawPersistedAt = now
    }

    // Persist first: the new seq is durably reserved before it is published, so a crash between the two can never
    // republish different content under a seq readers already hold (Codex review #1).
    if (rebuilt && this.d.r2) this.r2Pending = true
    this.meta.lastCycleAt = this.d.now()
    this.meta.lastError = errors.length > 0 ? errors.join('; ') : null
    writes.meta = { ...this.meta }
    await this.d.storage.put(writes)
    tm.persist = lap()

    // Publish (or retry a failed publish) even when nothing changed this cycle (Codex review #3), and write a pointer
    // an earlier publish skipped once its heartbeat is due.
    if (this.d.r2 && this.snapshot && (this.r2Pending || this.pointerOwed)) {
      try {
        await this.publishR2(now)
        this.r2Pending = false
      } catch (e) {
        errors.push(`r2: ${errorMessage(e)}`)
        this.meta.lastError = errors.join('; ')
        await this.d.storage.put({ meta: { ...this.meta } })
      }
    }
    tm.publish = lap()
    // Summaries for the alerts just fetched: started after the publish and never awaited, so generation can neither
    // delay nor fail a cycle (kick() catches everything and keeps one run in flight).
    if (alertsFetched && summaries) void summaries.kick(this.alerts)
    if (errors.length > 0) this.log.warn('rt cycle partial', { errors, seq: this.meta.seq })
  }

  /**
   * Publish to R2: the per-scope documents whose content changed, then the small `rt/latest.json` pointer (a reader
   * never sees a pointer to a missing object). With RT_R2_COMPRESS each changed document is gzipped first (about 7.8x
   * smaller on a real snapshot, for ~25 ms of CPU when all four modes change, under the hub's 2 s cpu_ms), so edge
   * readers fetch far fewer bytes, a cold isolate's first bus read above all. The ring of R2_KEEP_SNAPSHOTS alerts
   * keys keeps the bucket bounded without deletes.
   *
   * PUTs (hub R2 PUT budget, 20 Oct): a document is rewritten only when its content changed, compared without the
   * header fields that move every poll (seq, sourceTimestamp, fetchedAt, stats); an unchanged document keeps its
   * older seq and the pointer keeps naming it. The pointer itself is written when the alerts document moved to a new
   * ring key, and otherwise at most every POINTER_HEARTBEAT_MS, since mode readers take a fresh per-mode object
   * straight from its key (and accept one newer than the pointer, see pullFromR2); the pointer's other job, the hub
   * status for health and for unchanged documents, only needs to stay well inside the 120 s health and 300 s stale
   * limits.
   *
   * The documents are written in parallel, then the pointer (peak stall profiling, 19 Oct: one sequential PUT per
   * mode put four or five R2 round trips on every poll). A partial failure leaves what a sequential one did: some
   * latest objects newer than the pointer, which readers accept (see pullFromR2), and a retry next poll.
   */
  private async publishR2(now: number): Promise<void> {
    const r2 = this.d.r2 as R2Like
    const snap = this.snapshot as RtSnapshot
    const seq = this.meta.seq
    if (this.r2Pending) {
      const gz = this.compress
      // A document as stored: gzip (RT_R2_COMPRESS) or plain JSON. Its header seq also goes in customMetadata, so the
      // restore's seq sweep (headSeq) reads it without the body, which is not JSON when compressed.
      const stored = (text: string): Promise<string | Uint8Array> => (gz ? gzip(text) : Promise.resolve(text))
      const docOpts = (s: number) => ({
        httpMetadata: { contentType: 'application/json', ...(gz ? { contentEncoding: 'gzip' } : {}) },
        customMetadata: { seq: String(s) },
      })
      // Per-mode documents (§3.3 split). Layout `combined`: all in one object, overwritten in place (an edge isolate
      // still reads only the mode it serves, with ranged GETs). Layout `documents`: one overwritten
      // `rt/{mode}/latest.json` per mode. R2 PUTs are atomic and readers check sizes, etags and seqs, so no deletes are
      // needed. Alerts go to a ring slot named by the pointer.
      const combined = this.layout === 'combined'
      const keyFor = (m: Mode) => (combined ? COMBINED_KEY : modeLatestKey(m))
      const docs = splitSnapshot(snap, this.tripModes, this.d.config.modes)
      // One entry per PUT: the scopes it writes and what each will then hold.
      const writes: Array<Array<[SnapshotScope, Published]>> = []
      const sections: SectionInput[] = []
      // Each changed mode, with what it will hold and its JSON.
      const changed: Array<[Mode, Published, string]> = []
      for (const m of this.d.config.modes) {
        const doc = docs[m] as RtSnapshot
        const body = documentBody(doc)
        const content = documentContent(doc.header, body)
        const prev = this.published.get(m)
        // RT_R2_COMPRESS is fixed for a hub's lifetime and a new hub starts with nothing published, so a change of
        // encoding always rewrites every document.
        if (prev?.content === content && prev.key === keyFor(m) && (prev.section != null || !combined)) {
          if (prev.section != null) sections.push({ mode: m, bytes: prev.section, seq: prev.seq })
          continue
        }
        changed.push([m, { content, key: keyFor(m), seq }, documentJson(doc.header, body)])
      }
      const alerts = alertsDocument(snap)
      const alertsBody = documentBody(alerts)
      const alertsContent = documentContent(alerts.header, alertsBody)
      const alertsJson =
        this.published.get('alerts')?.content !== alertsContent
          ? documentJson(alerts.header, alertsBody)
          : null
      // Only changed documents are compressed (an unchanged combined section carries its stored bytes over), all
      // before the first PUT starts.
      const bodies = await Promise.all(changed.map(([, , text]) => stored(text)))
      const alertsStored = alertsJson != null ? await stored(alertsJson) : null
      const puts: Promise<unknown>[] = []
      if (!combined) {
        changed.forEach(([m, p], i) => {
          puts.push(this.put(r2, p.key, bodies[i] as string | Uint8Array, docOpts(seq)))
          writes.push([[m, p]])
        })
      } else if (changed.length > 0) {
        const enc = new TextEncoder()
        changed.forEach(([m, p], i) => {
          const b = bodies[i] as string | Uint8Array
          p.section = typeof b === 'string' ? enc.encode(b) : b
          sections.push({ mode: m, bytes: p.section, seq })
        })
        const head = { seq, sourceTimestamp: snap.header.sourceTimestamp, fetchedAt: snap.header.fetchedAt }
        const bytes = encodeCombined({ ...head, cycleMs: this.cycleMs }, sections)
        // Not Content-Encoding gzip: the object as a whole (a plain index, then the sections) is not one gzip stream.
        puts.push(
          this.put(r2, COMBINED_KEY, bytes, { httpMetadata: { contentType: 'application/octet-stream' } }),
        )
        writes.push(changed.map(([m, p]) => [m, p]))
      }
      if (alertsStored != null) {
        const key = scopeKey('alerts', seq)
        puts.push(this.put(r2, key, alertsStored, docOpts(seq)))
        writes.push([['alerts', { content: alertsContent, key, seq }]])
      }
      // Every PUT settles before the publish (and so the poll) ends: a failed sibling must not leave another PUT
      // running that could land after the next poll's and roll its document back (Codex r1).
      const settled = await Promise.allSettled(puts)
      // Record each scope as it now stands, failures included (Codex review A r1): a written document is what R2
      // holds even if a sibling failed, and a failed one may or may not have landed, so it is forgotten and rewritten
      // with the next publish whatever its content then.
      // For the combined object that means the modes it changed: if it failed, they are forgotten, so a later
      // reversion to their older content gets a new seq rather than one older than a version that may have landed.
      settled.forEach((r, i) => {
        for (const [scope, p] of writes[i] ?? []) {
          if (r.status === 'fulfilled') this.published.set(scope, p)
          else this.published.delete(scope)
          if (r.status !== 'fulfilled') continue
          // A new alerts slot needs the pointer at once, even if this publish fails and the next finds nothing new.
          if (scope === 'alerts') this.alertsMoved = true
          else if (combined) this.combinedSeq = seq
        }
      })
      const failed = settled.find((r) => r.status === 'rejected')
      if (failed) throw failed.reason
    }
    const due =
      this.pointerAt === 0 || this.alertsMoved || now - this.pointerAt >= POINTER_HEARTBEAT_MS - POLL_SLACK_MS
    if (!due) {
      this.pointerOwed = true
      return
    }
    // The pointer names the layout readers should use. `combined`: modes only through `combined`, so a reader that
    // predates it finds no per-mode entry rather than a key it can't parse (hence the RT_R2_LAYOUT switch-over, see
    // HubDeps.layout). `documents`: each mode's latest object, as before.
    const files: NonNullable<R2Pointer['files']> = {}
    for (const [scope, p] of this.published) {
      if (scope === 'alerts' || (this.layout === 'documents' && this.d.config.modes.includes(scope))) {
        files[scope] = { key: p.key, seq: p.seq }
      }
    }
    const pointer: R2Pointer = { seq, files, fetchedAt: now, status: this.status() }
    if (this.layout === 'combined' && this.combinedSeq > 0) {
      pointer.combined = { key: COMBINED_KEY, seq: this.combinedSeq }
    }
    await this.put(r2, R2_LATEST_KEY, JSON.stringify(pointer), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    })
    this.pointerAt = now
    this.pointerOwed = false
    this.alertsMoved = false
  }

  /** Feed the per-feed source watch: TripUpdates and VehiclePositions (alerts headers may rightly stand still). */
  /** Per-mode seqMismatch / seqDropped from this snapshot, at most once per SEQ_LOG_EVERY_MS and only when non-zero. */
  private logSeqStats(snapshot: RtSnapshot, now: number): void {
    if (now - this.seqLoggedAt < SEQ_LOG_EVERY_MS) return
    const fields: Record<string, number> = {}
    for (const [m, st] of Object.entries(snapshot.header.stats ?? {})) {
      if (st?.seqMismatch) fields[`${m}SeqMismatch`] = st.seqMismatch
      if (st?.seqDropped) fields[`${m}SeqDropped`] = st.seqDropped
    }
    if (Object.keys(fields).length === 0) return
    this.seqLoggedAt = now
    this.log.info('rt seq mismatch', { ...fields, seq: snapshot.header.seq })
  }

  private watchSource(f: FeedSpec, msg: FeedMessage | undefined, now: number): void {
    if (f.kind === 'alerts' || !msg?.header) return
    this.sources.observe(f.key, Number(msg.header.timestamp), now, this.meta.seq)
  }

  /** Feeds whose TransLink header time is currently frozen (tests). */
  staleSources(): string[] {
    return this.sources.stale()
  }

  /** One R2 PUT, counted for the poll's timings. */
  private put(
    r2: R2Like,
    key: string,
    body: string | Uint8Array,
    opts: Parameters<R2Like['put']>[2],
  ): Promise<unknown> {
    this.puts.n++
    this.puts.chars += typeof body === 'string' ? body.length : body.byteLength
    return r2.put(key, body, opts)
  }

  private async fetchFeed(f: FeedSpec, now: number): Promise<{ raw?: RawFeed; error?: string }> {
    const prev = this.raw.get(f.key)
    const headers: Record<string, string> = { accept: 'application/x-protobuf' }
    if (prev?.etag) headers['if-none-match'] = prev.etag
    // An explicit timer (cleared in finally) rather than AbortSignal.timeout: a pending timeout timer keeps the
    // DO invocation alive for the full 5 s and bills it as duration.
    const ctl = new AbortController()
    const timer = setTimeout(
      () => ctl.abort(new Error('upstream timeout')),
      this.d.fetchTimeoutMs ?? FETCH_TIMEOUT_MS,
    )
    try {
      const res = await this.d.fetch(`${this.d.upstream}/${f.key}`, { headers, signal: ctl.signal })
      if (res.status === 304) return {}
      if (!res.ok) return { error: `HTTP ${res.status}` }
      const bytes = new Uint8Array(await res.arrayBuffer())
      return { raw: { bytes, etag: res.headers.get('etag'), fetchedAt: now } }
    } catch (e) {
      return { error: errorMessage(e) }
    } finally {
      clearTimeout(timer)
    }
  }

  private stopModes(): Map<string, Mode> {
    const m = new Map<string, Mode>()
    for (const [mode, l] of this.modes) for (const id of l.index.stopIds) m.set(id, mode)
    return m
  }

  private routeModes(): Map<string, Mode> {
    const m = new Map<string, Mode>()
    for (const [mode, l] of this.modes) for (const k of l.index.routesByKey.keys()) m.set(k, mode)
    return m
  }

  /**
   * Keep yesterday's and today's trip indexes loaded for each polled mode, reloading when the manifest's
   * generation changes. A mode swaps in only when all its days are indexed, so the snapshot never mixes
   * generations. Returns true when a mode's index was swapped in.
   *
   * - A mode with no index at all (a fresh hub after a deploy or eviction, or one whose load failed) is loaded
   *   whole in this cycle, together with every other such mode: see loadUnindexed.
   * - A loaded mode whose generation or dates moved on reloads one TripIndexDay per cycle while the old index keeps
   *   serving (the Phase 0 limit, set for Workers Free's 10 ms CPU, still bounds steady-state work and memory).
   *
   * Per-mode failures go to `errors`; the other modes still load, and a failed mode is retried next cycle.
   */
  private async stepIndexes(now: number, errors: string[]): Promise<boolean> {
    const today = brisbaneDate(now)
    const want = [addDays(today, -1), today]
    const manifest = await this.d.store.getManifest()
    if (!manifest) throw new Error('no manifest.json')
    const unindexed = this.d.config.indexModes.filter(
      (m) => !this.modes.has(m) && this.pending?.mode !== m && manifest.modes[m]?.current,
    )
    const loaded = unindexed.length > 0 ? await this.loadUnindexed(unindexed, manifest, want, errors) : false
    try {
      return (await this.stepReload(manifest, want)) || loaded
    } catch (e) {
      errors.push(`static: ${errorMessage(e)}`)
      return loaded
    }
  }

  /**
   * Load every given mode's days in this one cycle (cold-start review, 20 Oct: one day per cycle left the last
   * mode, bus, without RT for ~90 s after every deploy). All the blobs are fetched at once (the wall time is R2
   * round trips); decoding, parsing and indexing run one day at a time, so at most one parsed day is alive at once.
   * Local evidence only (scripts/coldload.ts in Node: real data, restored snapshot, combined feeds): the whole first
   * cycle, all four modes, ~390-500 ms CPU and a live peak of ~72-79 MB for the whole process, against eight cycles
   * of up to ~240 ms and 70-88 MB for one day per cycle. That leaves room under cpu_ms 2000 and the 128 MB isolate,
   * but the Durable Object's own CPU and memory are confirmed on staging (wrangler tail), not here.
   */
  private async loadUnindexed(
    modes: Mode[],
    manifest: Manifest,
    want: string[],
    errors: string[],
  ): Promise<boolean> {
    const jobs = modes.map((mode) => {
      const generation = manifest.modes[mode]?.current as string
      // Started together. Each day's read settles to its bytes or its error, so none rejects unobserved while an
      // earlier day is being indexed.
      const days = this.d.store.getIndex(generation, mode).then((index) => {
        if (!index) throw new Error(`index ${generation}/${mode} missing`)
        return want
          .filter((d) => index.tripIndex?.[d])
          .map(
            (date): DayRead => ({
              date,
              bytes: this.d.store.tripIndexDayBytes(index, date).then(
                (b) => b ?? new Error(`trip index ${mode} ${generation} ${date} missing`),
                (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
              ),
            }),
          )
      })
      return {
        mode,
        generation,
        days: days as typeof days | null,
        index: new ModeIndex(mode, []),
        dates: [] as string[],
        failed: false,
      }
    })
    const fail = (j: (typeof jobs)[number], e: unknown): null => {
      if (!j.failed) errors.push(`static ${j.mode}: ${errorMessage(e)}`)
      j.failed = true
      return null
    }
    const listed = await Promise.all(jobs.map((j) => (j.days as Promise<DayRead[]>).catch((e) => fail(j, e))))
    // Drop the settled promises: from here each day's bytes are reachable only from its step (r1 review), so a
    // consumed buffer is released once indexed.
    for (const j of jobs) j.days = null
    // In date order, as stepReload adds them (all in this invocation, so no mode waits on another's yesterday).
    const steps = want.flatMap((date) =>
      jobs.flatMap((job, i) => {
        const day = listed[i]?.find((d) => d.date === date)
        return day ? [{ job, day }] : []
      }),
    )
    const hasDays = listed.map((l) => (l?.length ?? 0) > 0)
    listed.length = 0
    for (const s of steps) {
      const bytes = await s.day.bytes
      s.day.bytes = null
      if (s.job.failed) continue
      try {
        if (bytes instanceof Error) throw bytes
        s.job.index.addDay(await this.d.store.decodeTripIndexDay(bytes as Uint8Array))
        s.job.dates.push(s.day.date)
      } catch (e) {
        fail(s.job, e)
      }
    }
    let changed = false
    for (const [i, j] of jobs.entries()) {
      // A mode with no day to load (its generation doesn't cover these dates) stays unindexed, as before.
      if (j.failed || !hasDays[i]) continue
      const dates = want.filter((d) => j.dates.includes(d))
      this.modes.set(j.mode, { generation: j.generation, dates, index: j.index })
      this.log.info('rt trip index loaded', { mode: j.mode, generation: j.generation, dates, cold: true })
      changed = true
    }
    return changed
  }

  /**
   * Steady state, for modes already indexed: reload one TripIndexDay per cycle (see the Phase 0 measurements for
   * the CPU cost) and swap the mode in when complete. Returns true when a mode's index was swapped.
   */
  private async stepReload(manifest: Manifest, want: string[]): Promise<boolean> {
    if (this.pending) {
      const p = this.pending
      const index = await this.d.store.getIndex(p.generation, p.mode)
      const date = p.dates[p.loaded] as string
      const day = index ? await this.d.store.tripIndexDay(index, date) : null
      if (!day) throw new Error(`trip index ${p.mode} ${p.generation} ${date} missing`)
      p.index.addDay(day)
      p.loaded++
      if (p.loaded === p.dates.length) {
        this.modes.set(p.mode, { generation: p.generation, dates: p.dates, index: p.index })
        this.pending = null
        this.log.info('rt trip index loaded', { mode: p.mode, generation: p.generation, dates: p.dates })
        return true
      }
      return false
    }
    for (const mode of this.d.config.indexModes) {
      const generation = manifest.modes[mode]?.current
      if (!generation) continue
      const loaded = this.modes.get(mode)
      if (!loaded) continue
      const index = await this.d.store.getIndex(generation, mode)
      if (!index) throw new Error(`index ${generation}/${mode} missing`)
      const dates = want.filter((d) => index.tripIndex?.[d])
      if (dates.length === 0) continue
      if (loaded.generation === generation && same(loaded.dates, dates)) continue
      this.pending = { mode, generation, dates, index: new ModeIndex(mode, []), loaded: 0 }
      return this.stepReload(manifest, want)
    }
    return false
  }

  // ---------------------------------------------------------------- persistence

  private snapshotWrites(json: string): Record<string, unknown> {
    const w: Record<string, unknown> = {}
    const n = Math.max(1, Math.ceil(json.length / CHUNK_CHARS))
    for (let i = 0; i < n; i++) w[`snap:${i}`] = json.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS)
    this.meta.snapChunks = n
    return w
  }

  private rawWrites(key: string, feed: RawFeed): Record<string, unknown> {
    const n = Math.max(1, Math.ceil(feed.bytes.byteLength / CHUNK_BYTES))
    const w: Record<string, unknown> = {
      [`raw:${key}`]: { etag: feed.etag, fetchedAt: feed.fetchedAt, chunks: n },
    }
    for (let i = 0; i < n; i++)
      w[`raw:${key}:${i}`] = feed.bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)
    return w
  }

  /**
   * Merge the mode documents the pointer names (per-mode documents, or the combined object) with its alerts document.
   * Reads only: what it learns goes into `r`, applied by applyRestore.
   */
  private async restoreFromDocuments(pointer: R2Pointer, r: Restored): Promise<RtSnapshot | null> {
    const r2 = this.d.r2 as R2Like
    // The combined mode object: accepted at or after the seq the pointer names (it is overwritten before the
    // pointer, like the per-mode latest objects it replaces), and only when its index, size and sections agree.
    const readCombined = async (c: {
      key: string
      seq: number
    }): Promise<Array<[Mode, RtSnapshot]> | null> => {
      if (!r2.get) return null
      const obj = await r2.get(c.key)
      if (!obj) return null
      // I/O errors (the GET, the body) propagate, so the restore is retried. Everything after works on content:
      // whatever is wrong with it, the object counts as missing, never as a restore that fails forever (Codex r4
      // and r8 on #100).
      const bytes = await objectBytes(obj)
      try {
        // The index's seq counts even when its sections, size or documents are unusable: it may be past the
        // pointer, and a seq left unread could be reused by the next build (Codex r2 and r4).
        const indexSeq = combinedIndexSeq(bytes)
        if (indexSeq != null && indexSeq > r.seq) r.seq = indexSeq
        // Sections may be gzip (RT_R2_COMPRESS); one that doesn't decompress makes the object missing.
        const got = await decodeCombined(bytes)
        if (!got || !Number.isSafeInteger(got.index.seq) || got.index.seq < c.seq) return null
        const docs: Array<[Mode, RtSnapshot]> = []
        for (const d of got.docs) {
          // A malformed section, or one under an unknown mode name, makes the whole object unusable (missing).
          if (!MODES.has(d.mode)) return null
          const doc = parseSnapshot(d.json)
          if (!doc) return null
          docs.push([d.mode, doc])
        }
        return docs
      } catch {
        return null
      }
    }
    const read = async (e: { key: string; seq: number } | undefined): Promise<RtSnapshot | null> => {
      if (!e || !r2.get) return null
      // I/O errors propagate (the restore is retried); a problem with the content makes the document missing, so
      // the fallbacks below apply rather than a restore that fails forever (Codex r8 on #100).
      const obj = await r2.get(e.key)
      // Plain or gzip (RT_R2_COMPRESS); one that doesn't decompress counts as missing.
      const text = obj ? await documentText(obj) : null
      if (text == null) return null
      try {
        const seq = snapshotSeq(text)
        if (!Number.isSafeInteger(seq)) return null
        const n = seq as number
        // A per-mode latest object is overwritten before the pointer: after a partial publish it can be newer than
        // the pointer, and it is that mode's newest committed content, so accept it and move the seq watermark past
        // it (Codex review of #49). Ring slots (alerts) must match exactly.
        const overwritten = e.key.endsWith('/latest.json')
        if (overwritten ? n < e.seq : n !== e.seq) return null
        if (n > r.seq) r.seq = n
        return parseSnapshot(text)
      } catch {
        return null
      }
    }
    const load = async (f: NonNullable<R2Pointer['files']>, combined?: R2Pointer['combined']) => {
      // Read every named document even after one fails: each read moves the seq watermark (a mode document can be
      // newer than the pointer), and one left unread could have its seq reused by the next build (Codex r2 on #100).
      const docs: Array<[Mode, RtSnapshot]> = []
      let complete = true
      if (combined) {
        const got = await readCombined(combined)
        if (got) docs.push(...got)
        else complete = false
      }
      for (const [scope, e] of Object.entries(f)) {
        // With the combined object the pointer names modes only through it.
        if (scope === 'alerts' || combined) continue
        if (!MODES.has(scope)) {
          complete = false
          continue
        }
        const d = await read(e)
        if (d) docs.push([scope as Mode, d])
        else complete = false
      }
      const alerts = f.alerts ? await read(f.alerts) : null
      if (!complete || (f.alerts && !alerts)) return null
      return { docs, alerts }
    }
    // A slot overwritten between our reads fails its seq check: re-read the pointer and try once more.
    let got = await load(pointer.files ?? {}, pointer.combined)
    if (!got && r2.get) {
      const ptr = await r2.get(R2_LATEST_KEY)
      const again = ptr ? (JSON.parse(await ptr.text()) as R2Pointer) : null
      // Never reuse a published seq: the re-read pointer may be newer than the one restore() started from.
      if (again && again.seq > r.seq) r.seq = again.seq
      if (again?.files || again?.combined) got = await load(again.files ?? {}, again.combined)
      if (!got && (again?.files || again?.combined)) {
        // Still inconsistent: restore the mode documents without alerts and refetch alerts on the next cycle (they
        // are rewritten within one poll), rather than lose the retained cancellations with the whole restore.
        const { alerts: _skip, ...modesOnly } = again.files ?? {}
        got = await load(modesOnly, again.combined)
        r.alertsStale = true
        this.log.warn('rt restore without alerts (alerts document failed its seq check)')
      }
    }
    if (!got) return null
    // Ownership: a trip in exactly one mode document belongs to that mode; one in several (carried while its mode
    // was unloaded) stays unassigned so every mode document keeps it (Codex review of the split).
    const seen = new Map<string, Mode | null>()
    for (const [m, d] of got.docs) for (const k of Object.keys(d.trips)) seen.set(k, seen.has(k) ? null : m)
    for (const [k, m] of seen) if (m) r.tripModes.set(k, m)
    return mergeDocuments(
      got.docs.map(([, d]) => d),
      got.alerts,
    )
  }

  /**
   * After an eviction or restart: restore the sequence, the last snapshot and the watchdog clock. Every entry point
   * (alarm cycle, pull, the watchdog, benchmark) awaits this one in-flight promise, and `restored` is set only once
   * the restore has applied, so no cycle can build or publish a seq that the restore then overwrites with an older
   * snapshot (Codex r1/r2 on #96). A failed restore applies nothing and clears the promise: the next call retries.
   */
  private restore(): Promise<void> {
    if (this.restored) return Promise.resolve()
    this.restoring ??= this.readRestore()
      .then((r) => {
        this.applyRestore(r)
        this.restored = true
      })
      .finally(() => {
        this.restoring = null
      })
    return this.restoring
  }

  /**
   * The reads of a restore, into a local result (nothing on `this` changes until applyRestore). Everything is parsed
   * here, so applying cannot throw (Codex r1).
   */
  private async readRestore(): Promise<Restored> {
    const meta = await this.d.storage.get<Meta>('meta')
    const r: Restored = {
      meta,
      seq: meta?.seq ?? 0,
      snapshot: null,
      tripModes: new Map(),
      alertsStale: false,
    }
    // The DO-storage copy is the snapshot only without R2: with R2 bound a cycle never writes it, so one left from
    // before R2 can be any age. Then R2's documents come first and the stored copy is only a fallback (staging,
    // 26 Oct: a pre-R2 copy was restored over R2 and its 63 alerts published, instead of 90, until the next fetch).
    const readStored = async (): Promise<RtSnapshot | null> => {
      if (!meta || meta.snapChunks <= 0) return null
      const parts: string[] = []
      for (let i = 0; i < meta.snapChunks; i++) {
        const p = await this.d.storage.get<string>(`snap:${i}`)
        if (p == null) break
        parts.push(p)
      }
      // A malformed stored copy counts as missing.
      return parts.length === meta.snapChunks ? parseSnapshot(parts.join('')) : null
    }
    if (!this.d.r2?.get) r.snapshot = await readStored()
    if (this.d.r2?.get) {
      const ptr = await this.d.r2.get(R2_LATEST_KEY)
      const pointer = ptr ? (JSON.parse(await ptr.text()) as R2Pointer) : null
      // Never reuse a published seq (Codex review #1): continue after whatever R2 already holds, even when this
      // object's own storage is empty or behind.
      if (pointer && pointer.seq > r.seq) r.seq = pointer.seq
      // Which layout's objects the restore read (and so took seqs from).
      let readLayout: 'documents' | 'combined' | null = null
      if (!r.snapshot && (pointer?.files || pointer?.combined)) {
        r.snapshot = await this.restoreFromDocuments(pointer, r)
        readLayout = pointer.combined ? 'combined' : 'documents'
      } else if (!r.snapshot && pointer?.key) {
        const obj = await this.d.r2.get(pointer.key)
        const text = obj ? await obj.text() : null
        // A ring slot may already hold a newer snapshot than the pointer names: only adopt the matching one.
        r.snapshot = text != null && snapshotSeq(text) === pointer.seq ? parseSnapshot(text) : null
      }
      // Nothing usable in R2 (a first publish not yet made, or unreadable objects): the stored copy, if any.
      if (!r.snapshot) r.snapshot = await readStored()
      // A layout switch (RT_R2_LAYOUT) whose object PUT landed but whose pointer PUT failed leaves a seq only the
      // other layout's objects record: take the seqs of whatever this restore did not read too (Codex r11 on #100).
      // Each cycle persists meta (with its new seq) before publishing, so while meta exists it already reserves every
      // published seq. Without it (DO storage lost), any object a partial publish wrote can hold a seq nothing else
      // records: an alerts slot, or a mode document the pointer doesn't name (a mode added to RT_MODES whose PUT alone
      // landed). Sweep every object a hub of this release writes then: the combined object, every supported mode's
      // latest document and the whole alerts ring (Codex r12 and r13 on #100).
      if (!meta) {
        await this.combinedSeqInto(r)
        await this.documentSeqsInto(r, Mode.options)
        await this.alertsRingSeqsInto(r)
      } else {
        if (readLayout !== 'combined') await this.combinedSeqInto(r)
        if (readLayout !== 'documents') await this.documentSeqsInto(r, this.d.config.modes)
      }
    }
    return r
  }

  /** Watermark only: the header seq of every alerts ring slot. I/O errors propagate; bad content is ignored. */
  private async alertsRingSeqsInto(r: Restored): Promise<void> {
    const r2 = this.d.r2 as R2Like
    const BATCH = 24
    for (let from = 0; from < R2_KEEP_SNAPSHOTS; from += BATCH) {
      const slots = Array.from({ length: Math.min(BATCH, R2_KEEP_SNAPSHOTS - from) }, (_, i) => from + i)
      const seqs = await Promise.all(slots.map((n) => this.headSeq(r2, scopeKey('alerts', n))))
      for (const seq of seqs) if (seq != null && seq > r.seq) r.seq = seq
    }
  }

  /**
   * A document's header seq from its first HEAD_BYTES (a ranged GET: the header is serialised first, see
   * documentJson), or from the whole object when that prefix holds no complete seq. Null when there is no object or
   * no valid seq. I/O errors propagate (the restore is retried).
   *
   * A compressed document (RT_R2_COMPRESS) starts with gzip bytes, not JSON, so its prefix holds no seq: the hub
   * writes the header seq into its customMetadata too, which the same ranged GET returns. A gzip document without it
   * is read whole and decompressed; one that doesn't decompress counts as having no seq, like any bad content.
   */
  private async headSeq(r2: R2Like, key: string): Promise<number | null> {
    const head = await r2.get?.(key, { range: { offset: 0, length: HEAD_BYTES } })
    if (!head) return null
    const meta = metadataSeq(head.customMetadata)
    if (meta != null) return meta
    const prefix = await objectBytes(head)
    const seq = isGzip(prefix) ? null : prefixSeq(new TextDecoder().decode(prefix))
    if (seq != null) return seq
    const whole = await r2.get?.(key)
    const text = whole ? await documentText(whole) : null
    return text != null ? textSeq(text) : null
  }

  /** Watermark only: the combined object's index seqs. I/O errors propagate (retry); bad content is ignored. */
  private async combinedSeqInto(r: Restored): Promise<void> {
    // Only the index (the first INDEX_BYTES, by the format): reading more could not add a seq.
    // The index is plain JSON whether or not the sections are compressed.
    const obj = await (this.d.r2 as R2Like).get?.(COMBINED_KEY, { range: { offset: 0, length: INDEX_BYTES } })
    if (!obj) return
    const seq = combinedIndexSeq(await objectBytes(obj))
    if (seq != null && seq > r.seq) r.seq = seq
  }

  /** Watermark only: each given mode's latest document's header seq. I/O errors propagate; bad content is ignored. */
  private async documentSeqsInto(r: Restored, modes: readonly Mode[]): Promise<void> {
    const r2 = this.d.r2 as R2Like
    for (const m of modes) {
      const seq = await this.headSeq(r2, modeLatestKey(m))
      if (seq != null && seq > r.seq) r.seq = seq
    }
  }

  /**
   * Apply a restore in one synchronous step. The seq only moves forward, and a restored snapshot never replaces a
   * newer one already held. The change-only publish state (`published`, `pointerAt`) is left empty: R2's content is
   * not known from here, so the first publish after a restore rewrites every document and the pointer.
   */
  private applyRestore(r: Restored): void {
    const held = this.meta.seq
    if (r.meta) this.meta = { ...this.meta, ...r.meta }
    this.meta.seq = Math.max(held, r.seq)
    if (r.alertsStale) this.meta.alertsAt = 0
    const snapshot = r.snapshot
    if (!snapshot) return
    // Backstop: whichever document it came from, the next build goes past the restored snapshot's own seq.
    if (snapshot.header.seq > this.meta.seq) this.meta.seq = snapshot.header.seq
    if (this.snapshot && this.snapshot.header.seq >= snapshot.header.seq) return
    this.snapshotJson = null // serialised on demand (fullJson)
    this.snapshot = snapshot
    this.alerts = snapshot.alerts
    // Restored alerts are only as new as the document they came from (a failed publish before the restart leaves
    // them older than meta.alertsAt says): refetch them in the first cycle, one feed request per restart.
    this.meta.alertsAt = 0
    for (const [k, m] of r.tripModes) this.tripModes.set(k, m)
  }
}

/** What a restore read, before it is applied. */
interface Restored {
  meta: Meta | undefined
  /** The highest seq seen in DO storage or R2: the next build goes past it. */
  seq: number
  snapshot: RtSnapshot | null
  /** Trip ownership from the per-scope documents. */
  tripModes: Map<string, Mode>
  /** The alerts document failed its seq check: refetch alerts on the next cycle. */
  alertsStale: boolean
}

/** One trip-index day being read by loadUnindexed: its bytes (or why not), cleared once consumed. */
interface DayRead {
  date: string
  bytes: Promise<Uint8Array | Error> | null
}

const MODES: ReadonlySet<unknown> = new Set(Mode.options)

/** The header of a document fits well inside this (schemaVersion, then seq, are its first fields). */
export const HEAD_BYTES = 512

/** The seq of a document prefix, only when the prefix holds the whole field (the number is followed by , or }). */
function prefixSeq(prefix: string): number | null {
  const m = /^\{"header":\{"schemaVersion":\d+,"seq":(\d+)[,}]/.exec(prefix)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) ? n : null
}

/** The header seq a compressed document carries in its customMetadata (see publishR2), if valid. */
function metadataSeq(meta: Record<string, string> | undefined): number | null {
  const v = meta?.seq
  if (v == null || !/^\d+$/.test(v)) return null
  const n = Number(v)
  return Number.isSafeInteger(n) ? n : null
}

type R2Got = NonNullable<Awaited<ReturnType<NonNullable<R2Like['get']>>>>

/** An object's bytes (R2 gives an ArrayBuffer; a text-only test double gives text). I/O errors propagate. */
async function objectBytes(obj: R2Got): Promise<Uint8Array> {
  return obj.arrayBuffer
    ? new Uint8Array(await obj.arrayBuffer())
    : new TextEncoder().encode(await obj.text())
}

/**
 * A document's JSON text, gunzipped when stored compressed (RT_R2_COMPRESS). I/O errors propagate (the restore is
 * retried); a gzip stream that doesn't decompress (corrupt, truncated) is bad content: null.
 */
async function documentText(obj: R2Got): Promise<string | null> {
  const bytes = await objectBytes(obj)
  try {
    return await decodeText(bytes)
  } catch {
    return null
  }
}

/** A whole document's header seq, if valid (bad content counts as none). */
function textSeq(text: string): number | null {
  try {
    const seq = snapshotSeq(text)
    return Number.isSafeInteger(seq) ? (seq as number) : null
  } catch {
    return null
  }
}

/** A trip record as buildSnapshot's carry path reads it: a string key, `until` a number if present. */
const isTripRecord = (t: unknown): boolean => {
  if (t == null || typeof t !== 'object' || Array.isArray(t)) return false
  const r = t as { key?: unknown; until?: unknown; gen?: unknown }
  return (
    typeof r.key === 'string' &&
    (r.until == null || Number.isFinite(r.until)) &&
    (r.gen === undefined || typeof r.gen === 'string')
  )
}

/**
 * A snapshot document, or null when it is not JSON with the shape restore and the next build rely on (header seq,
 * string staticGeneration values and string serviceDates; every trip a record as isTripRecord checks, every vehicle an object whose `mode`
 * (if any) is a known mode and every alert an object with a `modes` array: the per-scope split reads both).
 * A cheap structural check, not the full schema, which would cost too much of the Free plan's CPU budget per
 * restore (Codex r4 to r10 on #100).
 */
function parseSnapshot(text: string): RtSnapshot | null {
  let s: RtSnapshot
  try {
    s = JSON.parse(text) as RtSnapshot
  } catch {
    return null
  }
  const h = s?.header
  const isObject = (v: unknown) => v != null && typeof v === 'object' && !Array.isArray(v)
  const ok =
    isObject(h) &&
    Number.isSafeInteger(h.seq) &&
    isObject(h.staticGeneration) &&
    Object.values(h.staticGeneration).every((g) => typeof g === 'string') &&
    Array.isArray(h.serviceDates) &&
    h.serviceDates.every((d) => typeof d === 'string') &&
    isObject(s.trips) &&
    Array.isArray(s.vehicles) &&
    Array.isArray(s.alerts) &&
    Object.values(s.trips).every(isTripRecord) &&
    s.vehicles.every((v) => isObject(v) && (v.mode === undefined || MODES.has(v.mode))) &&
    s.alerts.every((a) => isObject(a) && Array.isArray((a as { modes?: unknown }).modes))
  return ok ? s : null
}

/**
 * The highest seq a combined object's index names (its own, or any section's), read without its other checks: only
 * for the seq watermark (Codex r4 and r7 on #100).
 */
function combinedIndexSeq(bytes: Uint8Array): number | null {
  try {
    const idx = JSON.parse(new TextDecoder().decode(bytes.subarray(0, INDEX_BYTES))) as {
      seq?: unknown
      sections?: unknown
    }
    const seqs = [idx?.seq]
    if (idx?.sections && typeof idx.sections === 'object')
      for (const s of Object.values(idx.sections)) if (Array.isArray(s)) seqs.push(s[2])
    const ok = seqs.filter((n): n is number => Number.isSafeInteger(n))
    return ok.length > 0 ? Math.max(...ok) : null
  } catch {
    return null
  }
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0] as Uint8Array
  const out = new Uint8Array(parts.reduce((a, p) => a + p.byteLength, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.byteLength
  }
  return out
}
