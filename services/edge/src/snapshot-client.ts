/**
 * Edge read path for the RT snapshot (transit-architecture.md §3.3): isolate memory, refreshed at most every 10 s
 * through one shared in-flight refresh. The Durable Object is asked only on refresh, never per
 * request, and only for a newer `seq` (unchanged snapshots aren't re-sent).
 *
 * On custom domains a Cache API entry shares one pull between the isolates of a PoP. On *.workers.dev the Cache
 * API is a no-op, so each isolate pulls on its own (at most 6 RPCs a minute per warm isolate).
 *
 * The refresh age is measured from when this isolate last pulled, not from the snapshot's fetchedAt: if the hub
 * stalls, a fetchedAt-based rule would call the DO on every request.
 *
 * No request waits on a refresh for longer than its deadline (the 19 Oct staging stall, see ./deadline.ts). A refresh
 * still pending after SNAPSHOT_REFRESH_DEADLINE_MS is abandoned, and how depends on why:
 * - **slow** (its own timer fired, so its request is alive): it keeps running in the background and still commits
 *   when it lands, if nothing newer has. The 10 s attempt throttle stands, so a hub or R2 that is steadily slower than
 *   the deadline is asked every 10 s and its answers are used (release review r3 P2), not re-asked every 3 s and
 *   thrown away;
 * - **lost** (a later request finds it past its deadline and unsettled, see `isDead`: its I/O died with its request):
 *   the next request retries at once.
 * Commits only move forward: an answer older than the isolate's copy is ignored, whenever it lands.
 */
import { type RtSnapshot, type Vehicle, vehiclesByTrip } from '@bft/core'
import { awaitFlight, DeadlineError, type Flight, flight, isDead, within } from './deadline.ts'
import type { HubStatus, PullResult, RawFeed } from './rt/hub-core.ts'
import type { SnapshotScope } from './rt/split.ts'

export const SNAPSHOT_REFRESH_MS = 10_000
/** Default for RT_SNAPSHOT_MAX_STALE_MS: older than this, a request waits for the refresh. */
export const SNAPSHOT_MAX_STALE_MS = 60_000
/**
 * A refresh (Cache API match, then the hub pull: one or two small R2 reads, ~1 s from BNE when blocking on staging)
 * still pending after this is abandoned. Well under the apps' 8 s client and 10 s proxy deadlines, and long enough
 * that a slow but healthy R2 read isn't cut off.
 */
export const SNAPSHOT_REFRESH_DEADLINE_MS = 3_000
/** How long a request holding an expired copy (older than maxStaleMs) waits for the refresh before being served it. */
export const SNAPSHOT_STALE_WAIT_MS = 1_500
/**
 * How long a slow refresh is kept alive in its request's `waitUntil` so it can still commit. By then the next attempt
 * is due anyway, and it stays well inside the 30 s Workers allow `waitUntil` after a response.
 */
export const SNAPSHOT_LATE_COMMIT_MS = SNAPSHOT_REFRESH_MS

export interface SnapshotTiming {
  refreshDeadlineMs: number
  staleWaitMs: number
  lateCommitMs: number
}

/** RT_SNAPSHOT_MAX_STALE_MS (ms), clamped to at least the 10 s refresh interval; unset or invalid: the default. */
export function parseMaxStale(value: string | undefined): number {
  const n = Number(value)
  if (!value || !Number.isFinite(n) || n <= 0) return SNAPSHOT_MAX_STALE_MS
  return Math.max(SNAPSHOT_REFRESH_MS, Math.floor(n))
}

export interface CurrentSnapshot {
  seq: number
  snapshot: RtSnapshot
  vehiclesByTrip: Map<string, Vehicle>
}

export interface HubClient {
  pull(sinceSeq: number | null, scope?: SnapshotScope): Promise<PullResult>
  getRaw(key: string): Promise<RawFeed | null>
}

const CACHE_BASE = 'https://bft-cache.internal/rt/snapshot'

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
  private attemptedAt = Number.NEGATIVE_INFINITY
  /** The refresh in flight, which requests join. One abandoned at its deadline may still commit (see `commit`). */
  private inflight: Refresh | null = null
  private tokens = 0
  /** Bumped on every commit, so a late answer can tell whether anything committed since it started. */
  private commits = 0
  private readonly raws = new Map<string, RawShare>()
  private readonly timing: SnapshotTiming
  /** For tests and /v1/health: how many times the hub was actually called. */
  hubCalls = 0
  /** For tests: refreshes abandoned at their deadline (slow or lost). */
  abandoned = 0

  constructor(
    private readonly hub: HubClient,
    private readonly now: () => number = Date.now,
    private readonly waitUntil: (p: Promise<unknown>) => void = () => {},
    private readonly cache: CacheLike | null = sharedCache(),
    /** Which snapshot document this client follows: one mode, alerts, or (undefined) the whole snapshot. */
    readonly scope?: SnapshotScope,
    /** Older than this, a request waits (briefly) for the refresh instead of being served the isolate's copy. */
    private readonly maxStaleMs: number = SNAPSHOT_MAX_STALE_MS,
    timing: Partial<SnapshotTiming> = {},
  ) {
    this.timing = {
      refreshDeadlineMs: timing.refreshDeadlineMs ?? SNAPSHOT_REFRESH_DEADLINE_MS,
      staleWaitMs: timing.staleWaitMs ?? SNAPSHOT_STALE_WAIT_MS,
      lateCommitMs: timing.lateCommitMs ?? SNAPSHOT_LATE_COMMIT_MS,
    }
  }

  private get cacheUrl(): string {
    return `${CACHE_BASE}/${this.scope ?? 'all'}`
  }

  get status(): HubStatus | null {
    return this.lastStatus
  }

  /**
   * True when no refresh has confirmed the isolate's copy for maxStaleMs: a request was served it because its wait
   * ran out or the refresh failed. Callers report such a copy as stale, never live.
   */
  get expired(): boolean {
    return this.now() - this.loadedAt >= this.maxStaleMs
  }

  /**
   * The current snapshot, or null when there is none. Stale-while-revalidate: once the isolate's copy is 10 s old
   * the refresh runs in the background (`waitUntil`) and this request gets the current copy at once. (Waiting up to
   * 250 ms for the refresh was measured on staging: R2 from BNE takes longer, so it only added latency.) Only a missing
   * or very old (> 60 s) copy makes the request wait, and only for a bounded time: with an expired copy up to
   * SNAPSHOT_STALE_WAIT_MS (then it gets that copy, which `expired` flags), with none until the refresh deadline
   * (then null, the "unavailable" path). On staging a blocking refresh cost ~1 s (two R2 reads from BNE), a
   * background one costs the request nothing.
   */
  async get(waitUntil?: (p: Promise<unknown>) => void): Promise<CurrentSnapshot | null> {
    const now = this.now()
    const { refreshDeadlineMs } = this.timing
    // A refresh past its deadline is presumed lost (its request ended); drop it so this request can start another.
    if (this.inflight && isDead(this.inflight, now, refreshDeadlineMs)) this.abandon(this.inflight, 'lost')
    const age = now - this.loadedAt
    // Refresh attempts are throttled on their own clock, so a failing hub or R2 isn't asked on every request
    // (Codex re-review #4); `loadedAt` still reflects only successful loads.
    const mayAttempt = now - this.attemptedAt >= SNAPSHOT_REFRESH_MS
    const wu = waitUntil ?? this.waitUntil
    if (this.current && age < this.maxStaleMs) {
      if (age >= SNAPSHOT_REFRESH_MS && mayAttempt && !this.inflight) this.attempt(wu)
      return this.current
    }
    // Cold or expired: wait for the refresh, joining one already in flight; only starting a new one is throttled.
    if (!this.inflight && !mayAttempt) return this.current
    const run = this.attempt(wu)
    // Each waiter races the shared refresh on its own timer, never past the refresh's deadline. A waiter that runs
    // out leaves the refresh alone: its own timer abandons it as slow, or a later request's `isDead` check as lost.
    const left = run.at + refreshDeadlineMs - now
    const wait = this.current ? Math.min(this.timing.staleWaitMs, left) : left
    try {
      return await within(run.p, wait, 'rt snapshot refresh')
    } catch {
      return this.current
    }
  }

  /**
   * The refresh in flight, or a new one. A new one is handed to `waitUntil` so it can outlive the request that
   * starts it (a waiter whose wait runs out returns before it), and it carries its own deadline.
   */
  private attempt(waitUntil: (p: Promise<unknown>) => void): Refresh {
    if (this.inflight) return this.inflight
    const token = ++this.tokens
    const at = this.now()
    this.attemptedAt = at
    const work = this.refresh({ token, at, commits: this.commits })
    const p = within(work, this.timing.refreshDeadlineMs, 'rt snapshot refresh').then(
      (value) => {
        if (this.inflight?.token === token) this.inflight = null
        return value
      },
      (e: unknown) => {
        // This timer runs in the refresh's own request, so that request is alive: the I/O is slow, not lost.
        if (e instanceof DeadlineError) this.abandon({ token }, 'slow')
        else if (this.inflight?.token === token) this.inflight = null
        throw e
      },
    )
    const run: Refresh = Object.assign(flight(p, at), { token })
    this.inflight = run
    // Keep the request alive for the refresh itself (bounded), not just its deadline, so a slow answer still lands.
    waitUntil(within(work, this.timing.lateCommitMs, 'rt snapshot late commit').catch(() => null))
    return run
  }

  private abandon(run: { token: number }, why: 'slow' | 'lost'): void {
    if (this.inflight?.token !== run.token) return
    this.inflight = null
    // A lost refresh says nothing about the hub (a failed one does), so the next request may retry at once rather
    // than wait out the 10 s attempt throttle (Codex r1 #1). Each retry is bounded by the same deadline. A slow one
    // keeps the throttle: it is still running and may yet commit, and retrying every deadline would only pile on.
    if (why === 'lost') this.attemptedAt = Number.NEGATIVE_INFINITY
    this.abandoned++
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'rt snapshot refresh abandoned',
        why,
        scope: this.scope ?? 'all',
      }),
    )
  }

  private async refresh(run: RefreshRun): Promise<CurrentSnapshot | null> {
    const cached = await this.fromCache()
    if (cached) {
      this.commit(run, cached)
      return this.current
    }
    // Abandoned before it reached the hub: don't add a hub call the throttle didn't allow for.
    if (this.inflight?.token !== run.token) return this.current
    this.hubCalls++
    const r = await this.hub.pull(this.current?.seq ?? null, this.scope)
    if (this.commit(run, r) && r.json != null && r.seq != null && this.current?.seq === r.seq) {
      if (this.cache) {
        const res = new Response(r.json, {
          headers: {
            'cache-control': `max-age=${SNAPSHOT_REFRESH_MS / 1000}`,
            'x-seq': String(r.seq),
            'x-status': JSON.stringify(r.status),
          },
        })
        this.waitUntil(this.cache.put(this.cacheUrl, res).catch(() => {}))
      }
    }
    return this.current
  }

  private async fromCache(): Promise<Loaded | null> {
    if (!this.cache) return null
    try {
      const res = await this.cache.match(this.cacheUrl)
      if (!res) return null
      const seq = Number(res.headers.get('x-seq'))
      const status = res.headers.get('x-status')
      const json = this.current && this.current.seq >= seq ? null : await res.text()
      return { seq, json, status: status ? (JSON.parse(status) as HubStatus) : null }
    } catch {
      return null
    }
  }

  /**
   * Commit what a refresh loaded, if it may: on time (still the refresh in flight), or late with a newer seq, or late
   * with the same (non-null) seq and nothing committed since it started. Any other late answer is ignored. The snapshot itself only ever moves forward, and an answer older than
   * the isolate's copy doesn't touch the status either. A late answer is dated from when its refresh started, so it
   * never makes the copy look fresher than it is. True when committed.
   */
  private commit(run: RefreshRun, r: Loaded): boolean {
    const onTime = this.inflight?.token === run.token
    const cur = this.current
    const newer = r.seq != null && (cur == null || r.seq > cur.seq)
    const older = r.seq != null && cur != null && r.seq < cur.seq
    const same = r.seq != null && cur != null && r.seq === cur.seq
    // Late: only a newer answer, or the same seq with nothing committed since. An older one, or one without a seq,
    // confirms nothing (Codex r1, r2).
    if (!onTime && !newer && !(same && this.commits === run.commits)) return false
    this.commits++
    this.loadedAt = Math.max(this.loadedAt, onTime ? this.now() : run.at)
    if (r.status && !older) this.lastStatus = r.status
    if (newer && r.json != null && r.seq != null) {
      const snapshot = JSON.parse(r.json) as RtSnapshot
      this.current = { seq: r.seq, snapshot, vehiclesByTrip: vehiclesByTrip(snapshot.vehicles) }
    }
    return true
  }

  /**
   * Raw protobuf for the legacy proxy, shared per feed key for 10 s. A fetch still pending at the refresh deadline
   * is replaced like a snapshot refresh; waiters get the last good copy (or null) instead of hanging.
   */
  raw(key: string): Promise<RawFeed | null> {
    let s = this.raws.get(key)
    if (!s) {
      s = { last: null, run: null }
      this.raws.set(key, s)
    }
    const share = s
    const now = this.now()
    const { refreshDeadlineMs } = this.timing
    if (share.last && now - share.last.at < SNAPSHOT_REFRESH_MS) return Promise.resolve(share.last.value)
    if (share.run && isDead(share.run, now, refreshDeadlineMs)) share.run = null
    if (!share.run) {
      this.hubCalls++
      const p: Promise<RawFeed | null> = this.hub.getRaw(key).then((value) => {
        if (share.run === run) share.last = { value, at: this.now() }
        return value
      })
      const run = flight(p, now)
      share.run = run
      void p
        .finally(() => {
          if (share.run === run) share.run = null
        })
        .catch(() => {})
    }
    const run = share.run
    return awaitFlight(run, now, refreshDeadlineMs, `hub getRaw ${key}`).catch((e) => {
      if (e instanceof DeadlineError && share.run === run) share.run = null
      console.error(JSON.stringify({ level: 'error', msg: 'hub getRaw failed', key, error: String(e) }))
      return share.last?.value ?? null
    })
  }
}

type Refresh = Flight<CurrentSnapshot | null> & { token: number }

/** One refresh: its token, when it started, and the commit count then. */
interface RefreshRun {
  token: number
  at: number
  commits: number
}

/** What a refresh loaded, from the Cache API or the hub. */
interface Loaded {
  seq: number | null
  json: string | null
  status: HubStatus | null
}

interface RawShare {
  last: { value: RawFeed | null; at: number } | null
  run: Flight<RawFeed | null> | null
}
