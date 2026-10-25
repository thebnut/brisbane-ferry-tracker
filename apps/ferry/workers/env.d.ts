/** Bindings and vars for the bft-ferry Worker (see wrangler.jsonc). */
interface Env {
  ASSETS: Fetcher
  /** API Worker (bft-api) service binding; absent in local dev. */
  API?: Fetcher
  API_BASE: string
  ALLOW_FIXTURES?: string
  FIXTURES?: string
  /** "1" (staging only): serve fixture data when the API errors or has no data, with a visible demo notice. */
  FIXTURE_FALLBACK?: string
  SITE_URL: string
  /** Legacy /api/feedback relay: Discord webhook URL (Worker secret, set by Dev/Brett; never in wrangler.jsonc). */
  FEEDBACK_DISCORD_WEBHOOK_URL?: string
  /** /api/feedback per-IP limiter (ratelimits binding); absent only in local dev and tests. */
  FEEDBACK_LIMITER?: RateLimit
  /** Public Turnstile sitekey for the feedback sheet (the secret stays on bft-api). */
  TURNSTILE_SITEKEY?: string
  /** "true": wildcard CORS on the legacy endpoints (rollback mode, as in api/_cors.js). */
  CORS_ALLOW_ALL?: string
  /** The transit site: where page navigations go when REDIRECT_TO_TRANSIT is "1". */
  TRANSIT_SITE_URL?: string
  /** "1": page navigations redirect to the same page on TRANSIT_SITE_URL (P6, @bft/ui/redirect). Unset in production. */
  REDIRECT_TO_TRANSIT?: string
  /** "301" once the mapping is verified; otherwise the redirect is a 302. */
  REDIRECT_STATUS?: string
  /** Deployed short git sha for the x-bft-build header, passed by the deploy scripts; unset locally ("dev"). */
  BUILD_SHA?: string
  /** GA4 measurement id (production and staging only): unset, GA is off (@bft/ui/analytics-config). */
  GA_MEASUREMENT_ID?: string
  /** "1" (staging): GA4 debug_mode, so DebugView shows the visit. */
  GA_DEBUG?: string
}
