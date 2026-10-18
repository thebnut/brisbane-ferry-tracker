/**
 * Edge read path for the RT snapshot (transit-architecture.md §3.3): isolate memory, refreshed at most every 10 s
 * through one shared in-flight promise (SharedFetch). The Durable Object is asked only on refresh, never per
 * request, and only for a newer `seq` (unchanged snapshots aren't re-sent).
 *
 * On custom domains a Cache API entry shares one pull between the isolates of a PoP. On *.workers.dev the Cache
 * API is a no-op, so each isolate pulls on its own (at most 6 RPCs a minute per warm isolate).
 *
 * The refresh age is measured from when this isolate last pulled, not from the snapshot's fetchedAt: if the hub
 * stalls, a fetchedAt-based rule would call the DO on every request.
 */
import { type RtSnapshot, SharedFetch, type Vehicle, vehiclesByTrip } from '@bft/core'
import type { HubStatus, PullResult, RawFeed } from './rt/hub-core.ts'

export const SNAPSHOT_REFRESH_MS = 10_000

export interface CurrentSnapshot {
  seq: number
  snapshot: RtSnapshot
  vehiclesByTrip: Map<string, Vehicle>
}

export interface HubClient {
  pull(sinceSeq: number | null): Promise<PullResult>
  getRaw(key: string): Promise<RawFeed | null>
}

const CACHE_URL = 'https://bft-cache.internal/rt/snapshot'

interface CacheLike {
  match(url: string): Promise<Response | undefined>
  put(url: string, res: Response): Promise<void>
}

function sharedCache(): CacheLike | null {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches?.default
  return c ?? null
}

export class SnapshotClient {
  private current: CurrentSnapshot | null = null
  private lastStatus: HubStatus | null = null
  private readonly shared: SharedFetch<CurrentSnapshot | null>
  private readonly raws = new Map<string, SharedFetch<RawFeed | null>>()
  /** For tests and /v1/health: how many times the hub was actually called. */
  hubCalls = 0

  constructor(
    private readonly hub: HubClient,
    private readonly now: () => number = Date.now,
    private readonly waitUntil: (p: Promise<unknown>) => void = () => {},
    private readonly cache: CacheLike | null = sharedCache(),
  ) {
    this.shared = new SharedFetch(() => this.refresh(), SNAPSHOT_REFRESH_MS, now)
  }

  get status(): HubStatus | null {
    return this.lastStatus
  }

  /** The current snapshot, or null when the hub has none (or can't be reached and we never had one). */
  async get(): Promise<CurrentSnapshot | null> {
    try {
      return await this.shared.get()
    } catch {
      return this.current
    }
  }

  private async refresh(): Promise<CurrentSnapshot | null> {
    const cached = await this.fromCache()
    if (cached) return cached
    this.hubCalls++
    const r = await this.hub.pull(this.current?.seq ?? null)
    this.lastStatus = r.status
    if (r.json != null && r.seq != null) {
      this.adopt(r.seq, r.json)
      if (this.cache) {
        const res = new Response(r.json, {
          headers: {
            'cache-control': `max-age=${SNAPSHOT_REFRESH_MS / 1000}`,
            'x-seq': String(r.seq),
            'x-status': JSON.stringify(r.status),
          },
        })
        this.waitUntil(this.cache.put(CACHE_URL, res).catch(() => {}))
      }
    }
    return this.current
  }

  private async fromCache(): Promise<CurrentSnapshot | null> {
    if (!this.cache) return null
    try {
      const res = await this.cache.match(CACHE_URL)
      if (!res) return null
      const seq = Number(res.headers.get('x-seq'))
      const status = res.headers.get('x-status')
      if (status) this.lastStatus = JSON.parse(status) as HubStatus
      if (this.current && this.current.seq >= seq) return this.current
      this.adopt(seq, await res.text())
      return this.current
    } catch {
      return null
    }
  }

  private adopt(seq: number, json: string): void {
    const snapshot = JSON.parse(json) as RtSnapshot
    this.current = { seq, snapshot, vehiclesByTrip: vehiclesByTrip(snapshot.vehicles) }
  }

  /** Raw protobuf for the legacy proxy, shared per feed key for 10 s. */
  raw(key: string): Promise<RawFeed | null> {
    let f = this.raws.get(key)
    if (!f) {
      f = new SharedFetch(
        () => {
          this.hubCalls++
          return this.hub.getRaw(key)
        },
        SNAPSHOT_REFRESH_MS,
        this.now,
      )
      this.raws.set(key, f)
    }
    return f.get().catch((e) => {
      console.error(JSON.stringify({ level: 'error', msg: 'hub getRaw failed', key, error: String(e) }))
      return f.lastGood
    })
  }
}
