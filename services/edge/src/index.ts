/**
 * bft-api Worker entry: the Hono /v1 app, the 1-minute watchdog cron, and the RtHub Durable Object class.
 */
import { createApp } from './app.ts'
import { dataSourceFor } from './data/source.ts'
import { StaticStore } from './data/static-store.ts'
import type { WorkerEnv } from './env.ts'
import { createLogger, errorMessage } from './log.ts'
import { parseRtModes } from './rt/feeds.ts'
import { SnapshotClient } from './snapshot-client.ts'

export { RtHub } from './rt/hub.ts'

const HUB_NAME = 'hub'
const log = createLogger({ svc: 'bft-api' })

export const hubStub = (env: WorkerEnv) =>
  env.RT_HUB.get(env.RT_HUB.idFromName(HUB_NAME), { locationHint: 'oc' })

/** Per-isolate state: the static caches and the snapshot client live as long as the isolate. */
let isolate: { app: ReturnType<typeof createApp>; snapshots: SnapshotClient } | null = null
let pendingWaitUntil: ((p: Promise<unknown>) => void) | null = null

function getIsolate(env: WorkerEnv) {
  if (!isolate) {
    const cfg = parseRtModes(env.RT_MODES)
    // A DO stub is bound to the request that created it, so make one per call (env bindings are reusable).
    const snapshots = new SnapshotClient(
      { pull: (since) => hubStub(env).pull(since), getRaw: (key) => hubStub(env).getRaw(key) },
      Date.now,
      (p) => pendingWaitUntil?.(p),
    )
    const app = createApp({
      store: new StaticStore(dataSourceFor(env)),
      snapshots,
      corsAllowAll: env.CORS_ALLOW_ALL === 'true',
      combinedFeeds: cfg.combined,
      polledModes: cfg.modes,
      log,
    })
    // Phase 0 spike: time N snapshot rebuilds inside workerd from outside (Date.now is frozen inside).
    app.get('/__spike/rt', async (c) => {
      if (env.SPIKE_ENABLED !== '1') return c.json({ error: 'not found' }, 404)
      return c.json(await hubStub(env).benchmark(Number(c.req.query('runs') ?? 20)))
    })
    isolate = { app, snapshots }
  }
  return isolate
}

export default {
  fetch(req, env, ctx) {
    pendingWaitUntil = (p) => ctx.waitUntil(p)
    return getIsolate(env).app.fetch(req, env, ctx)
  },
  async scheduled(_event, env, ctx) {
    // Watchdog: re-arm the hub's alarm chain if its last completed cycle is older than 45 s.
    ctx.waitUntil(
      hubStub(env)
        .ensureRunning()
        .then((r) => log.info('watchdog', { rearmed: r.rearmed, lastCycleAt: r.lastCycleAt, alarm: r.alarm }))
        .catch((e) => log.error('watchdog failed', { error: errorMessage(e) })),
    )
  },
} satisfies ExportedHandler<WorkerEnv>
