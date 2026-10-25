/** Bindings and vars for the bft-train Worker (see wrangler.jsonc). */
interface Env {
  ASSETS: Fetcher
  /** API Worker (bft-api) service binding; absent in local dev. */
  API?: Fetcher
  API_BASE: string
  ALLOW_FIXTURES?: string
  FIXTURES?: string
  SITE_URL: string
  /** The transit site, where /feedback sends people (its feedback sheet). */
  TRANSIT_SITE_URL?: string
  /** "1" allows indexing (production domain only); otherwise pages are noindex and robots.txt disallows all. */
  INDEXABLE?: string
  /** "1" lets service detail use the hibernating-WebSocket prototype (ADR-0003) at API_WS_BASE. */
  TRIP_WS?: string
  /** Where the browser opens trip WebSockets: empty = this Worker (same origin), else e.g. wss://bft-api.… */
  API_WS_BASE?: string
  /** TripSocket Durable Object namespace (WebSocket prototype). */
  TRIP_SOCKET?: DurableObjectNamespace<import('./tripSocket.ts').TripSocket>
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
