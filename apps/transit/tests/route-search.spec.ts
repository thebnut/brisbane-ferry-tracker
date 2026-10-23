/**
 * P2 on the Bus tab: the bus route modules mounted under /bus. Type "333" → Routes → the route's stop picker → a stop
 * → that stop's departures for the route, with every link on the way carrying the /bus prefix.
 */
import { expect, test } from '@playwright/test'

test('Bus tab: type "333" → Routes → pick a stop → departures for that route', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/bus')
  // The search at the top of the Bus tab at every width (THE-118 PR 3: no thumb-height sheet on phones).
  await page.locator('#stop-search-desktop').fill('333')
  const route = page
    .getByRole('list', { name: 'Matching routes' })
    .locator('visible=true')
    .getByRole('link')
    .first()
  await expect(route).toContainText('Chermside - Woolloongabba via City')
  await expect(route).toHaveAttribute('href', '/bus/route/333?pick=1')
  await route.click()
  await expect(page).toHaveURL(/\/bus\/route\/333\?pick=1$/)
  await expect(page.getByRole('heading', { name: /Choose your stop towards/ })).toBeFocused()
  const stop = page.getByRole('link', { name: /Cultural Centre station/ }).first()
  await expect(stop).toHaveAttribute('href', /^\/bus\/stop\/\d+\?route=333$/)
  await stop.click()
  await expect(page).toHaveURL(/\/bus\/stop\/\d+\?route=333$/)
  await expect(
    page.getByRole('group', { name: 'Filter by route' }).getByRole('button', { name: '333', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  const rows = page.getByTestId('departure')
  await expect(rows.first()).toBeVisible()
  for (const t of await rows.allTextContents()) expect(t).toMatch(/^Route 333(?![0-9])/)
  // "All routes" goes back to the whole board, still under /bus.
  await page
    .getByRole('group', { name: 'Filter by route' })
    .getByRole('button', { name: 'All routes' })
    .click()
  await expect(page).toHaveURL(/\/bus\/stop\/\d+$/)
  expect(errors).toEqual([])
})
