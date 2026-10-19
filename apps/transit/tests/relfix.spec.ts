/**
 * Release review round 1, C3: with nothing saved, the transit home claims LIVE only after its own API answer (the
 * alerts), however the page was loaded, and needs a new answer after every offline/online transition.
 */
import { goOffline, visibleLiveClaims } from '@bft/ui/e2e/offline.ts'
import { expect, type Page, type Route, test } from '@playwright/test'

const ALERTS = /\/v1\/alerts(?:\?|$)/
const LIVE = (page: Page) => page.locator('header').getByText('LIVE', { exact: true })

/** Every /v1/alerts call answers 503 (the API is down) until the returned function lifts it. */
async function alertsDown(page: Page) {
  const calls: string[] = []
  const down = (route: Route) => {
    calls.push(route.request().url())
    return route.fulfill({ status: 503, json: { error: 'upstream_unavailable' } })
  }
  await page.context().route(ALERTS, down)
  return {
    calls,
    lift: () => page.context().unroute(ALERTS, down),
  }
}

test.describe('C3: an empty home is LIVE only after an API answer', () => {
  test('a fresh server-rendered home during an API outage shows no LIVE; LIVE once the API answers', async ({
    page,
  }) => {
    test.slow()
    const outage = await alertsDown(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect.poll(() => outage.calls.length, { timeout: 10_000 }).toBeGreaterThan(0)
    await page.waitForTimeout(2_000)
    await expect(LIVE(page)).toHaveCount(0)
    expect(await visibleLiveClaims(page)).toEqual([])
    await expect(page.locator('header').getByText('OFFLINE', { exact: true })).toBeVisible()

    // The API is back: the next retry (every 10 s) confirms it.
    await outage.lift()
    await expect(LIVE(page)).toBeVisible({ timeout: 15_000 })
  })

  test('offline, then online: LIVE only after a new answer', async ({ page, context }) => {
    test.slow()
    await page.goto('/')
    await expect(LIVE(page)).toBeVisible({ timeout: 10_000 })

    const outage = await alertsDown(page)
    const goOnline = await goOffline(context)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 10_000 })
    await expect(LIVE(page)).toHaveCount(0)

    // Back online, but the API still answers 503: the browser's online event alone restores nothing.
    const before = outage.calls.length
    await goOnline()
    await expect.poll(() => outage.calls.length, { timeout: 10_000 }).toBeGreaterThan(before)
    await page.waitForTimeout(2_000)
    await expect(LIVE(page)).toHaveCount(0)
    expect(await visibleLiveClaims(page)).toEqual([])

    await outage.lift()
    await expect(LIVE(page)).toBeVisible({ timeout: 15_000 })
  })
})
