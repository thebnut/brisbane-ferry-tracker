/** The RtHub Durable Object: a thin shell over HubCore (SQLite-backed storage, Free plan compatible). */
import { DurableObject } from 'cloudflare:workers'
import { dataSourceFor } from '../data/source.ts'
import { StaticStore } from '../data/static-store.ts'
import type { WorkerEnv } from '../env.ts'
import { createLogger } from '../log.ts'
import { parseRtModes } from './feeds.ts'
import { HubCore, type PullResult, type RawFeed } from './hub-core.ts'
import type { SnapshotScope } from './split.ts'

export class RtHub extends DurableObject<WorkerEnv> {
  private readonly core: HubCore

  constructor(ctx: DurableObjectState, env: WorkerEnv) {
    super(ctx, env)
    this.core = new HubCore({
      storage: ctx.storage,
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      store: new StaticStore(dataSourceFor(env)),
      config: parseRtModes(env.RT_MODES, env.RT_INDEX_MODES),
      upstream: env.RT_UPSTREAM,
      r2: env.DATA_BUCKET,
      cycleMs: env.RT_CYCLE_MS ? Number(env.RT_CYCLE_MS) : undefined,
      log: createLogger({ svc: 'bft-rthub' }),
    })
  }

  override async alarm(): Promise<void> {
    await this.core.alarm()
  }

  /**
   * Watchdog (1-minute cron). Also restarts a hub left on older code: the keep-alive keeps this object resident, so
   * Cloudflare doesn't restart it on deploy (seen on staging). When the calling Worker's version differs from the one
   * this instance runs, abort; the stored alarm then fires in a fresh instance on the new code.
   */
  async ensureRunning(
    callerVersion?: string,
  ): Promise<{ rearmed: boolean; lastCycleAt: number; alarm: number | null; restarted?: boolean }> {
    const r = await this.core.ensureRunning()
    const mine = this.env.CF_VERSION?.id
    if (callerVersion && mine && callerVersion !== mine) {
      this.ctx.waitUntil(Promise.resolve().then(() => this.ctx.abort(`new version ${callerVersion}`)))
      return { ...r, restarted: true }
    }
    return r
  }

  pull(sinceSeq: number | null, scope?: SnapshotScope): Promise<PullResult> {
    return this.core.pull(sinceSeq, scope)
  }

  getRaw(key: string): Promise<RawFeed | null> {
    return this.core.getRaw(key)
  }

  /** Watchdog drill: delete the alarm so the chain is dead until the cron watchdog re-arms it. */
  killAlarmForDrill(): Promise<{ killedAt: number }> {
    return this.core.killForDrill()
  }

  /** Phase 0 spike only (SPIKE_ENABLED=1): rebuild the snapshot `runs` times from the stored feeds. */
  benchmark(runs: number): Promise<{ runs: number; seq: number | null }> {
    if (this.env.SPIKE_ENABLED !== '1') throw new Error('spike disabled')
    return this.core.benchmark(runs)
  }
}
