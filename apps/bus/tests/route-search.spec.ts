/**
 * P2: route search and the route stop picker. Type a route number → Routes group above Stops → the route's stop
 * picker → a stop → that stop's departures for the route. `BASE` is "" here; the transit app runs the same flow
 * under /bus (apps/transit/tests/route-search.spec.ts).
 */
import { expect, type Page, test } from '@playwright/test'

const field = (page: Page, isMobile: boolean) =>
  page.locator(isMobile ? '#stop-search' : '#stop-search-desktop')

test('type "333" → Routes → pick a stop → departures for that route', async ({ page, isMobile }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await field(page, isMobile).fill('333')
  const routes = page.getByRole('list', { name: 'Matching routes' }).locator('visible=true')
  await expect(routes.getByRole('link').first()).toContainText('Route 333')
  await expect(routes.getByRole('link').first()).toContainText('Chermside - Woolloongabba via City')
  // Routes above Stops for a route number.
  const group = page.locator('[data-route-results]').locator('visible=true')
  expect(
    await group.evaluate((el) => {
      const stops = el.parentElement?.querySelector('ul[aria-label="Matching stops"]')
      return !!stops && !!(el.compareDocumentPosition(stops) & Node.DOCUMENT_POSITION_FOLLOWING)
    }),
  ).toBe(true)

  await routes.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/route\/333\?pick=1$/)
  const heading = page.getByRole('heading', { name: /Choose your stop towards/ })
  await expect(heading).toBeFocused()
  const list = page.getByRole('list').filter({ has: page.getByRole('link', { name: /Cultural Centre/ }) })
  const stop = list.getByRole('link', { name: /Cultural Centre station/ }).first()
  await expect(stop).toHaveAttribute('href', /^\/stop\/\d+\?route=333$/)
  await stop.click()
  await expect(page).toHaveURL(/\/stop\/\d+\?route=333$/)
  const rows = page.getByTestId('departure')
  await expect(rows.first()).toBeVisible()
  const pill = page
    .getByRole('group', { name: 'Filter by route' })
    .getByRole('button', { name: '333', exact: true })
  // The fixture day runs 333 from both Cultural Centre platforms; the board starts filtered to it.
  await expect(pill).toHaveAttribute('aria-pressed', 'true')
  // Pressing the selected route again keeps the filter.
  await pill.click()
  await expect(page).toHaveURL(/\/stop\/\d+\?route=333$/)
  await expect(pill).toHaveAttribute('aria-pressed', 'true')
  for (const t of await rows.allTextContents()) expect(t).toMatch(/^Route 333(?![0-9])/)
  expect(errors).toEqual([])
})

test('a place name finds routes below the stops; keyboard reaches them', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard path is desktop')
  await page.goto('/')
  await field(page, false).fill('Chermside')
  const link = page.getByRole('list', { name: 'Matching routes' }).locator('visible=true').getByRole('link')
  await expect(link).toHaveCount(1)
  await expect(link).toContainText('Route 333')
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/route\/333\?pick=1$/)
})

for (const how of ['an error', 'no network'] as const) {
  test(`stop search still works when the route data gets ${how}, and the app stays online`, async ({
    page,
    isMobile,
  }) => {
    await page.route(/\/data\/bus\/(routes|lines)\.json$/, (r) =>
      how === 'an error' ? r.fulfill({ status: 500, body: 'no' }) : r.abort('internetdisconnected'),
    )
    await page.goto('/')
    await expect(page.getByRole('banner').getByText('LIVE')).toBeVisible()
    await field(page, isMobile).fill('333')
    await field(page, isMobile).fill('Chermside')
    await field(page, isMobile).fill('010802')
    await expect(
      page
        .getByRole('list', { name: 'Matching stops' })
        .locator('visible=true')
        .getByText('Cultural Centre')
        .first(),
    ).toBeVisible()
    await expect(page.getByRole('list', { name: 'Matching routes' })).toHaveCount(0)
    // Optional data: its failure never marks the app offline (LIVE stays).
    await expect(page.getByRole('banner').getByText('LIVE')).toBeVisible()
  })
}

test('picker highlights the nearest stop only when location is already allowed, and saves a stop', async ({
  page,
  context,
}) => {
  await page.goto('/route/333?pick=1')
  await expect(page.locator('[data-nearest]')).toHaveCount(0)
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: -27.4735, longitude: 153.0198 })
  await page.reload()
  await expect(page.locator('[data-nearest]')).toContainText('Cultural Centre')
  await expect(page.locator('[data-nearest]')).toContainText('Nearest to you')
  const star = page.locator('[data-nearest]').getByRole('button', { name: /to My Transit/ })
  await star.click()
  await expect(star).toHaveAttribute('aria-pressed', 'true')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]'))
  expect(saved).toEqual([expect.objectContaining({ name: expect.stringMatching(/^Cultural Centre/) })])
})
