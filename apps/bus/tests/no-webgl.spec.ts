/**
 * R13-R1 (smoke round 13): without WebGL, MapLibre can't start. The route page used to go to "Something went wrong"
 * and lose its stop list; now the map shows a "Map unavailable" panel and the rest of the page renders.
 */
import { disableWebGL, expectMapUnavailable, watchMapFailures } from '@bft/ui/e2e/no-webgl.ts'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => disableWebGL(page))

for (const path of ['/route/333', '/route/333?pick=1']) {
  test(`${path}: the stop list renders with the map unavailable panel`, async ({ page }) => {
    const seen = watchMapFailures(page)
    await page.goto(path)
    await expect(page.getByRole('heading', { name: /(Choose your stop|Stops) towards/ })).toBeVisible()
    await expect(
      page
        .getByRole('region', { name: /towards/ })
        .getByRole('link', { name: /Cultural Centre/ })
        .first(),
    ).toBeVisible()
    await expectMapUnavailable(page)
    expect(seen.errors).toEqual([])
    expect(seen.mapChunks).toEqual([])
    expect(seen.warnings).toHaveLength(1)
  })
}

test('/map: the panel links to the list and search instead', async ({ page }) => {
  const seen = watchMapFailures(page)
  await page.goto('/map?lat=-27.4732&lon=153.0195')
  await expectMapUnavailable(page)
  await expect(page.getByRole('link', { name: 'Stops near you' })).toHaveAttribute('href', '/nearby')
  await expect(page.getByRole('link', { name: 'Search stops' })).toHaveAttribute('href', '/')
  expect(seen.errors).toEqual([])
  expect(seen.mapChunks).toEqual([])
})
