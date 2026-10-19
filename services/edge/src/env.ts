import type { AiEnv } from './ai/routes.ts'
import type { RtHub } from './rt/hub.ts'

export interface WorkerEnv extends AiEnv {
  RT_HUB: DurableObjectNamespace<RtHub>
  /** Static-assets data Worker (services/data), until R2 is enabled. */
  DATA?: Fetcher
  /** R2 bucket; when bound it takes precedence over DATA. */
  DATA_BUCKET?: R2Bucket
  /** Per-environment namespace for `rt/…` objects in the shared bucket, e.g. `rt-staging/` (unset: `rt/`, production). */
  RT_R2_PREFIX?: string
  /** `ferry,train` (per-mode feeds) or `all` (combined feeds). */
  RT_MODES?: string
  /** Modes whose trip indexes the hub loads (default: polled modes except bus, see parseRtModes). */
  RT_INDEX_MODES?: string
  RT_UPSTREAM: string
  /** Alarm interval in ms (default 15000). */
  RT_CYCLE_MS?: string
  /** `combined` (one R2 object for every mode, ranged reads) or `documents` (default). See HubDeps.layout. */
  RT_R2_LAYOUT?: string
  /** How old (ms) an isolate's snapshot copy may be before a request waits for the refresh (default 60000). */
  RT_SNAPSHOT_MAX_STALE_MS?: string
  /** Most a request waits for realtime before answering scheduled rows as stale/unavailable (ms, default 1200). */
  RT_WAIT_MS?: string
  /** `1`: log per-phase RtHub cycle timings on every poll (slow cycles are always logged). */
  RT_PROFILE?: string
  CORS_ALLOW_ALL?: string
  SPIKE_ENABLED?: string
  /** version_metadata binding: lets the cron restart a resident hub that still runs an older deploy. */
  CF_VERSION?: { id: string; tag?: string; timestamp?: string }
  /** Deployed short git sha, passed by the deploy scripts (`--var BUILD_SHA:…`); unset locally ("dev"). */
  BUILD_SHA?: string
  /** Secret (wrangler secret put DRILL_TOKEN). Enables POST /__drill/kill-alarm with a bearer token. */
  DRILL_TOKEN?: string
}
