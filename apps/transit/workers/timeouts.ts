/**
 * Upstream deadlines for the transit Worker's proxies. Kept out of workers/app.ts: workerd treats every named export
 * of the entry module as an entrypoint, so constants can't be exported from there.
 */
/** Upstream time limits: a hung binding (seen for 60 s during a bft-api redeploy) must not hang the page. */
export const API_TIMEOUT_MS = 10_000
/**
 * A fail-safe, not a UX target: the API's LLM path has no single shared deadline (3 rounds x 15 s provider timeout,
 * plus tool calls, Turnstile and budget RPCs), so leave generous headroom while still cutting off a hung binding.
 */
export const ASK_TIMEOUT_MS = 90_000

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`upstream timeout after ${ms} ms`)), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}
