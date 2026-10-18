/**
 * Bindings and vars for the bft-transit Worker (see wrangler.jsonc). A superset of the standalone apps' Env (their
 * loaders run here with this Env, see workers/app.ts), so the optional train-only fields are declared too.
 */
interface Env {
  ASSETS: Fetcher
  /** API Worker (bft-api) service binding; absent in local dev. */
  API?: Fetcher
  API_BASE: string
  ALLOW_FIXTURES?: string
  FIXTURES?: string
  /** "1": answer from fixtures when the API errors (pages show "Demo data"). Not set in staging (live data). */
  FIXTURE_FALLBACK?: string
  SITE_URL: string
  FERRY_SITE_URL?: string
  TRAIN_SITE_URL?: string
  BUS_SITE_URL?: string
  TURNSTILE_SITEKEY?: string
  /** Train only (standalone): indexing and the WebSocket trip prototype. Unset here: noindex, trips poll. */
  INDEXABLE?: string
  TRIP_WS?: string
  API_WS_BASE?: string
  TRIP_SOCKET?: DurableObjectNamespace
  /** Feedback relay and legacy endpoints (apps/ferry/workers/legacy.ts): Worker secrets in production. */
  FEEDBACK_DISCORD_WEBHOOK_URL?: string
  FEEDBACK_LIMITER?: RateLimit
  CORS_ALLOW_ALL?: string
}
