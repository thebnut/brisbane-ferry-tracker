/**
 * Regression tests for Dev's smoke test round 7 (19 Oct 2026).
 * Bus saved stops took 15–25 s to show LIVE after the network came back: LIVE must return within about 3 s (of the
 * `online` event, or without one of the first answer, which comes at the backed-off time: offline backoff).
 * Time-of-day independent: pinned departures (tests/upcoming.ts).
 */
import { probeDueByMs } from '@bft/ui/e2e/backoff.ts'
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
  test(`R7: a saved stop (${path}) is LIVE again within 3 s of the first answer after the service worker's network returns (no online event)`, async ({
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
    // The outage began at or just before the banner (the first call answered from the service worker's cache).
    const from = Date.now()
    await page.waitForTimeout(16_000)
    // Nothing says the network is back, so the next attempt comes at the backed-off time (offline backoff, smoke round
    // 9): ~16 s in, by the 37.5 s probe at the latest (the 17.5 s one may have gone early, with jitter). It must answer
    // within that bound (plus 1 s for when the outage began and 2 s for the answer), and LIVE follow within 3.5 s (R7).
    const back = Date.now()
    const elapsed = back - from
    const answered = page.waitForResponse(
      (r) => /\/v1\/bus\/stops\/10802\/departures/.test(r.url()) && r.ok() && !r.headers()['x-bft-cache'],
      { timeout: probeDueByMs(elapsed + 1_000) - elapsed + 2_000 },
    )
    await context.unroute('**/*', cut)
    await answered
    const answeredAt = Date.now()
    await expect.poll(() => visibleLiveClaims(page), { timeout: 3_500, intervals: [100] }).not.toEqual([])
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0)
    console.log(
      `${path}: first answer ${answeredAt - back} ms after the service worker's network returned, LIVE ${Date.now() - answeredAt} ms later`,
    )
  })

test('R7: /feedback sends people to the transit feedback sheet (bus has none of its own)', async ({
  request,
}) => {
  const res = await request.get('/feedback', { maxRedirects: 0 })
  expect(res.status()).toBe(302)
  expect(res.headers().location).toMatch(/^https:\/\/[^/]+\/feedback$/)
})
