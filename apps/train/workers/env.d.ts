/** Bindings and vars for the bft-train Worker (see wrangler.jsonc). */
interface Env {
  ASSETS: Fetcher
  /** API Worker (bft-api) service binding; absent in local dev. */
  API?: Fetcher
  API_BASE: string
  ALLOW_FIXTURES?: string
  FIXTURES?: string
  SITE_URL: string
  /** "1" allows indexing (production domain only); otherwise pages are noindex and robots.txt disallows all. */
  INDEXABLE?: string
  /** "1" lets service detail use the hibernating-WebSocket prototype (ADR-0003) at API_WS_BASE. */
  TRIP_WS?: string
  /** Where the browser opens trip WebSockets: empty = this Worker (same origin), else e.g. wss://bft-api.… */
  API_WS_BASE?: string
  /** TripSocket Durable Object namespace (WebSocket prototype). */
  TRIP_SOCKET?: DurableObjectNamespace<import('./tripSocket.ts').TripSocket>
}
