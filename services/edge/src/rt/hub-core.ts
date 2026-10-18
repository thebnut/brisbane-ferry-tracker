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

export const CYCLE_MS = 15_000
export const ALERTS_EVERY_MS = 60_000
export const FETCH_TIMEOUT_MS = 5_000
export const WATCHDOG_STALE_MS = 45_000
/** DO storage values are capped (2 MiB on SQLite-backed objects); chunk well below that. */
const CHUNK_BYTES = 1 << 20
const CHUNK_CHARS = 512 * 1024

export interface HubStorage {
  get<T>(key: string): Promise<T | undefined>
  put(entries: Record<string, unknown>): Promise<void>
  delete(keys: string[]): Promise<number>
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number): Promise<void>
}

export const R2_LATEST_KEY = 'rt/latest.json'
export const R2_KEEP_SNAPSHOTS = 240
export const snapshotKey = (seq: number) => `rt/snapshot-${seq}.json`

/** rt/latest.json: which snapshot is current, plus the hub status for /v1/health. */
export interface R2Pointer {
  seq: number
  key: string
  fetchedAt: number
  status: HubStatus
}

export interface R2Like {
  get?(key: string): Promise<{ text(): Promise<string> } | null>
  delete(key: string): Promise<unknown>
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
  /** Per upstream fetch; 5 s in production, shorter in tests. */
  fetchTimeoutMs?: number
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

  constructor(private readonly d: HubDeps) {
    this.feeds = feedsFor(d.config)
    this.log = d.log ?? silentLogger
  }

  // ---------------------------------------------------------------- scheduling

  async alarm(): Promise<void> {
    // Re-arm first: whatever happens below, the chain continues.
    const started = this.d.now()
    await this.d.storage.setAlarm(started + CYCLE_MS)
    try {
      await this.cycle()
    } catch (e) {
      this.meta.lastError = errorMessage(e)
      this.log.error('rt cycle failed', { error: this.meta.lastError })
    } finally {
      if ((await this.d.storage.getAlarm()) == null) await this.d.storage.setAlarm(this.d.now() + CYCLE_MS)
    }
  }

  /** Watchdog (1-minute cron). Re-arms when no alarm is set or the last completed cycle is older than 45 s. */
  async ensureRunning(): Promise<{ rearmed: boolean; lastCycleAt: number; alarm: number | null }> {
    await this.restore()
    const now = this.d.now()
    const alarm = await this.d.storage.getAlarm()
    const stale = now - this.meta.lastCycleAt > WATCHDOG_STALE_MS
    if (alarm == null || stale) {
      await this.d.storage.setAlarm(now)
      this.log.warn('rt watchdog re-armed alarm', { alarm, lastCycleAt: this.meta.lastCycleAt, stale })
      return { rearmed: true, lastCycleAt: this.meta.lastCycleAt, alarm: now }
    }
    return { rearmed: false, lastCycleAt: this.meta.lastCycleAt, alarm }
  }

  // ---------------------------------------------------------------- read API (RPC)

  async pull(sinceSeq?: number | null): Promise<PullResult> {
    await this.restore()
    const seq = this.snapshot?.header.seq ?? (this.snapshotJson ? this.meta.seq : null)
    const json = seq != null && seq === sinceSeq ? null : this.snapshotJson
    return { seq, json, status: this.status() }
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
    }
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
    await this.restore()
    const now = this.d.now()
    const errors: string[] = []

    const indexesChanged = await this.stepIndexes(now).catch((e) => {
      errors.push(`static: ${errorMessage(e)}`)
      return false
    })

    const due = this.feeds.filter((f) => f.kind !== 'alerts' || now - this.meta.alertsAt >= ALERTS_EVERY_MS)
    const fetched = await Promise.all(due.map((f) => this.fetchFeed(f, now)))
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
        const { snapshot } = buildSnapshot({
          seq: this.meta.seq + 1,
          nowMs: now,
          indexes,
          tripUpdates,
          vehiclePositions: pick('VehiclePositions'),
          alerts: this.alerts,
          previous: this.snapshot,
        })
        this.snapshot = snapshot
        this.snapshotJson = JSON.stringify(snapshot)
        this.meta.seq = snapshot.header.seq
        rebuilt = true
        // With R2 bound the snapshot lives there (restored from R2 after a restart); keeping a second copy in DO
        // storage every cycle costs CPU the Free plan doesn't have.
        if (!this.d.r2) Object.assign(writes, this.snapshotWrites(this.snapshotJson))
      }
    }
    for (const f of changed) Object.assign(writes, this.rawWrites(f.key, this.raw.get(f.key) as RawFeed))

    if (this.d.r2 && this.snapshotJson && rebuilt) {
      try {
        await this.publishR2(this.snapshotJson, now)
      } catch (e) {
        errors.push(`r2: ${errorMessage(e)}`)
      }
    }

    this.meta.lastCycleAt = this.d.now()
    this.meta.lastError = errors.length > 0 ? errors.join('; ') : null
    writes.meta = { ...this.meta }
    await this.d.storage.put(writes)
    if (errors.length > 0) this.log.warn('rt cycle partial', { errors, seq: this.meta.seq })
  }

  /**
   * Publish to R2: the sequence-numbered snapshot first, then the small `rt/latest.json` pointer (idempotent; a
   * reader never sees a pointer to a missing object). Uncompressed: gzip would cost several ms of the 10 ms Free
   * CPU budget and R2 egress is free. Two Class A writes per cycle (~345k a month); the snapshot from
   * R2_KEEP_SNAPSHOTS cycles ago is deleted (deletes are free) so the bucket stays bounded.
   */
  private async publishR2(json: string, now: number): Promise<void> {
    const r2 = this.d.r2 as R2Like
    const seq = this.meta.seq
    const key = snapshotKey(seq)
    await r2.put(key, json, { httpMetadata: { contentType: 'application/json' } })
    const pointer: R2Pointer = { seq, key, fetchedAt: now, status: this.status() }
    await r2.put(R2_LATEST_KEY, JSON.stringify(pointer), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' },
    })
    if (seq > R2_KEEP_SNAPSHOTS) await r2.delete(snapshotKey(seq - R2_KEEP_SNAPSHOTS))
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
    for (const mode of this.d.config.indexModes) {
      const generation = await this.d.store.currentGeneration(mode)
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

  /** After an eviction or restart: restore the sequence, the last snapshot and the watchdog clock. */
  private async restore(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const meta = await this.d.storage.get<Meta>('meta')
    if (!meta) return
    this.meta = { ...this.meta, ...meta }
    const parts: string[] = []
    for (let i = 0; i < meta.snapChunks; i++) {
      const p = await this.d.storage.get<string>(`snap:${i}`)
      if (p == null) return
      parts.push(p)
    }
    let json = parts.length > 0 ? parts.join('') : null
    if (!json && this.d.r2?.get) {
      const ptr = await this.d.r2.get(R2_LATEST_KEY)
      const key = ptr ? ((JSON.parse(await ptr.text()) as R2Pointer).key ?? null) : null
      const obj = key ? await this.d.r2.get(key) : null
      json = obj ? await obj.text() : null
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
