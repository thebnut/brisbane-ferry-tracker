/**
 * Regression tests for Dev's smoke test round 3 (19 Oct 2026).
 * X9: back online, the offline state clears at once (a refetch), not at the next poll.
 * F1: an offline load must render the styled offline/scheduled board (or a styled offline page), never LIVE.
 */
import { offlineLoadSuite, reconnectSuite } from '@bft/ui/e2e/offline-suite.ts'
import { expect, test } from '@playwright/test'

offlineLoadSuite({ path: '/stop/10802', unvisited: '/stop/19051', pagesCache: 'bus-pages' })

test('R3-B10: a stop page makes no request that 404s (its own, the API, the service worker)', async ({
  page,
  context,
}) => {
  const failed: string[] = []
  context.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`)
  })
  await page.goto('/stop/10802')
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await page.waitForTimeout(3_000)
  expect(failed).toEqual([])
})

test('R3-B10: the public stop number with its leading zero opens the stop (no 404s)', async ({
  page,
  context,
}) => {
  const failed: string[] = []
  context.on('response', (r) => {
    if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`)
  })
  const res = await page.request.get('/stop/010802?x=1', { maxRedirects: 0 })
  expect(res.status()).toBe(301)
  expect(res.headers().location).toBe('/stop/10802?x=1')
  await page.goto('/stop/010802')
  await expect(page).toHaveURL(/\/stop\/10802$/)
  await expect(page.getByTestId('departure').first()).toBeVisible()
  expect(failed).toEqual([])
})

reconnectSuite({ path: '/stop/10802' })
