/**
 * Read side of the pipeline's static tree: manifest → per-generation index → content-addressed blobs.
 * Indexes and blobs are immutable, so they're cached in isolate memory (bounded LRU); only the manifest is refreshed.
 */
import { GenerationIndex, Manifest, type Mode, StaticStopDay, shardOf, TripIndexDay } from '@bft/core'
import { type DataSource, decodeJson, readBytes, readJson } from './source.ts'

/** Trip-index blobs above this (gzipped) are not cached: bus. */
export const TRIP_INDEX_CACHE_MAX_BYTES = 1 << 20

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
}

export interface StaticStoreOptions {
  manifestMaxAgeMs?: number
  /** Parse with zod. On for tests and scripts; the hot path trusts the pipeline's validated output. */
  validate?: boolean
  now?: () => number
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
  private manifestLoad: Promise<Manifest | null> | null = null
  private readonly manifestMaxAgeMs: number
  private readonly now: () => number
  private readonly indexes = new Lru<Promise<GenerationIndex | null>>(16)
  private readonly blobs = new Lru<Promise<unknown | null>>(256)
  /** Trip indexes are large (a whole mode-day), so only a few are kept. */
  private readonly tripIndexes = new Lru<Promise<unknown | null>>(4)
  private readonly tripIndexLoads = new Map<string, Promise<unknown | null>>()
  private readonly validate: boolean

  constructor(
    readonly source: DataSource,
    opts: StaticStoreOptions = {},
  ) {
    this.validate = opts.validate ?? false
    this.manifestMaxAgeMs = opts.manifestMaxAgeMs ?? 60_000
    this.now = opts.now ?? Date.now
  }

  private loadManifest(): Promise<Manifest | null> {
    if (!this.manifestLoad) {
      this.manifestLoad = readJson(this.source, MANIFEST_KEY)
        .then((raw) => {
          // A missing manifest isn't cached as null, so one that appears later is picked up on the next read.
          if (raw == null) return this.manifestValue
          this.manifestValue = Manifest.parse(raw)
          this.manifestAt = this.now()
          return this.manifestValue
        })
        .catch(() => this.manifestValue)
        .finally(() => {
          this.manifestLoad = null
        })
    }
    return this.manifestLoad
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
      waitUntil(this.loadManifest())
      return Promise.resolve(this.manifestValue)
    }
    return this.loadManifest()
  }

  async currentGeneration(mode: Mode, waitUntil?: (p: Promise<unknown>) => void): Promise<string | null> {
    return (await this.getManifest(waitUntil))?.modes[mode]?.current ?? null
  }

  getIndex(generation: string, mode: Mode): Promise<GenerationIndex | null> {
    const k = `${generation}/${mode}`
    let p = this.indexes.get(k)
    if (!p) {
      p = readJson(this.source, indexKey(generation, mode)).then((raw) =>
        raw == null ? null : GenerationIndex.parse(raw),
      )
      p.catch(() => this.indexes.delete(k))
      this.indexes.set(k, p)
    }
    return p
  }

  private blob(key: string, cache = this.blobs): Promise<unknown | null> {
    let p = cache.get(key)
    if (!p) {
      p = readJson(this.source, key)
      p.catch(() => cache.delete(key))
      cache.set(key, p)
    }
    return p
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
    let p = this.tripIndexes.get(key) ?? this.tripIndexLoads.get(key)
    if (!p) {
      p = (async () => {
        const bytes = await readBytes(this.source, key)
        if (!bytes) return null
        const raw = await decodeJson(bytes)
        if (bytes.byteLength <= TRIP_INDEX_CACHE_MAX_BYTES) this.tripIndexes.set(key, Promise.resolve(raw))
        return raw
      })()
      this.tripIndexLoads.set(key, p)
      void p.finally(() => this.tripIndexLoads.delete(key)).catch(() => {})
    }
    const raw = await p
    if (raw == null) return null
    return this.validate ? TripIndexDay.parse(raw) : (raw as TripIndexDay)
  }
}
