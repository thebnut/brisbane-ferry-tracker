/**
 * bft-api Worker entry: the Hono /v1 app, the 1-minute watchdog cron, and the RtHub Durable Object class.
 */
import { createApp } from './app.ts'
import { dataSourceFor } from './data/source.ts'
import { StaticStore } from './data/static-store.ts'
import type { WorkerEnv } from './env.ts'
import { createLogger, errorMessage } from './log.ts'
import { pullFromR2 } from './r2-snapshots.ts'
import { parseRtModes } from './rt/feeds.ts'
import type { SnapshotScope } from './rt/split.ts'
import { parseMaxStale, SnapshotClient } from './snapshot-client.ts'

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
    const cfg = parseRtModes(env.RT_MODES, env.RT_INDEX_MODES)
    // A DO stub is bound to the request that created it, so make one per call (env bindings are reusable).
    // Snapshots come from R2 when it is bound, otherwise from the hub over RPC: one client per scope (a mode, or
    // alerts), so an isolate serving /v1/ferry only fetches and parses the ferry document. Raw feeds (legacy proxy)
    // always come from the hub; they are shared per isolate for 10 s.
    const store = new StaticStore(dataSourceFor(env))
    const hubClient = {
      pull: (since: number | null, scope?: SnapshotScope) =>
        env.DATA_BUCKET ? pullFromR2(store.source, since, scope) : hubStub(env).pull(since, scope),
      getRaw: (key: string) => hubStub(env).getRaw(key),
    }
    const waitUntil = (p: Promise<unknown>) => pendingWaitUntil?.(p)
    const maxStale = parseMaxStale(env.RT_SNAPSHOT_MAX_STALE_MS)
    const snapshots = new SnapshotClient(hubClient, Date.now, waitUntil, undefined, undefined, maxStale)
    const scoped = new Map<SnapshotScope, SnapshotClient>()
    const snapshotsFor = (scope: SnapshotScope) => {
      let cl = scoped.get(scope)
      if (!cl) {
        cl = new SnapshotClient(hubClient, Date.now, waitUntil, undefined, scope, maxStale)
        scoped.set(scope, cl)
      }
      return cl
    }
    const app = createApp({
      store,
      snapshots,
      snapshotsFor,
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
    // Phase 1 watchdog drill: kill the alarm chain, then watch /v1/health recover via the cron watchdog.
    app.post('/__drill/kill-alarm', async (c) => {
      const token = env.DRILL_TOKEN
      if (!token || c.req.header('authorization') !== `Bearer ${token}`)
        return c.json({ error: 'not found' }, 404)
      return c.json(await hubStub(env).killAlarmForDrill())
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
        .ensureRunning(env.CF_VERSION?.id)
        .then((r) =>
          log.info('watchdog', {
            rearmed: r.rearmed,
            lastCycleAt: r.lastCycleAt,
            alarm: r.alarm,
            restarted: r.restarted,
          }),
        )
        .catch((e) => {
          // The hub aborting itself to pick up a new deploy rejects this call; that's the restart working.
          const msg = errorMessage(e)
          if (msg.startsWith('new version'))
            log.info('watchdog: hub restarted for a new version', { error: msg })
          else log.error('watchdog failed', { error: msg })
        }),
    )
  },
} satisfies ExportedHandler<WorkerEnv>
