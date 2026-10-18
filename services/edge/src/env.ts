import type { RtHub } from './rt/hub.ts'

export interface WorkerEnv {
  RT_HUB: DurableObjectNamespace<RtHub>
  /** Static-assets data Worker (services/data), until R2 is enabled. */
  DATA?: Fetcher
  /** R2 bucket; when bound it takes precedence over DATA. */
  DATA_BUCKET?: R2Bucket
  /** `ferry,train` (per-mode feeds) or `all` (combined feeds). */
  RT_MODES?: string
  /** Modes whose trip indexes the hub loads (default: polled modes except bus, see parseRtModes). */
  RT_INDEX_MODES?: string
  RT_UPSTREAM: string
  /** Alarm interval in ms (default 15000). */
  RT_CYCLE_MS?: string
  CORS_ALLOW_ALL?: string
  SPIKE_ENABLED?: string
  /** Secret (wrangler secret put DRILL_TOKEN). Enables POST /__drill/kill-alarm with a bearer token. */
  DRILL_TOKEN?: string
}
