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
import { type Alert, addDays, brisbaneDate, type Mode, type RtSnapshot } from '@bft/core'
import { fromBinary } from '@bufbuild/protobuf'
import type { StaticStore } from '../data/static-store.ts'
import { type FeedMessage, FeedMessageSchema } from '../gen/gtfs-realtime_pb.js'
import { errorMessage, type Logger, silentLogger } from '../log.ts'
import { buildAlerts, buildSnapshot, ModeIndex } from './build.ts'
import { type FeedSpec, feedsFor, type RtConfig } from './feeds.ts'
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
  /** Per-scope documents: each mode's snapshot, and the alerts document (rewritten only when alerts change). */
  files?: Partial<Record<SnapshotScope, { key: string; seq: number }>>
  fetchedAt: number
  status: HubStatus
}

/** Ring key of a per-scope snapshot document. */
/** The per-mode document an edge isolate refreshes from with one read (overwritten every poll). */
export const modeLatestKey = (mode: Mode) => `rt/${mode}/latest.json`

export const scopeKey = (scope: SnapshotScope, seq: number) =>
  `rt/${scope}/snapshot-${seq % R2_KEEP_SNAPSHOTS}.json`

export interface R2Like {
  get?(key: string): Promise<{ text(): Promise<string> } | null>
  put(
    key: string,
    value: Uint8Array | string,
    opts?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
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
  private snapshot: RtSnapshot | null = null
  private snapshotJson: string | null = null
  private readonly raw = new Map<string, RawFeed>()
  private readonly decoded = new Map<string, FeedMessage>()
  private readonly modes = new Map<Mode, LoadedMode>()
  /** One-day-per-cycle trip index loading, so a reload never blows one invocation's CPU budget. */
  private pending: {
    mode: Mode
    generation: string
    dates: string[]
    index: ModeIndex
    loaded: number
  } | null = null
  private alerts: Alert[] = []
  private running: Promise<void> | null = null
  private rawPersistedAt = 0
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
  private drillDead = false
  /** The current snapshot still needs publishing to R2 (a publish failed, or it was just rebuilt). */
  private r2Pending = false
  private readonly startedAt: number
  private readonly cycleMs: number
  private readonly alarmMs: number
  private lastPollStart = Number.NEGATIVE_INFINITY
  /** Phase timings of the last completed poll (tests, and the log line). */
  lastTimings: CycleTimings | null = null
  /** R2 writes of the poll in progress, for its timings. */
  private puts = { n: 0, chars: 0 }

  constructor(private readonly d: HubDeps) {
    this.feeds = feedsFor(d.config)
    this.startedAt = d.now()
    this.cycleMs = d.cycleMs ?? CYCLE_MS
    this.alarmMs = Math.min(KEEPALIVE_MS, this.cycleMs)
    this.log = d.log ?? silentLogger
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

  /** Watchdog (1-minute cron). Re-arms when no alarm is set or the last completed cycle is older than 45 s. */
  async ensureRunning(): Promise<{ rearmed: boolean; lastCycleAt: number; alarm: number | null }> {
    await this.restore()
    const now = this.d.now()
    const alarm = await this.d.storage.getAlarm()
    const stale = now - this.meta.lastCycleAt > WATCHDOG_STALE_MS
    if (alarm == null || stale) {
      this.drillDead = false
      await this.d.storage.setAlarm(now)
      this.log.warn('rt watchdog re-armed alarm', { alarm, lastCycleAt: this.meta.lastCycleAt, stale })
      return { rearmed: true, lastCycleAt: this.meta.lastCycleAt, alarm: now }
    }
    return { rearmed: false, lastCycleAt: this.meta.lastCycleAt, alarm }
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

    const indexesChanged = await this.stepIndexes(now).catch((e) => {
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
      if (!r.raw) return
      // Decode before adopting: a corrupt body keeps the previous good bytes (and stays out of the legacy proxy).
      try {
        const msg = fromBinary(FeedMessageSchema, r.raw.bytes)
        this.raw.set(f.key, r.raw)
        this.decoded.set(f.key, msg)
        if (f.kind === 'alerts') this.alerts = buildAlerts(msg, this.routeModes(), this.stopModes())
        changed.push(f)
      } catch (e) {
        errors.push(`${f.key}: decode failed: ${errorMessage(e)}`)
      }
    })
    if (
      due.some((f) => f.kind === 'alerts') &&
      !fetched.some((r, i) => due[i]?.kind === 'alerts' && r.error)
    ) {
      this.meta.alertsAt = now
    }

    // Alert modes come from the loaded routes and stops, so re-derive them when an index swaps in.
    const alertsFeed = this.decoded.get('alerts')
    if (indexesChanged && alertsFeed && !changed.some((f) => f.kind === 'alerts')) {
      this.alerts = buildAlerts(alertsFeed, this.routeModes(), this.stopModes())
    }

    tm.decode = lap()
    tm.changed = changed.length
    const writes: Record<string, unknown> = {}
    let rebuilt = false
    if (changed.length > 0 || indexesChanged || !this.snapshot) {
      const indexes: Partial<Record<Mode, ModeIndex>> = {}
      for (const [m, l] of this.modes) indexes[m] = l.index
      const pick = (kind: FeedSpec['kind']) =>
        this.feeds
          .filter((f) => f.kind === kind && this.decoded.has(f.key))
          .map((f) => ({ mode: f.mode, feed: this.decoded.get(f.key) as FeedMessage }))
      const tripUpdates = pick('TripUpdates')
      if (tripUpdates.length > 0) {
        const { snapshot, tripModes } = buildSnapshot({
          seq: this.meta.seq + 1,
          nowMs: now,
          indexes,
          tripUpdates,
          vehiclePositions: pick('VehiclePositions'),
          alerts: this.alerts,
          previous: this.snapshot,
          unloadedModes: this.d.config.indexModes.filter((m) => !this.modes.has(m)),
        })
        this.snapshot = snapshot
        this.tripModes = tripModes
        this.snapshotJson = null
        this.meta.seq = snapshot.header.seq
        rebuilt = true
        // With R2 bound the snapshot lives there as per-scope documents (merged back after a restart); keeping a
        // second copy in DO storage every cycle costs CPU.
        if (!this.d.r2) Object.assign(writes, this.snapshotWrites(this.fullJson() as string))
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
    if (errors.length > 0) this.log.warn('rt cycle partial', { errors, seq: this.meta.seq })
  }

  /**
   * Publish to R2: the per-scope documents whose content changed, then the small `rt/latest.json` pointer (a reader
   * never sees a pointer to a missing object). Uncompressed: gzip would cost several ms of the 10 ms Free CPU budget
   * and R2 egress is free. The ring of R2_KEEP_SNAPSHOTS alerts keys keeps the bucket bounded without deletes.
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
    let alertsMoved = false
    if (this.r2Pending) {
      const json = { httpMetadata: { contentType: 'application/json' } }
      // Per-mode documents (§3.3 split): an edge isolate reads only the mode it serves. One overwritten object per
      // mode: an edge refresh is a single GET (no pointer first). R2 PUTs are atomic, and readers check the header
      // seq, so overwriting is safe; no deletes needed. Alerts go to a ring slot named by the pointer.
      const docs = splitSnapshot(snap, this.tripModes, this.d.config.modes)
      const scopes: Array<[SnapshotScope, RtSnapshot, string]> = this.d.config.modes.map((m) => [
        m,
        docs[m] as RtSnapshot,
        modeLatestKey(m),
      ])
      scopes.push(['alerts', alertsDocument(snap), scopeKey('alerts', seq)])
      const next = new Map(this.published)
      const puts: Promise<unknown>[] = []
      for (const [scope, doc, key] of scopes) {
        const body = documentBody(doc)
        const content = documentContent(doc.header, body)
        if (this.published.get(scope)?.content === content) continue
        puts.push(this.put(r2, key, documentJson(doc.header, body), json))
        next.set(scope, { content, key, seq })
        if (scope === 'alerts') alertsMoved = true
      }
      // Every PUT settles before the publish (and so the poll) ends: a failed sibling must not leave another PUT
      // running that could land after the next poll's and roll its document back (Codex r1). Then the first failure.
      const failed = (await Promise.allSettled(puts)).find((r) => r.status === 'rejected')
      if (failed) throw failed.reason
      // Only once every document is written: a failed PUT is retried, whole, with the next publish.
      this.published = next
    }
    const due =
      this.pointerAt === 0 || alertsMoved || now - this.pointerAt >= POINTER_HEARTBEAT_MS - POLL_SLACK_MS
    if (!due) {
      this.pointerOwed = true
      return
    }
    const files: NonNullable<R2Pointer['files']> = {}
    for (const [scope, p] of this.published) {
      if (scope === 'alerts' || this.d.config.modes.includes(scope)) files[scope] = { key: p.key, seq: p.seq }
    }
    const pointer: R2Pointer = { seq, files, fetchedAt: now, status: this.status() }
    await this.put(r2, R2_LATEST_KEY, JSON.stringify(pointer), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    })
    this.pointerAt = now
    this.pointerOwed = false
  }

  /** One R2 PUT, counted for the poll's timings. */
  private put(r2: R2Like, key: string, body: string, opts: Parameters<R2Like['put']>[2]): Promise<unknown> {
    this.puts.n++
    this.puts.chars += body.length
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
   * generation changes. Fetches, parses and indexes at most one TripIndexDay per cycle (see the Phase 0
   * measurements for the CPU cost) and swaps a mode in only when complete, so the
   * snapshot never mixes generations. Returns true when a mode's index was swapped.
   */
  private async stepIndexes(now: number): Promise<boolean> {
    const today = brisbaneDate(now)
    const want = [addDays(today, -1), today]
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
    const manifest = await this.d.store.getManifest()
    if (!manifest) throw new Error('no manifest.json')
    for (const mode of this.d.config.indexModes) {
      const generation = manifest.modes[mode]?.current
      if (!generation) continue
      const loaded = this.modes.get(mode)
      const index = await this.d.store.getIndex(generation, mode)
      if (!index) throw new Error(`index ${generation}/${mode} missing`)
      const dates = want.filter((d) => index.tripIndex?.[d])
      if (dates.length === 0) continue
      if (loaded && loaded.generation === generation && same(loaded.dates, dates)) continue
      this.pending = { mode, generation, dates, index: new ModeIndex(mode, []), loaded: 0 }
      return this.stepIndexes(now)
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

  /** Merge the per-scope documents the pointer names (each slot must hold the named seq). */
  private async restoreFromDocuments(files: NonNullable<R2Pointer['files']>): Promise<string | null> {
    const r2 = this.d.r2 as R2Like
    const read = async (e: { key: string; seq: number } | undefined): Promise<RtSnapshot | null> => {
      if (!e || !r2.get) return null
      const obj = await r2.get(e.key)
      const text = obj ? await obj.text() : null
      const seq = text != null ? snapshotSeq(text) : null
      if (text == null || seq == null) return null
      // A per-mode latest object is overwritten before the pointer: after a partial publish it can be newer than
      // the pointer, and it is that mode's newest committed content, so accept it and move the seq watermark past
      // it (Codex review of #49). Ring slots (alerts) must match exactly.
      const overwritten = e.key.endsWith('/latest.json')
      if (overwritten ? seq < e.seq : seq !== e.seq) return null
      if (seq > this.meta.seq) this.meta.seq = seq
      return JSON.parse(text) as RtSnapshot
    }
    const load = async (f: NonNullable<R2Pointer['files']>) => {
      const docs: Array<[Mode, RtSnapshot]> = []
      for (const [scope, e] of Object.entries(f)) {
        if (scope === 'alerts') continue
        const d = await read(e)
        if (!d) return null
        docs.push([scope as Mode, d])
      }
      const alerts = f.alerts ? await read(f.alerts) : null
      if (f.alerts && !alerts) return null
      return { docs, alerts }
    }
    // A slot overwritten between our reads fails its seq check: re-read the pointer and try once more.
    let got = await load(files)
    if (!got && r2.get) {
      const ptr = await r2.get(R2_LATEST_KEY)
      const again = ptr ? (JSON.parse(await ptr.text()) as R2Pointer) : null
      // Never reuse a published seq: the re-read pointer may be newer than the one restore() started from.
      if (again && again.seq > this.meta.seq) this.meta.seq = again.seq
      if (again?.files) got = await load(again.files)
      if (!got && again?.files) {
        // Still inconsistent: restore the mode documents without alerts and refetch alerts on the next cycle (they
        // are rewritten within one poll), rather than lose the retained cancellations with the whole restore.
        const { alerts: _skip, ...modesOnly } = again.files
        got = await load(modesOnly)
        this.meta.alertsAt = 0
        this.log.warn('rt restore without alerts (alerts document failed its seq check)')
      }
    }
    if (!got) return null
    // Ownership: a trip in exactly one mode document belongs to that mode; one in several (carried while its mode
    // was unloaded) stays unassigned so every mode document keeps it (Codex review of the split).
    const seen = new Map<string, Mode | null>()
    for (const [m, d] of got.docs) for (const k of Object.keys(d.trips)) seen.set(k, seen.has(k) ? null : m)
    for (const [k, m] of seen) if (m) this.tripModes.set(k, m)
    const merged = mergeDocuments(
      got.docs.map(([, d]) => d),
      got.alerts,
    )
    return merged ? JSON.stringify(merged) : null
  }

  /** After an eviction or restart: restore the sequence, the last snapshot and the watchdog clock. */
  private async restore(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const meta = await this.d.storage.get<Meta>('meta')
    if (meta) this.meta = { ...this.meta, ...meta }
    let json: string | null = null
    if (meta && meta.snapChunks > 0) {
      const parts: string[] = []
      for (let i = 0; i < meta.snapChunks; i++) {
        const p = await this.d.storage.get<string>(`snap:${i}`)
        if (p == null) break
        parts.push(p)
      }
      if (parts.length === meta.snapChunks) json = parts.join('')
    }
    if (this.d.r2?.get) {
      const ptr = await this.d.r2.get(R2_LATEST_KEY)
      const pointer = ptr ? (JSON.parse(await ptr.text()) as R2Pointer) : null
      // Never reuse a published seq (Codex review #1): continue after whatever R2 already holds, even when this
      // object's own storage is empty or behind.
      if (pointer && pointer.seq > this.meta.seq) this.meta.seq = pointer.seq
      if (!json && pointer?.files) {
        json = await this.restoreFromDocuments(pointer.files)
      } else if (!json && pointer?.key) {
        const obj = await this.d.r2.get(pointer.key)
        const text = obj ? await obj.text() : null
        // A ring slot may already hold a newer snapshot than the pointer names: only adopt the matching one.
        json = text != null && snapshotSeq(text) === pointer.seq ? text : null
      }
    }
    if (json) {
      this.snapshotJson = json
      this.snapshot = JSON.parse(json) as RtSnapshot
      this.alerts = this.snapshot.alerts
    }
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
