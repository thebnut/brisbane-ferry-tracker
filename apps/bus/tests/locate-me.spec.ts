/**
 * THE-112: the route map (framed on the route) shows where you are once location is allowed, but moves there only on
 * a tap of its locate-me button; with location blocked the button says so on the map. Its own file because launch
 * options (WebGL) force a new worker.
 */
import {
  allowLocation,
  expectDeniedOnTap,
  expectLocatesOnTap,
  offCentre,
  youAreHere,
} from '@bft/ui/e2e/locate-me.ts'
import { WEBGL_LAUNCH } from '@bft/ui/e2e/map-fonts.ts'
import { expect, test } from '@playwright/test'

test.use({ launchOptions: WEBGL_LAUNCH })

const routeMap = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: /Map of route stops/ })

test('THE-112: the route map shows you without moving, and frames you on a tap', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await allowLocation(context)
  await page.goto('/route/M2')
  const map = routeMap(page)
  // Already allowed: the dot shows straight away, but the map stays framed on the route.
  await expect(youAreHere(map)).toBeAttached({ timeout: 20_000 })
  expect(await offCentre(map)).toBeGreaterThan(40)
  await expectLocatesOnTap(map)
  expect(errors).toEqual([])
})

test('THE-112: location blocked: the route map says so', async ({ page, context }) => {
  await context.clearPermissions()
  await page.goto('/route/M2')
  await expectDeniedOnTap(routeMap(page))
})
