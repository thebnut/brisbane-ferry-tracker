/**
 * Regression tests for Dev's smoke test round 7 (19 Oct 2026).
 * Bus saved stops took 15–25 s to show LIVE after the network came back: LIVE must return within about 3 s.
 * Time-of-day independent: pinned departures (tests/upcoming.ts).
 */
import { goOffline, visibleLiveClaims, waitForServiceWorker } from '@bft/ui/e2e/offline.ts'
import { expect, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const SAVED = [{ id: '10802', name: 'Cultural Centre station, platform 1' }]

for (const path of ['/', '/stop/10802'])
  test(`R7: a saved stop (${path}) is LIVE again within 3 s of the network returning`, async ({
    page,
    context,
  }) => {
    test.slow()
    await page.addInitScript((saved) => localStorage.setItem('bft-bus-saved', JSON.stringify(saved)), SAVED)
    await pinUpcoming(context)
    await page.goto(path)
    await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
    const goOnline = await goOffline(context)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
    // Let polls fail while offline, so the boards hold offline copies.
    await page.waitForTimeout(16_000)
    // (The pin from before going offline still answers.)
    await goOnline()
    const back = Date.now()
    await expect.poll(() => visibleLiveClaims(page), { timeout: 3_000, intervals: [100] }).not.toEqual([])
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0)
    console.log(`${path}: LIVE ${Date.now() - back} ms after reconnecting`)
  })

for (const path of ['/', '/stop/10802'])
  test(`R7: a saved stop (${path}) is LIVE again within 3 s after the service worker's network returns (no online event)`, async ({
    page,
    context,
  }) => {
    test.slow()
    await page.addInitScript((saved) => localStorage.setItem('bft-bus-saved', JSON.stringify(saved)), SAVED)
    await pinUpcoming(context)
    await page.goto(path)
    await waitForServiceWorker(page, 'bus-pages')
    await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
    // DevTools' "Service Workers → Offline": the service worker's requests fail, navigator.onLine stays true, and
    // unticking it fires no `online` event.
    const cut = (route: import('@playwright/test').Route) =>
      route.request().serviceWorker() ? route.abort('internetdisconnected') : route.fallback()
    await context.route('**/*', cut)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(16_000)
    await context.unroute('**/*', cut)
    const back = Date.now()
    await expect.poll(() => visibleLiveClaims(page), { timeout: 3_500, intervals: [100] }).not.toEqual([])
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0)
    console.log(`${path}: LIVE ${Date.now() - back} ms after the service worker's network returned`)
  })

test('R7: /feedback sends people to the transit feedback sheet (bus has none of its own)', async ({
  request,
}) => {
  const res = await request.get('/feedback', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  expect(res.headers().location).toMatch(/^https:\/\/[^/]+\/feedback$/)
})
