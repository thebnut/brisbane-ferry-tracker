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
/** Older than this, a request waits for the refresh instead of being served the isolate's copy. */
export const SNAPSHOT_MAX_STALE_MS = 60_000
/** How long a request waits for a background refresh before using the isolate's copy. */
export const SNAPSHOT_WAIT_BUDGET_MS = 250

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
  private loadedAt = Number.NEGATIVE_INFINITY
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

  /**
   * The current snapshot, or null when there is none. Stale-while-revalidate: once the isolate's copy is 10 s old
   * the refresh runs in the background (`waitUntil`); this request waits for it up to 250 ms, then gets the copy it
   * has. Only a missing
   * or very old (> 60 s) copy makes the request wait. On staging a blocking refresh cost ~1 s (two R2 reads from
   * BNE), a background one costs the request nothing.
   */
  async get(waitUntil?: (p: Promise<unknown>) => void): Promise<CurrentSnapshot | null> {
    const age = this.now() - this.loadedAt
    if (this.current && age < SNAPSHOT_MAX_STALE_MS) {
      if (age >= SNAPSHOT_REFRESH_MS) {
        const refresh = this.shared.get().catch(() => null)
        ;(waitUntil ?? this.waitUntil)(refresh)
        // Give a warm refresh a moment (one R2 round trip) so this request already sees it; past the budget, serve
        // the copy we have and let the refresh finish in the background.
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([refresh, new Promise((r) => (timer = setTimeout(r, SNAPSHOT_WAIT_BUDGET_MS)))])
        clearTimeout(timer)
      }
      return this.current
    }
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
    this.loadedAt = this.now()
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
      this.loadedAt = this.now()
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
