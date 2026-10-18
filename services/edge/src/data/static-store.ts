/**
 * Read side of the pipeline's static tree: manifest → per-generation index → content-addressed blobs.
 * Indexes and blobs are immutable, so they're cached in isolate memory (bounded LRU); only the manifest is refreshed.
 */
import { GenerationIndex, Manifest, type Mode, SharedFetch, StaticStopDay, TripIndexDay } from '@bft/core'
import { z } from 'zod'
import { type DataSource, readJson } from './source.ts'

/** Pipeline extension (bft-pipeline PR): bus stop-days grouped into shards for the assets backend. */
const IndexWithShards = GenerationIndex.extend({
  shards: z.record(z.string(), z.record(z.string(), z.string())).optional(),
})
export type IndexWithShards = z.infer<typeof IndexWithShards>

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

export class StaticStore {
  private readonly manifest: SharedFetch<Manifest | null>
  private readonly indexes = new Lru<Promise<IndexWithShards | null>>(16)
  private readonly blobs = new Lru<Promise<unknown | null>>(256)
  /** Trip indexes are large (a whole mode-day), so only a few are kept. */
  private readonly tripIndexes = new Lru<Promise<unknown | null>>(4)
  private readonly validate: boolean

  constructor(
    readonly source: DataSource,
    opts: StaticStoreOptions = {},
  ) {
    this.validate = opts.validate ?? false
    this.manifest = new SharedFetch(
      async () => {
        const raw = await readJson(source, MANIFEST_KEY)
        return raw == null ? null : Manifest.parse(raw)
      },
      opts.manifestMaxAgeMs ?? 60_000,
      opts.now,
    )
  }

  getManifest(): Promise<Manifest | null> {
    return this.manifest.get()
  }

  async currentGeneration(mode: Mode): Promise<string | null> {
    return (await this.getManifest())?.modes[mode]?.current ?? null
  }

  getIndex(generation: string, mode: Mode): Promise<IndexWithShards | null> {
    const k = `${generation}/${mode}`
    let p = this.indexes.get(k)
    if (!p) {
      p = readJson(this.source, indexKey(generation, mode)).then((raw) =>
        raw == null ? null : IndexWithShards.parse(raw),
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
  async stopDay(index: IndexWithShards, serviceDate: string, stopKey: string): Promise<StaticStopDay | null> {
    const sha = index.blobs[serviceDate]?.[stopKey]
    let raw: unknown | null = null
    if (sha) raw = await this.blob(blobKey(sha))
    if (raw == null) {
      const shard = index.shards?.[serviceDate]?.[stopKey]
      if (!shard) return null
      const all = (await this.blob(shardKey(shard))) as Record<string, unknown> | null
      raw = all?.[stopKey] ?? null
    }
    if (raw == null) return null
    return this.validate ? StaticStopDay.parse(raw) : (raw as StaticStopDay)
  }

  async tripIndexDay(index: IndexWithShards, serviceDate: string): Promise<TripIndexDay | null> {
    const sha = index.tripIndex?.[serviceDate]
    if (!sha) return null
    const raw = await this.blob(blobKey(sha), this.tripIndexes)
    if (raw == null) return null
    return this.validate ? TripIndexDay.parse(raw) : (raw as TripIndexDay)
  }
}
