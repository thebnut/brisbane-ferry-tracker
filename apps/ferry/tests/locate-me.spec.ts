/**
 * THE-112: the live ferry map gets the locate-me button: a tap shows where you are and moves the map there; with
 * location blocked it says so on the map. Its own file because launch options (WebGL) force a new worker.
 */
import {
  allowLocation,
  expectDeniedOnTap,
  expectLocatesOnTap,
  expectSolidHover,
} from '@bft/ui/e2e/locate-me.ts'
import { WEBGL_LAUNCH } from '@bft/ui/e2e/map-fonts.ts'
import { type Page, test } from '@playwright/test'

test.use({ launchOptions: WEBGL_LAUNCH })

async function openLiveMap(page: Page) {
  // The board's Map chip opens the live ferry map page on that terminal (THE-118 PR 9).
  await page.goto('/terminal/bulimba?to=riverside')
  await page.getByRole('link', { name: 'Map', exact: true }).click()
  await page.waitForURL(/\/map\?terminal=bulimba$/)
  return page.getByRole('region', { name: /^Map of \d+ live ferr/ })
}

test('THE-112: the live map frames you on a tap', async ({ page, context }) => {
  await allowLocation(context)
  await expectLocatesOnTap(await openLiveMap(page))
})

test('THE-112: the button stays solid on hover, light and dark', async ({ page }) => {
  await expectSolidHover(await openLiveMap(page))
})

test('THE-112: location blocked: the live map says so', async ({ page, context }) => {
  await context.clearPermissions()
  await expectDeniedOnTap(await openLiveMap(page))
})
