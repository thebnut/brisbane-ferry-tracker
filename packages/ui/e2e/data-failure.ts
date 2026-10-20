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
    return route.fulfill({
      status: 503,
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({ error: 'static data unavailable', detail: 'passthrough', retryable: true }),
    })
  })
  return { restore: () => (failing = false) }
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
