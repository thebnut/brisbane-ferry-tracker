/** R13-R1: without WebGL the train map shows a "Map unavailable" panel with a link to the stations, not an error page. */
import { disableWebGL, expectMapUnavailable, watchMapFailures } from '@bft/ui/e2e/no-webgl.ts'
import { expect, test } from '@playwright/test'

test('/map without WebGL: panel plus a link to the station list', async ({ page }) => {
  await disableWebGL(page)
  const seen = watchMapFailures(page)
  await page.goto('/map')
  await expectMapUnavailable(page)
  await expect(page.getByRole('link', { name: "See every station's departures" })).toHaveAttribute(
    'href',
    '/stations',
  )
  // The legend's count (the map page shell, THE-118 PR 9).
  await expect(page.getByText(/\d+ with live positions/)).toBeVisible()
  expect(seen.errors).toEqual([])
  expect(seen.mapChunks).toEqual([])
})
