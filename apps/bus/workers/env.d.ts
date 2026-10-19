/** Bindings and vars for the bft-bus Worker (see wrangler.jsonc). */
interface Env {
  ASSETS: Fetcher
  /** API Worker (bft-api) service binding; absent in local dev. */
  API?: Fetcher
  API_BASE: string
  ALLOW_FIXTURES?: string
  FIXTURES?: string
  /** "1" (staging only): serve fixture data when the API errors or has no data; pages show a demo notice. */
  FIXTURE_FALLBACK?: string
  SITE_URL: string
  /** The transit site, where /feedback sends people (its feedback sheet). */
  TRANSIT_SITE_URL?: string
  /** "1" allows indexing (production domain, once verified); otherwise X-Robots-Tag noindex and robots.txt disallows all. */
  INDEXABLE?: string
}
