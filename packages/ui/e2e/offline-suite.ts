/**
 * The R3-F1 offline-load suite every app runs: after a first visit online, an offline load renders the styled
 * offline/scheduled page (or the styled offline page), and never LIVE.
 */
import { expect, test } from '@playwright/test'
import { bodyFont, goOffline, visibleLiveClaims, waitForServiceWorker } from './offline.ts'

export function offlineLoadSuite({
  path,
  unvisited,
  pagesCache,
}: {
  /** A page whose server HTML carries live claims. */
  path: string
  /** A page the test never opens online. */
  unvisited: string
  pagesCache: string
}) {
  test.describe('R3-F1: offline loads after the first visit', () => {
    test.slow()

    test(`${path}: a reload and a fresh page are styled, offline and never LIVE`, async ({
      page,
      context,
    }) => {
      // The server HTML does claim LIVE (the guard has something to hide).
      expect(await (await page.request.get(path)).text()).toContain('data-live-claim')
      await page.goto(path)
      await waitForServiceWorker(page, pagesCache)
      await goOffline(context)

      await page.reload()
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible()
      expect(await bodyFont(page)).toContain('Inter')
      await page.waitForTimeout(1_000)
      expect(await visibleLiveClaims(page)).toEqual([])

      const fresh = await context.newPage()
      await fresh.goto(path)
      await expect(fresh.locator('[data-banner=offline]').first()).toBeVisible()
      expect(await bodyFont(fresh)).toContain('Inter')
      await fresh.waitForTimeout(1_000)
      expect(await visibleLiveClaims(fresh)).toEqual([])
    })

    test(`${unvisited}: a page never opened on this device gets a styled offline page`, async ({
      page,
      context,
    }) => {
      await page.goto(path)
      await waitForServiceWorker(page, pagesCache)
      await goOffline(context)
      await page.goto(unvisited)
      await expect(page.locator('[data-offline-page]')).toBeVisible()
      await expect(page.locator('[data-banner=offline]')).toHaveText('Offline')
      expect(await bodyFont(page)).toContain('Inter')
      expect(await visibleLiveClaims(page)).toEqual([])
    })

    test("a saved copy from an older build (assets no longer precached) isn't rendered unstyled", async ({
      page,
      context,
    }) => {
      await page.goto(path)
      await waitForServiceWorker(page, pagesCache)
      // The page cache holds HTML whose stylesheet and entry script belong to a previous deploy.
      await page.evaluate(async (name) => {
        const cache = await caches.open(name)
        const res = await cache.match(location.href)
        const html = ((await res?.text()) ?? '')
          .replace(/\/assets\/root-[^"]+\.css/g, '/assets/root-0ldBu1ld.css')
          .replace(/\/assets\/entry\.client-[^"]+\.js/g, '/assets/entry.client-0ldBu1ld.js')
        await cache.put(location.href, new Response(html, { headers: { 'content-type': 'text/html' } }))
      }, pagesCache)
      await goOffline(context)
      await page.reload()
      await expect(page.locator('[data-offline-page]')).toBeVisible()
      expect(await bodyFont(page)).toContain('Inter')
      expect(await visibleLiveClaims(page)).toEqual([])
    })

    test('a precache missing the stylesheet (evicted, half written) gets the styled offline page', async ({
      page,
      context,
    }) => {
      await page.goto(path)
      await waitForServiceWorker(page, pagesCache)
      await page.evaluate(async () => {
        for (const name of await caches.keys()) {
          if (!name.startsWith('workbox-precache')) continue
          const cache = await caches.open(name)
          for (const req of await cache.keys())
            if (/\/assets\/root-[^/]*\.css/.test(req.url)) await cache.delete(req)
        }
      })
      await goOffline(context)
      await page.reload()
      await expect(page.locator('[data-offline-page]')).toBeVisible()
      expect(await bodyFont(page)).toContain('Inter')
      expect(await visibleLiveClaims(page)).toEqual([])
    })

    test('with JavaScript off, live claims are never shown (Codex review)', async ({ browser }) => {
      const noJs = await browser.newContext({ javaScriptEnabled: false })
      const page = await noJs.newPage()
      await page.goto(path)
      expect(await page.locator('[data-live-claim]').count()).toBeGreaterThan(0)
      const shown = await page
        .locator('[data-live-claim]')
        .evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').length)
      expect(shown).toBe(0)
      await noJs.close()
    })

    test('if the stylesheet and scripts fail to load, an offline page still hides its LIVE claims', async ({
      page,
      context,
    }) => {
      await context.route(/\/assets\/.*\.(css|js)$/, (route) => route.abort('internetdisconnected'))
      await page.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true })
      })
      await page.goto(path)
      expect(await bodyFont(page)).not.toContain('Inter')
      expect(await page.locator('[data-live-claim]').count()).toBeGreaterThan(0)
      expect(await visibleLiveClaims(page)).toEqual([])
    })
  })
}

/**
 * R3-X9: after the network returns, the boards refetch at once (onReconnect), so "Offline · scheduled" clears within
 * about 2 s instead of at the next 15 s poll. `prepare` runs before the first load (saved stops and the like).
 */
export function reconnectSuite({
  path,
  prepare,
}: {
  path: string
  prepare?: (page: import('@playwright/test').Page) => Promise<unknown>
}) {
  test(`${path}: back online, the offline state clears within 2 s without a refresh (R3-X9)`, async ({
    page,
    context,
  }) => {
    test.slow()
    await prepare?.(page)
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    // Visible text only: footers and settings mention offline timetables.
    const offline = page.getByText(/offline/i).filter({ visible: true })
    const goOnline = await goOffline(context)
    await expect(offline.first()).toBeVisible({ timeout: 20_000 })
    // Let a poll fail while offline, so the boards hold offline data (not just a browser flag).
    await page.waitForTimeout(16_000)
    const live = /\/v1\/(ferry|train|bus)\/stops\/[^/]+\/departures/
    const refetched = page.waitForRequest((r) => live.test(new URL(r.url()).pathname), { timeout: 2_000 })
    const back = Date.now()
    await goOnline()
    await refetched
    await expect(offline).toHaveCount(0, {
      timeout: Math.max(500, 2_000 - (Date.now() - back)),
    })
  })
}
