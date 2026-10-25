/**
 * Release review round 1, C3: with nothing saved, the transit home never claims LIVE without its own API answer,
 * however the page was loaded, and after every offline/online transition. Since P-3167c11-O1/H1 it claims nothing
 * with nothing saved, as a mode home without live rows (#159): never LIVE over an empty list, and no OFFLINE in the
 * server's HTML or during an outage the API still answers (503); OFFLINE only while the network can't be reached.
 */
import { goOffline, visibleLiveClaims } from '@bft/ui/e2e/offline.ts'
import { expect, type Page, type Route, test } from '@playwright/test'

const ALERTS = /\/v1\/alerts(?:\?|$)/
const LIVE = (page: Page) => page.locator('header').getByText('LIVE', { exact: true })
const CLAIM = (page: Page) => page.locator('header [data-connection]')

/** Records in the page any moment the header says LIVE (a flash shorter than a poll included). */
async function watchLive(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __live: number }
    w.__live = 0
    new MutationObserver(() => {
      if (document.querySelector('header [data-connection="live"]')) w.__live++
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  return () => page.evaluate(() => (window as unknown as { __live: number }).__live)
}

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

test.describe('C3, P-3167c11-O1/H1: an empty home claims nothing, never LIVE', () => {
  test('a fresh server-rendered home: no OFFLINE in its HTML, nothing claimed through an API outage or after it', async ({
    page,
    request,
  }) => {
    test.slow()
    const html = await (await request.get('/')).text()
    expect(html).toContain('<header')
    expect(html).not.toContain('data-connection=')
    const lives = await watchLive(page)
    const outage = await alertsDown(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect.poll(() => outage.calls.length, { timeout: 10_000 }).toBeGreaterThan(0)
    await page.waitForTimeout(2_000)
    await expect(CLAIM(page)).toHaveCount(0)
    expect(await visibleLiveClaims(page)).toEqual([])

    // The API is back: its answer confirms nothing to claim (no rows), so still no LIVE.
    const back = page.waitForResponse((r) => ALERTS.test(r.url()) && r.ok(), { timeout: 15_000 })
    await outage.lift()
    await back
    await page.waitForTimeout(1_000)
    await expect(CLAIM(page)).toHaveCount(0)
    expect(await lives()).toBe(0)
  })

  test('offline, then online: OFFLINE only while offline, never LIVE', async ({ page, context }) => {
    test.slow()
    const lives = await watchLive(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await page.waitForTimeout(2_000)
    await expect(CLAIM(page)).toHaveCount(0)

    const outage = await alertsDown(page)
    const goOnline = await goOffline(context)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('header [data-connection="offline"]')).toHaveText('OFFLINE')

    // Back online, the API still answering 503: reached, so OFFLINE clears, with nothing to claim.
    const before = outage.calls.length
    await goOnline()
    await expect.poll(() => outage.calls.length, { timeout: 10_000 }).toBeGreaterThan(before)
    await expect(CLAIM(page)).toHaveCount(0, { timeout: 5_000 })
    expect(await visibleLiveClaims(page)).toEqual([])

    await outage.lift()
    await page.waitForTimeout(12_000)
    await expect(CLAIM(page)).toHaveCount(0)
    expect(await lives()).toBe(0)
    await expect(LIVE(page)).toHaveCount(0)
  })
})
