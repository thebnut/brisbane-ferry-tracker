/**
 * R14-M1: with WebGL (SwiftShader), the Ferry tab map picker asks only for glyphs the basemap serves: the cluster counts first, then
 * the stop names once a pick eases the map to zoom 16. Its own file because launch options force a new worker.
 */
import { expectMapFontsServed, WEBGL_LAUNCH, watchMapRequests } from '@bft/ui/e2e/map-fonts.ts'
import { expect, test } from '@playwright/test'

test.use({ launchOptions: WEBGL_LAUNCH })

test('R14-M1: the Ferry tab map picker asks only for fonts the basemap serves, and nothing 404s', async ({
  page,
}) => {
  const seen = watchMapRequests(page)
  await page.goto('/ferry')
  // The selector opens from Settings (P4: a first visit gets the onboarding prompt).
  await page.getByRole('button', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Select ferry stops' })
  await sheet.getByRole('button', { name: 'Show origin terminals on a map' }).click()
  const picker = sheet.getByRole('region', { name: 'Choose where from map' })
  await picker.getByRole('button', { name: /Terminals in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  // Idle with cluster counts drawn (they are labelled at every zoom below 16).
  await expectMapFontsServed(page, seen, /bft-picker-clusters-count:[1-9]/)
  // Picking a terminal eases the map to zoom 16, where stop names are labelled.
  await picker
    .getByRole('list', { name: 'Choose where from in view' })
    .getByRole('button', { name: /Hawthorne/ })
    .click()
  await expect(picker.getByRole('dialog', { name: 'Hawthorne' })).toBeVisible()
  // Idle again at zoom 16 or more with stop names drawn.
  await expectMapFontsServed(page, seen, /^z(1[6-9]|2\d) .*bft-stops:[1-9]/)
})
