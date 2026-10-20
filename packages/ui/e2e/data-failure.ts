/**
 * Failing the /data static files (stop indexes, geo tiles, route files) the way production does when R2 is slow: the
 * edge's passthrough answers 503 `{ error: 'static data unavailable' }` (a JSON body, which a careless reader would
 * take for data), or the request never completes (abort). `context.route` also covers the service worker's requests.
 * A failed /data read must never reach a route error boundary ("Something went wrong").
 */
import { type BrowserContext, expect, type Page } from '@playwright/test'

export type DataFailure = '503' | 'abort'
export const DATA_FAILURES: DataFailure[] = ['503', 'abort']

/** Fails every /data request (also /__fixtures/data) until the returned `restore` is called. */
export async function failData(context: BrowserContext, how: DataFailure): Promise<{ restore: () => void }> {
  let failing = true
  await context.route(/\/data\//, (route) => {
    if (!failing) return route.continue()
    if (how === 'abort') return route.abort('failed')
    return route.fulfill(EDGE_503)
  })
  return { restore: () => (failing = false) }
}

const EDGE_503 = {
  status: 503,
  contentType: 'application/json',
  headers: { 'cache-control': 'no-store' },
  body: JSON.stringify({ error: 'static data unavailable', detail: 'passthrough', retryable: true }),
}

/**
 * From now on, records the path of every /data request matching `pattern` (also from the service worker), and
 * answers those matching `failAgain` with the edge's 503 while letting the rest through to `failData`'s route. For
 * "one Try again refetched every failed list" and "a list that fails again keeps its notice".
 */
export async function watchData(
  context: BrowserContext,
  pattern: RegExp,
  failAgain?: RegExp,
): Promise<string[]> {
  const seen: string[] = []
  // Routes registered later run first; fallback() hands the request on to failData's.
  await context.route(pattern, (route) => {
    const path = new URL(route.request().url()).pathname
    seen.push(path)
    return failAgain?.test(path) ? route.fulfill(EDGE_503) : route.fallback()
  })
  return seen
}

/** Collects uncaught page errors, for asserting none happened. */
export function pageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

/** The route error boundary never showed. */
export async function expectNoErrorPage(page: Page): Promise<void> {
  await expect(page.getByText('Something went wrong')).toHaveCount(0)
}
