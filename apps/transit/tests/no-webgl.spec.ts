/** R13-R1: without WebGL, Around you and the bus route page keep their lists; the maps show "Map unavailable". */
import { disableWebGL, expectMapUnavailable, watchMapFailures } from '@bft/ui/e2e/no-webgl.ts'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => disableWebGL(page))

test('/nearby: stops listed, map panel in its place', async ({ page }) => {
  const seen = watchMapFailures(page)
  await page.goto('/nearby?lat=-27.4717&lon=153.0206')
  await expect(page.locator('[data-nearby-ms]')).toBeVisible()
  await expect(page.locator('main [data-stop]').first()).toBeVisible()
  await expectMapUnavailable(page)
  expect(seen.errors).toEqual([])
  expect(seen.mapChunks).toEqual([])
})

test('/bus/route/333?pick=1: the stop picker renders, map panel in its place', async ({ page }) => {
  const seen = watchMapFailures(page)
  await page.goto('/bus/route/333?pick=1')
  await expect(page.getByRole('heading', { name: /Choose your stop towards/ })).toBeVisible()
  await expectMapUnavailable(page)
  expect(seen.errors).toEqual([])
  expect(seen.mapChunks).toEqual([])
})
