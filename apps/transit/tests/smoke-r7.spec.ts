/**
 * Regression tests for Dev's smoke test round 7 (19 Oct 2026).
 * T1: the transit home page (saved stops from every mode), reloaded while offline, must behave like the mode boards:
 * no LIVE before its own network answer, the offline banner at once, held for over a minute.
 * T2: offline, a Mode Tab (or a page whose data needs the network) must never show the error boundary, and must load
 * by itself once the network is back.
 */
import { goOffline, visibleLiveClaims, waitForServiceWorker } from '@bft/ui/e2e/offline.ts'
import { offlineHoldSuite } from '@bft/ui/e2e/offline-hold.ts'
import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

/** A ferry pair, a train station and a bus stop saved on this device (each app's own storage). */
export const saveAcrossModes = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    )
  })

offlineHoldSuite({
  label: 'transit home, saved across modes',
  path: '/',
  rows: '[data-saved-time]',
  pagesCache: 'transit-pages',
  departures: /\/v1\/(ferry|train|bus)\/stops\/[^/]+\/departures/,
  pin: (context) => pinUpcoming(context),
  prepare: saveAcrossModes,
  lieFi: true,
  // The page itself takes up to the service worker's 4 s network timeout to come from its copy.
  bannerWithinMs: 8_000,
})

test.describe('R7-T2: a tab opened offline never hits the error boundary, and loads once back online', () => {
  for (const tab of ['Ferry', 'Train', 'Bus'] as const)
    test(`the ${tab} tab`, async ({ page, context }) => {
      test.slow()
      await saveAcrossModes(page)
      await page.goto('/')
      await waitForServiceWorker(page, 'transit-pages')
      const goOnline = await goOffline(context)
      await page.getByRole('link', { name: tab, exact: true }).first().click()
      await expect(page).toHaveURL(new RegExp(`/${tab.toLowerCase()}$`))
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible()
      await page.waitForTimeout(1_500)
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
      expect(await visibleLiveClaims(page)).toEqual([])

      await goOnline()
      // No reload: the reconnect brings the screen back (the banner clears with its first network answer).
      await expect(page.locator('[data-offline-route]')).toHaveCount(0, { timeout: 3_000 })
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 3_000 })
      await expect(page.getByText('Something went wrong')).toHaveCount(0)
    })

  test('a saved card opened offline (a page whose data needs the network) says so, then loads when back', async ({
    page,
    context,
  }) => {
    test.slow()
    await saveAcrossModes(page)
    await page.goto('/')
    await waitForServiceWorker(page, 'transit-pages')
    await expect(page.locator('[data-saved-time]').first()).toBeVisible()
    const goOnline = await goOffline(context)
    await page.locator('a[href="/train/station/central"]').first().click()
    await expect(page).toHaveURL(/\/train\/station\/central$/)
    await expect(page.locator('[data-offline-route]')).toBeVisible()
    await expect(page.getByText('Something went wrong')).toHaveCount(0)
    expect(await visibleLiveClaims(page)).toEqual([])

    await goOnline()
    await expect(page.locator('[data-offline-route]')).toHaveCount(0, { timeout: 3_000 })
    await expect(page.locator('[data-testid=departure]').first()).toBeVisible({
      timeout: 5_000,
    })
  })
})
