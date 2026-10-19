/**
 * Upstream deadlines for the transit Worker's proxies. Kept out of workers/app.ts: workerd treats every named export
 * of the entry module as an entrypoint, so constants can't be exported from there. The /v1 deadline is shared with
 * the other apps' proxies (@bft/ui/upstream).
 */
export { API_TIMEOUT_MS, proxied, withTimeout } from '@bft/ui/upstream'
/**
 * A fail-safe, not a UX target: the API's LLM path has no single shared deadline (3 rounds x 15 s provider timeout,
 * plus tool calls, Turnstile and budget RPCs), so leave generous headroom while still cutting off a hung binding.
 */
export const ASK_TIMEOUT_MS = 90_000
