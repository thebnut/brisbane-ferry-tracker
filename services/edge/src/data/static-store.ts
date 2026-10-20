/**
 * Read side of the pipeline's static tree: manifest → per-generation index → content-addressed blobs.
 * Indexes and blobs are immutable, so they're cached in isolate memory (bounded LRU); only the manifest is refreshed.
 */
import { GenerationIndex, Manifest, type Mode, StaticStopDay, shardOf, TripIndexDay } from '@bft/core'
import { AbandonedError, DeadlineError, type Flight, flight, isDead, within } from '../deadline.ts'
import { errorMessage } from '../log.ts'
import { type DataSource, decodeJson, readBytes, readJson } from './source.ts'

/** Trip-index blobs above this (gzipped) are not cached: bus. */
export const TRIP_INDEX_CACHE_MAX_BYTES = 1 << 20

/**
 * A shared read (manifest, index, stop-day blob or shard) still pending after this is presumed lost and replaced,
 * and its waiters fail instead of hanging (see ../deadline.ts). These are small R2 reads (~400 ms from BNE on
 * staging). A cold departures request can chain up to four bounded waits (manifest, index, then snapshot, stations
 * and stop-day reads in parallel, then the next-day top-up), so ~12 s at worst: over the 10 s proxy, whose own
 * timeout and fallback then answer. Bounded, never a hang. On a /v1 request the whole chain is also capped by the
 * request's budget (ReadBudget, STATIC_READ_BUDGET_MS in ../app.ts), which leaves room for one retry of a failed read.
 * Measured on staging 20 Oct: a static object's first byte arrives in 0.4-0.9 s and bus shards are 15-36 KB gzipped,
 * so a 3 s miss is an R2 latency outlier, not a size problem: the deadline stays, and the retry takes the outlier.
 */
export const STATIC_LOAD_DEADLINE_MS = 3_000
/** Trip-index days are large (bus ~3-4 MB gzipped) and only on the trip-detail path, so they get longer. */
export const TRIP_INDEX_LOAD_DEADLINE_MS = 6_000

/**
 * A request's retry of a failed or timed-out read needs at least this much of its budget left (a cold R2 read from
 * BNE is ~400 ms); with less, the request answers 503 at once rather than start a read it can't wait for.
 */
export const MIN_RETRY_MS = 500

/**
 * A request's time for static reads: `until` (epoch ms) for arithmetic, and `signal`, aborted by the request's own
 * timer at the same moment, which ends any wait still running (a clock alone can't be trusted to advance).
 */
export interface ReadBudget {
  until: number
  signal: AbortSignal
}

/** A budget of `ms` from now, timed by this request's own timer. */
export function readBudget(ms: number, now: number): ReadBudget {
  return { until: now + ms, signal: AbortSignal.timeout(Math.max(0, ms)) }
}

/** Which static read failed, for the 503's `detail` and the log (never a key or user input). */
export type StaticReadKind = 'manifest' | 'index' | 'stop-day' | 'shard' | 'trip-index'

/**
 * A static read that failed for a request, after its retry: the read timed out (`deadline`) or errored. The app
 * answers it with a deliberate, retryable 503 (prod 20 Oct: a shard read's DeadlineError reached onError as a 500).
 */
export class StaticReadError extends Error {
  override name = 'StaticReadError'
  constructor(
    readonly what: StaticReadKind,
    readonly why: 'deadline' | 'error',
    cause: unknown,
  ) {
    super(`${what}: ${errorMessage(cause)}`, { cause })
  }
}

export const MANIFEST_KEY = 'manifest.json'
export const indexKey = (generation: string, mode: Mode) => `static/${generation}/${mode}/index.json`
export const blobKey = (sha: string) => `static/blobs/${sha}.json.gz`
export const shardKey = (sha: string) => `static/shards/${sha}.json.gz`

class Lru<V> {
  private readonly m = new Map<string, V>()
  constructor(private readonly max: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k)
    if (v !== undefined) {
      this.m.delete(k)
      this.m.set(k, v)
    }
    return v
  }
  set(k: string, v: V): void {
    this.m.delete(k)
    this.m.set(k, v)
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string)
  }
  delete(k: string): void {
    this.m.delete(k)
  }
  /** Delete `k` only while it still holds `v` (a newer entry must not be dropped by an older load's failure). */
  deleteIf(k: string, v: V): void {
    if (this.m.get(k) === v) this.m.delete(k)
  }
}

export interface StaticStoreOptions {
  manifestMaxAgeMs?: number
  /** Parse with zod. On for tests and scripts; the hot path trusts the pipeline's validated output. */
  validate?: boolean
  now?: () => number
  /** Override STATIC_LOAD_DEADLINE_MS (tests). */
  loadDeadlineMs?: number
}

/** The shard holding a stop's StaticStopDay on a date (bus on the assets backend), or null. */
export function shardFor(index: GenerationIndex, serviceDate: string, stopKey: string): string | null {
  const sh = index.shards
  if (!sh) return null
  return sh.byDate[serviceDate]?.[shardOf(stopKey, sh.count)] ?? null
}

/** Could this stop have a stop-day file on any indexed date? (Shards can only be confirmed by loading them.) */
export function mayHaveStop(index: GenerationIndex, stopKey: string): boolean {
  return index.serviceDates.some((d) => index.blobs[d]?.[stopKey] || shardFor(index, d, stopKey))
}

export class StaticStore {
  private manifestValue: Manifest | null = null
  private manifestAt = Number.NEGATIVE_INFINITY
  private manifestLoad: Flight<Manifest | null> | null = null
  private manifestErrorLoggedAt = Number.NEGATIVE_INFINITY
  private readonly manifestMaxAgeMs: number
  readonly now: () => number
  /** How long a shared read may stay pending before it is replaced (STATIC_LOAD_DEADLINE_MS). */
  readonly loadDeadlineMs: number
  private readonly indexes = new Lru<Flight<GenerationIndex | null>>(16)
  private readonly blobs = new Lru<Flight<unknown | null>>(256)
  /** Trip indexes are large (a whole mode-day), so only a few are kept. */
  private readonly tripIndexes = new Lru<Promise<unknown | null>>(4)
  private readonly tripIndexLoads = new Map<string, Flight<unknown | null>>()
  private readonly validate: boolean

  constructor(
    readonly source: DataSource,
    opts: StaticStoreOptions = {},
  ) {
    this.validate = opts.validate ?? false
    this.manifestMaxAgeMs = opts.manifestMaxAgeMs ?? 60_000
    this.now = opts.now ?? Date.now
    this.loadDeadlineMs = opts.loadDeadlineMs ?? STATIC_LOAD_DEADLINE_MS
  }

  /**
   * The manifest read in flight (or a new one). A read past its deadline is replaced, and it commits nothing. A read
   * error rejects (callers fall back to the last good manifest), so a request can tell it from a missing manifest.
   */
  private loadManifest(): Flight<Manifest | null> {
    const now = this.now()
    if (this.manifestLoad && isDead(this.manifestLoad, now, this.loadDeadlineMs)) this.manifestLoad = null
    if (!this.manifestLoad) {
      // The read carries its own deadline too, so a background refresh (waitUntil, no waiter) can't stay pending
      // and commit late when no request comes along to notice it (Codex r1 #2).
      const load: Flight<Manifest | null> = flight(
        within(readJson(this.source, MANIFEST_KEY), this.loadDeadlineMs, MANIFEST_KEY)
          .then((raw) => {
            // A missing manifest isn't cached as null, so one that appears later is picked up on the next read.
            if (raw == null || this.manifestLoad !== load) return this.manifestValue
            this.manifestValue = Manifest.parse(raw)
            this.manifestAt = this.now()
            return this.manifestValue
          })
          .catch((e: unknown) => {
            this.noteManifestError(e)
            throw e
          })
          .finally(() => {
            if (this.manifestLoad === load) this.manifestLoad = null
          }),
        now,
      )
      this.manifestLoad = load
    }
    return this.manifestLoad
  }

  /**
   * A failed manifest read is otherwise only a fallback (last good, or null), so log its cause: the error's name and
   * message, never the data, at most once a minute per isolate (staging 20 Oct: a "no static data" 503 had no cause).
   */
  private noteManifestError(e: unknown): void {
    const now = this.now()
    if (now - this.manifestErrorLoggedAt < 60_000) return
    this.manifestErrorLoggedAt = now
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'static manifest read failed',
        name: e instanceof Error ? e.name : typeof e,
        error: errorMessage(e).slice(0, 200),
        haveLastGood: this.manifestValue != null,
      }),
    )
  }

  /**
   * One shared read for a caller: join or start a flight (`get`) and wait for it for at most what is left of its
   * deadline, and of the request's `budget`. A flight that fails, or runs out its own deadline, is dropped (`drop`,
   * identity-checked) so the next read starts afresh; a wait cut short only by the budget leaves it for other
   * waiters. With a budget, a failure is retried once at once if the budget leaves MIN_RETRY_MS (concurrent retries
   * join one new flight), and then rejects with a StaticReadError. Without one (the hub, scripts) there is no retry
   * and the error passes through as before.
   */
  private async read<T>(
    what: StaticReadKind,
    label: string,
    get: () => Flight<T>,
    drop: (f: Flight<T>) => void,
    budget?: ReadBudget,
    deadlineMs = this.loadDeadlineMs,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const f = get()
      const now = this.now()
      const own = f.at + deadlineMs - now
      const byBudget = budget !== undefined && budget.until - now < own
      try {
        if (f.settled) return await f.p
        // The budget's own timer (its signal) ends the wait too, so the budget holds even if the clock doesn't
        // advance between attempts (workerd's clock moves only with I/O; Codex r1).
        return await within(f.p, byBudget ? (budget as ReadBudget).until - now : own, label, budget?.signal)
      } catch (e) {
        const cut = e instanceof AbandonedError || (e instanceof DeadlineError && byBudget)
        if (!cut) drop(f)
        if (!budget) throw e
        const left = budget.until - this.now()
        if (attempt === 0 && !cut && !budget.signal.aborted && left >= MIN_RETRY_MS) continue
        const timedOut = e instanceof DeadlineError || e instanceof AbandonedError
        throw new StaticReadError(what, timedOut ? 'deadline' : 'error', e)
      }
    }
  }

  /**
   * The manifest, or null when there is none yet (read errors fall back to the last good one). With `waitUntil`
   * (a Worker request), a stale manifest is returned at once and refreshed in the background: on staging the
   * blocking 60 s refresh put an R2 round trip (~380 ms) on every fourth or fifth request. Without it (the hub,
   * tests), a stale manifest is refreshed before returning.
   */
  getManifest(waitUntil?: (p: Promise<unknown>) => void, budget?: ReadBudget): Promise<Manifest | null> {
    const fresh = this.now() - this.manifestAt < this.manifestMaxAgeMs
    if (this.manifestValue && fresh) return Promise.resolve(this.manifestValue)
    if (this.manifestValue && waitUntil) {
      waitUntil(this.loadManifest().p.catch(() => null))
      return Promise.resolve(this.manifestValue)
    }
    // A request (`budget`) on an isolate with no good manifest gets the StaticReadError after its retry, rather than
    // a null that reads as "no static data" (staging 20 Oct: a fresh isolate's failed read answered 503 with the
    // cause thrown away).
    return this.read(
      'manifest',
      'manifest',
      () => this.loadManifest(),
      (f) => {
        if (this.manifestLoad === f) this.manifestLoad = null
      },
      budget,
    ).catch((e: unknown) => {
      if (this.manifestValue || !budget) return this.manifestValue
      throw e
    })
  }

  /** The last good manifest this isolate read (no read). */
  get lastManifest(): Manifest | null {
    return this.manifestValue
  }

  async currentGeneration(
    mode: Mode,
    waitUntil?: (p: Promise<unknown>) => void,
    budget?: ReadBudget,
  ): Promise<string | null> {
    return (await this.getManifest(waitUntil, budget))?.modes[mode]?.current ?? null
  }

  getIndex(generation: string, mode: Mode, budget?: ReadBudget): Promise<GenerationIndex | null> {
    const k = `${generation}/${mode}`
    const get = () => {
      const f = this.indexes.get(k)
      if (f && !isDead(f, this.now(), this.loadDeadlineMs)) return f
      const load = flight(
        readJson(this.source, indexKey(generation, mode)).then((raw) =>
          raw == null ? null : GenerationIndex.parse(raw),
        ),
        this.now(),
      )
      // A missing index isn't cached as null either (like the manifest), so one published later, or a read that
      // came back empty, is retried on the next call (Codex r1 of the hub cold start).
      load.p.then(
        (v) => v == null && this.indexes.deleteIf(k, load),
        () => this.indexes.deleteIf(k, load),
      )
      this.indexes.set(k, load)
      return load
    }
    return this.read('index', indexKey(generation, mode), get, (f) => this.indexes.deleteIf(k, f), budget)
  }

  private blob(
    key: string,
    what: StaticReadKind,
    budget?: ReadBudget,
    cache = this.blobs,
  ): Promise<unknown | null> {
    const get = () => {
      const f = cache.get(key)
      if (f && !isDead(f, this.now(), this.loadDeadlineMs)) return f
      const load = flight(readJson(this.source, key), this.now())
      load.p.catch(() => cache.deleteIf(key, load))
      cache.set(key, load)
      return load
    }
    return this.read(what, key, get, (f) => cache.deleteIf(key, f), budget)
  }

  /** The stop-day file for a stop key on a service date, from a per-stop blob or a shard. */
  async stopDay(
    index: GenerationIndex,
    serviceDate: string,
    stopKey: string,
    budget?: ReadBudget,
  ): Promise<StaticStopDay | null> {
    const sha = index.blobs[serviceDate]?.[stopKey]
    let raw: unknown | null = null
    if (sha) raw = await this.blob(blobKey(sha), 'stop-day', budget)
    if (raw == null) {
      const shard = shardFor(index, serviceDate, stopKey)
      if (!shard) return null
      const all = (await this.blob(shardKey(shard), 'shard', budget)) as Record<string, unknown> | null
      raw = all?.[stopKey] ?? null
    }
    if (raw == null) return null
    return this.validate ? StaticStopDay.parse(raw) : (raw as StaticStopDay)
  }

  /**
   * A mode-day trip index. Small ones (ferry, train, tram: well under 1 MB gzipped) are cached; large ones (bus,
   * ~3-4 MB gzipped, ~60 MB parsed) are parsed per call and never retained, so the RT hub's compact matcher is the
   * only long-lived copy (Codex review of #45) and an edge isolate doesn't pin two bus days for trip detail.
   */
  async tripIndexDay(
    index: GenerationIndex,
    serviceDate: string,
    budget?: ReadBudget,
  ): Promise<TripIndexDay | null> {
    const sha = index.tripIndex?.[serviceDate]
    if (!sha) return null
    const key = blobKey(sha)
    // Completed small results are cached; concurrent loads of any size share one in-flight read and parse.
    let raw: unknown | null
    const done = this.tripIndexes.get(key)
    if (done) {
      raw = await done
    } else {
      const get = () => {
        const f = this.tripIndexLoads.get(key)
        if (f && !isDead(f, this.now(), TRIP_INDEX_LOAD_DEADLINE_MS)) return f
        // Content-addressed and immutable, so even a late (abandoned) load may fill the cache.
        const load: Flight<unknown | null> = flight(
          (async () => {
            const bytes = await readBytes(this.source, key)
            if (!bytes) return null
            const raw = await decodeJson(bytes)
            if (bytes.byteLength <= TRIP_INDEX_CACHE_MAX_BYTES)
              this.tripIndexes.set(key, Promise.resolve(raw))
            return raw
          })(),
          this.now(),
        )
        this.tripIndexLoads.set(key, load)
        void load.p
          .finally(() => {
            if (this.tripIndexLoads.get(key) === load) this.tripIndexLoads.delete(key)
          })
          .catch(() => {})
        return load
      }
      raw = await this.read(
        'trip-index',
        key,
        get,
        (f) => {
          if (this.tripIndexLoads.get(key) === f) this.tripIndexLoads.delete(key)
        },
        budget,
        TRIP_INDEX_LOAD_DEADLINE_MS,
      )
    }
    if (raw == null) return null
    return this.validate ? TripIndexDay.parse(raw) : (raw as TripIndexDay)
  }

  /**
   * A mode-day trip index's gzip bytes, not decoded and not cached. The RT hub fetches several days at once and
   * decodes them one at a time with decodeTripIndexDay, so it never holds two parsed bus days (~60 MB each) together.
   */
  async tripIndexDayBytes(index: GenerationIndex, serviceDate: string): Promise<Uint8Array | null> {
    const sha = index.tripIndex?.[serviceDate]
    if (!sha) return null
    const key = blobKey(sha)
    return within(readBytes(this.source, key), TRIP_INDEX_LOAD_DEADLINE_MS, key)
  }

  /** Decode and parse bytes from tripIndexDayBytes. */
  async decodeTripIndexDay(bytes: Uint8Array): Promise<TripIndexDay> {
    const raw = await decodeJson(bytes)
    return this.validate ? TripIndexDay.parse(raw) : (raw as TripIndexDay)
  }
}
