/** The RtHub Durable Object: a thin shell over HubCore (SQLite-backed storage, Free plan compatible). */
import { DurableObject } from 'cloudflare:workers'
import { dataSourceFor } from '../data/source.ts'
import { StaticStore } from '../data/static-store.ts'
import type { WorkerEnv } from '../env.ts'
import { createLogger } from '../log.ts'
import { parseRtModes } from './feeds.ts'
import { HubCore, type PullResult, type RawFeed } from './hub-core.ts'

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
      log: createLogger({ svc: 'bft-rthub' }),
    })
  }

  override async alarm(): Promise<void> {
    await this.core.alarm()
  }

  ensureRunning(): Promise<{ rearmed: boolean; lastCycleAt: number; alarm: number | null }> {
    return this.core.ensureRunning()
  }

  pull(sinceSeq: number | null): Promise<PullResult> {
    return this.core.pull(sinceSeq)
  }

  getRaw(key: string): Promise<RawFeed | null> {
    return this.core.getRaw(key)
  }

  /** Phase 0 spike only (SPIKE_ENABLED=1): rebuild the snapshot `runs` times from the stored feeds. */
  benchmark(runs: number): Promise<{ runs: number; seq: number | null }> {
    if (this.env.SPIKE_ENABLED !== '1') throw new Error('spike disabled')
    return this.core.benchmark(runs)
  }
}
