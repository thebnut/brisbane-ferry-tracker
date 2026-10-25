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
  /**
   * "1" drops the X-Robots-Tag noindex header. Kept "0" in staging and production: the mounted mode pages are noindex
   * (their canonical copies are the standalone apps, and the train loaders read this flag too) and robots.txt
   * disallows all. Trips poll here (TRIP_WS unset).
   */
  INDEXABLE?: string
  TRIP_WS?: string
  API_WS_BASE?: string
  TRIP_SOCKET?: DurableObjectNamespace
  /** Feedback relay and legacy endpoints (apps/ferry/workers/legacy.ts): Worker secrets in production. */
  FEEDBACK_DISCORD_WEBHOOK_URL?: string
  FEEDBACK_LIMITER?: RateLimit
  CORS_ALLOW_ALL?: string
  /** Deployed short git sha for the x-bft-build header, passed by the deploy scripts; unset locally ("dev"). */
  BUILD_SHA?: string
  /** GA4 measurement id (production and staging only): unset, GA is off (@bft/ui/analytics-config). */
  GA_MEASUREMENT_ID?: string
  /** "1" (staging): GA4 debug_mode, so DebugView shows the visit. */
  GA_DEBUG?: string
}
