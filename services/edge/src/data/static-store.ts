/**
 * Read side of the pipeline's static tree: manifest → per-generation index → content-addressed blobs.
 * Indexes and blobs are immutable, so they're cached in isolate memory (bounded LRU); only the manifest is refreshed.
 */
import { GenerationIndex, Manifest, type Mode, StaticStopDay, shardOf, TripIndexDay } from '@bft/core'
import { awaitFlight, DeadlineError, type Flight, flight, isDead, within } from '../deadline.ts'
import { type DataSource, decodeJson, readBytes, readJson } from './source.ts'

/** Trip-index blobs above this (gzipped) are not cached: bus. */
export const TRIP_INDEX_CACHE_MAX_BYTES = 1 << 20

/**
 * A shared read (manifest, index, stop-day blob or shard) still pending after this is presumed lost and replaced,
 * and its waiters fail instead of hanging (see ../deadline.ts). These are small R2 reads (~400 ms from BNE on
 * staging); a cold departures request makes at most three in a row, so the worst case stays under the 10 s proxy.
 */
export const STATIC_LOAD_DEADLINE_MS = 3_000
/** Trip-index days are large (bus ~3-4 MB gzipped) and only on the trip-detail path, so they get longer. */
export const TRIP_INDEX_LOAD_DEADLINE_MS = 6_000

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

  /** The manifest read in flight (or a new one). A read past its deadline is replaced, and it commits nothing. */
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
          .catch(() => this.manifestValue)
          .finally(() => {
            if (this.manifestLoad === load) this.manifestLoad = null
          }),
        now,
      )
      this.manifestLoad = load
    }
    return this.manifestLoad
  }

  /** Wait for a shared load for at most what is left of its deadline; on timeout drop it from `drop`. */
  private bounded<T>(
    f: Flight<T>,
    what: string,
    drop: () => void,
    deadlineMs = this.loadDeadlineMs,
  ): Promise<T> {
    return awaitFlight(f, this.now(), deadlineMs, what).catch((e: unknown) => {
      if (e instanceof DeadlineError) drop()
      throw e
    })
  }

  /**
   * The manifest, or null when there is none yet (read errors fall back to the last good one). With `waitUntil`
   * (a Worker request), a stale manifest is returned at once and refreshed in the background: on staging the
   * blocking 60 s refresh put an R2 round trip (~380 ms) on every fourth or fifth request. Without it (the hub,
   * tests), a stale manifest is refreshed before returning.
   */
  getManifest(waitUntil?: (p: Promise<unknown>) => void): Promise<Manifest | null> {
    const fresh = this.now() - this.manifestAt < this.manifestMaxAgeMs
    if (this.manifestValue && fresh) return Promise.resolve(this.manifestValue)
    if (this.manifestValue && waitUntil) {
      waitUntil(this.loadManifest().p)
      return Promise.resolve(this.manifestValue)
    }
    const load = this.loadManifest()
    return this.bounded(load, 'manifest', () => {
      if (this.manifestLoad === load) this.manifestLoad = null
    }).catch(() => this.manifestValue)
  }

  async currentGeneration(mode: Mode, waitUntil?: (p: Promise<unknown>) => void): Promise<string | null> {
    return (await this.getManifest(waitUntil))?.modes[mode]?.current ?? null
  }

  getIndex(generation: string, mode: Mode): Promise<GenerationIndex | null> {
    const k = `${generation}/${mode}`
    let f = this.indexes.get(k)
    if (!f || isDead(f, this.now(), this.loadDeadlineMs)) {
      const load = flight(
        readJson(this.source, indexKey(generation, mode)).then((raw) =>
          raw == null ? null : GenerationIndex.parse(raw),
        ),
        this.now(),
      )
      load.p.catch(() => this.indexes.deleteIf(k, load))
      this.indexes.set(k, load)
      f = load
    }
    const shared = f
    return this.bounded(shared, indexKey(generation, mode), () => this.indexes.deleteIf(k, shared))
  }

  private blob(key: string, cache = this.blobs): Promise<unknown | null> {
    let f = cache.get(key)
    if (!f || isDead(f, this.now(), this.loadDeadlineMs)) {
      const load = flight(readJson(this.source, key), this.now())
      load.p.catch(() => cache.deleteIf(key, load))
      cache.set(key, load)
      f = load
    }
    const shared = f
    return this.bounded(shared, key, () => cache.deleteIf(key, shared))
  }

  /** The stop-day file for a stop key on a service date, from a per-stop blob or a shard. */
  async stopDay(index: GenerationIndex, serviceDate: string, stopKey: string): Promise<StaticStopDay | null> {
    const sha = index.blobs[serviceDate]?.[stopKey]
    let raw: unknown | null = null
    if (sha) raw = await this.blob(blobKey(sha))
    if (raw == null) {
      const shard = shardFor(index, serviceDate, stopKey)
      if (!shard) return null
      const all = (await this.blob(shardKey(shard))) as Record<string, unknown> | null
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
  async tripIndexDay(index: GenerationIndex, serviceDate: string): Promise<TripIndexDay | null> {
    const sha = index.tripIndex?.[serviceDate]
    if (!sha) return null
    const key = blobKey(sha)
    // Completed small results are cached; concurrent loads of any size share one in-flight read and parse.
    let raw: unknown | null
    const done = this.tripIndexes.get(key)
    if (done) {
      raw = await done
    } else {
      let f = this.tripIndexLoads.get(key)
      if (!f || isDead(f, this.now(), TRIP_INDEX_LOAD_DEADLINE_MS)) {
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
        f = load
      }
      const shared = f
      raw = await this.bounded(
        shared,
        key,
        () => {
          if (this.tripIndexLoads.get(key) === shared) this.tripIndexLoads.delete(key)
        },
        TRIP_INDEX_LOAD_DEADLINE_MS,
      )
    }
    if (raw == null) return null
    return this.validate ? TripIndexDay.parse(raw) : (raw as TripIndexDay)
  }
}
