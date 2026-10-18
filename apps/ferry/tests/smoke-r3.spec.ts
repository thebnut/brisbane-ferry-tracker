/**
 * Regression tests for Dev's smoke test round 3 (19 Oct 2026).
 * F1: an offline load must render the styled offline/scheduled board (or a styled offline page), never LIVE.
 */
import { bodyFont, goOffline, visibleLiveClaims, waitForServiceWorker } from '@bft/ui/e2e/offline.ts'
import { expect, test } from '@playwright/test'

test.describe('R3-F1: offline loads after the first visit', () => {
  test.slow()

  test('a reload and a fresh page are styled, offline and never LIVE', async ({ page, context }) => {
    // The server HTML does claim LIVE (the guard has something to hide).
    expect(await (await page.request.get('/')).text()).toContain('data-live-claim')
    await page.goto('/')
    await waitForServiceWorker(page, 'ferry-pages')
    await goOffline(context)

    await page.reload()
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible()
    expect(await bodyFont(page)).toContain('Inter')
    await page.waitForTimeout(1_000)
    expect(await visibleLiveClaims(page)).toEqual([])

    const fresh = await context.newPage()
    await fresh.goto('/')
    await expect(fresh.locator('[data-banner=offline]').first()).toBeVisible()
    expect(await bodyFont(fresh)).toContain('Inter')
    await fresh.waitForTimeout(1_000)
    expect(await visibleLiveClaims(fresh)).toEqual([])
  })

  test('a page never opened on this device gets a styled offline page', async ({ page, context }) => {
    await page.goto('/')
    await waitForServiceWorker(page, 'ferry-pages')
    await goOffline(context)
    await page.goto('/terminal/riverside')
    await expect(page.locator('[data-offline-page]')).toBeVisible()
    await expect(page.locator('[data-banner=offline]')).toHaveText('Offline')
    expect(await bodyFont(page)).toContain('Inter')
    expect(await visibleLiveClaims(page)).toEqual([])
  })

  test("a saved copy from an older build (assets no longer precached) isn't rendered unstyled", async ({
    page,
    context,
  }) => {
    await page.goto('/')
    await waitForServiceWorker(page, 'ferry-pages')
    // The page cache holds HTML whose stylesheet and entry script belong to a previous deploy.
    await page.evaluate(async () => {
      const cache = await caches.open('ferry-pages')
      const res = await cache.match(location.href)
      const html = ((await res?.text()) ?? '')
        .replace(/\/assets\/root-[^"]+\.css/g, '/assets/root-0ldBu1ld.css')
        .replace(/\/assets\/entry\.client-[^"]+\.js/g, '/assets/entry.client-0ldBu1ld.js')
      await cache.put(location.href, new Response(html, { headers: { 'content-type': 'text/html' } }))
    })
    await goOffline(context)
    await page.reload()
    await expect(page.locator('[data-offline-page]')).toBeVisible()
    expect(await bodyFont(page)).toContain('Inter')
    expect(await visibleLiveClaims(page)).toEqual([])
  })

  test('if the stylesheet and scripts fail to load, an offline page still hides its LIVE claims', async ({
    page,
    context,
  }) => {
    await context.route(/\/assets\/.*\.(css|js)$/, (route) => route.abort('internetdisconnected'))
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true })
    })
    await page.goto('/')
    expect(await bodyFont(page)).not.toContain('Inter')
    expect(await page.locator('[data-live-claim]').count()).toBeGreaterThan(0)
    expect(await visibleLiveClaims(page)).toEqual([])
  })
})
