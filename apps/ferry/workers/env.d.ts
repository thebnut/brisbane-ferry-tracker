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
  /** Legacy /api/feedback relay (Worker secrets in production, same values as Vercel's). */
  N8N_WEBHOOK_URL?: string
  N8N_AUTH_TOKEN?: string
  /** "true": wildcard CORS on the legacy endpoints (rollback mode, as in api/_cors.js). */
  CORS_ALLOW_ALL?: string
}
