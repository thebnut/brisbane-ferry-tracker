import type { RtHub } from './rt/hub.ts'

export interface WorkerEnv {
  RT_HUB: DurableObjectNamespace<RtHub>
  /** Static-assets data Worker (services/data), until R2 is enabled. */
  DATA?: Fetcher
  /** R2 bucket; when bound it takes precedence over DATA. */
  DATA_BUCKET?: R2Bucket
  /** `ferry,train` (per-mode feeds) or `all` (combined feeds). */
  RT_MODES?: string
  RT_UPSTREAM: string
  CORS_ALLOW_ALL?: string
  SPIKE_ENABLED?: string
}
