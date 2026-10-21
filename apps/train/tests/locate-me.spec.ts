/**
 * THE-112: the live trains map gets the locate-me button: a tap shows where you are and moves the map there; with
 * location blocked it says so on the map. Its own file because launch options (WebGL) force a new worker.
 */
import { allowLocation, expectDeniedOnTap, expectLocatesOnTap } from '@bft/ui/e2e/locate-me.ts'
import { WEBGL_LAUNCH } from '@bft/ui/e2e/map-fonts.ts'
import { test } from '@playwright/test'

test.use({ launchOptions: WEBGL_LAUNCH })

const MAP = /^Map of \d+ live trains/

test('THE-112: the trains map frames you on a tap', async ({ page, context }) => {
  await allowLocation(context)
  await page.goto('/map')
  await expectLocatesOnTap(page.getByRole('region', { name: MAP }))
})

test('THE-112: location blocked: the trains map says so', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/map')
  await expectDeniedOnTap(page.getByRole('region', { name: MAP }))
})
