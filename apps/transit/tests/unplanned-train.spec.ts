/**
 * R35-U1, an unplanned train (smoke round 35): a Shorncliffe line service added outside the timetable (GTFS-RT ADDED)
 * with no headsign. The train fixture runs one whatever the time of day, leaving Central from platform 5 for Roma Street
 * 2–12 minutes from now (apps/train/app/lib/fixtures.server.ts, UNPLANNED_TRIP).
 *  - the board row names it after its last stop and shows its platform, and says "Extra service", never on time;
 *  - its trip (the full page on a phone, the panel beside the board on desktop) has a destination in the summary and
 *    the Journey tile, live times along "Your trip", and no "min late", "min early" or "on time" anywhere.
 * Nothing here depends on the time of day: no countdown or clock wording is asserted.
 */
import { expect, type Locator, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

const NO_DELAY_CLAIM = /min late|min early|on time/i

async function openCentral(page: Page): Promise<Locator> {
  await page.goto('/train/station/central')
  await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
  const row = page
    .locator('[data-board=central] [data-testid=departure]')
    .filter({ has: page.locator('a[href*="FX-UNPLANNED"]') })
  await expect(row).toHaveCount(1)
  return row
}

async function expectBoardRow(row: Locator) {
  await expect(row.getByTestId('destination')).toHaveText('Roma Street')
  await expect(row.getByRole('img', { name: 'Platform 5' })).toBeVisible()
  const status = row.locator('[data-row-status]')
  await expect(status.locator('[data-dot=live]')).toHaveCount(1)
  await expect(status).toContainText('Live · Extra service')
  await expect(status).not.toContainText(NO_DELAY_CLAIM)
}

/** The trip, wherever it is shown: a destination, live times and no delay claim. */
async function expectTrip(scope: Locator) {
  const summary = scope.locator('[data-trip-summary]')
  await expect(summary.locator('#trip-title')).toHaveText('To Roma Street')
  await expect(summary.locator('[data-trip-status]')).toContainText('Live · Extra service')
  await expect(summary.locator('[data-fact=Departs]')).toContainText('Platform 5')
  await expect(summary.locator('[data-fact=Journey]')).toContainText('to Roma Street')
  const trip = scope.locator('[data-your-trip]')
  await expect(trip).toContainText('Central')
  await expect(trip).toContainText('Roma Street')
  // Live times along the way.
  await expect(trip).toContainText(/\d+:\d\d [ap]m/)
  for (const part of [summary, trip]) await expect(part).not.toContainText(NO_DELAY_CLAIM)
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the board row and the trip page of an unplanned train', async ({ page }) => {
    const row = await openCentral(page)
    await expectBoardRow(row)
    await row.locator('a').first().tap()
    await expect(page).toHaveURL(/\/train\/trip\/rt(%3A|:)FX-UNPLANNED/)
    await expectTrip(page.locator('main'))
  })
})

for (const width of [1280, 1440]) {
  test.describe(`${width}×900`, () => {
    onlyIn('desktop')
    test.use({ viewport: { width, height: 900 } })

    test('the board row and the trip panel of an unplanned train', async ({ page }) => {
      const row = await openCentral(page)
      await expectBoardRow(row)
      await row.locator('a').first().click()
      const panel = page.getByRole('region', { name: 'Trip details' })
      await expect(panel).toBeVisible()
      await expectTrip(panel)
    })
  })
}
