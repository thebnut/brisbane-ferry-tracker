/**
 * A failed /data read (R2 slow: the edge's 503, or a request that never completes) degrades in place: the stop
 * search, the map picker, /map and /nearby say "Couldn't load" with a Try again that brings the data back, and the
 * page never goes to "Something went wrong".
 */
import { busOnboardingRetryTests, busSearchRetryTests } from '@bft/ui/e2e/bus-search-retry.ts'
import { DATA_FAILURES, expectNoErrorPage, failData, pageErrors } from '@bft/ui/e2e/data-failure.ts'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
})

for (const how of DATA_FAILURES) {
  test.describe(`/data ${how}`, () => {
    test('stop search: says the list failed, Try again finds the stop', async ({ page, context }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/')
      await page
        .getByRole('searchbox', { name: /Stop name or number|Find a stop/ })
        .locator('visible=true')
        .fill('cultural')
      const status = page
        .getByRole('status')
        .filter({ hasText: "Couldn't load the stop list" })
        .locator('visible=true')
      await expect(status).toBeVisible({ timeout: 20_000 })
      await expectNoErrorPage(page)
      restore()
      await status.getByRole('button', { name: 'Try again' }).click()
      await expect(
        page
          .getByRole('list', { name: 'Matching stops' })
          .locator('visible=true')
          .getByText(/Cultural Centre/)
          .first(),
      ).toBeVisible({ timeout: 20_000 })
      expect(errors).toEqual([])
    })

    test('route search: says routes failed, Try again finds the route', async ({ page, context }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/')
      await page
        .getByRole('searchbox', { name: /Stop name or number|Find a stop/ })
        .locator('visible=true')
        .fill('333')
      const status = page
        .getByRole('status')
        .filter({ hasText: "Couldn't load routes" })
        .locator('visible=true')
      await expect(status).toBeVisible({ timeout: 20_000 })
      await expectNoErrorPage(page)
      restore()
      await status.getByRole('button', { name: 'Try again' }).click()
      await expect(
        page.getByRole('list', { name: 'Matching routes' }).locator('visible=true').getByRole('link').first(),
      ).toBeVisible({ timeout: 20_000 })
      await expect(status).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('alerts, My stops: says route alerts may be missing, never "No alerts"; Try again', async ({
      page,
      context,
    }) => {
      const errors = pageErrors(page)
      await page.addInitScript(() =>
        localStorage.setItem(
          'bft-bus-saved',
          JSON.stringify([{ id: '10802', name: 'Cultural Centre, platform 1' }]),
        ),
      )
      const { restore } = await failData(context, how)
      await page.goto('/alerts')
      const status = page.getByRole('status').filter({ hasText: "Couldn't load your stops' routes" })
      await expect(status).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('No alerts for your saved stops.')).toHaveCount(0)
      await expectNoErrorPage(page)
      // Try again while the index is still loading: never "No alerts" meanwhile.
      let release = () => {}
      const held = new Promise<void>((r) => (release = r))
      await context.route(/\/data\/bus\/stops\.json/, async (route) => {
        await held
        await route.continue()
      })
      restore()
      await status.getByRole('button', { name: 'Try again' }).click()
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: /Loading alerts…|Couldn't check|Couldn't load your stops/ })
          .first(),
      ).toBeVisible()
      await page.waitForTimeout(300)
      await expect(page.getByText('No alerts for your saved stops.')).toHaveCount(0)
      release()
      await expect(page.getByText(/Showing alerts for your 1 saved stop and [1-9]\d* route/)).toBeVisible({
        timeout: 20_000,
      })
      await expect(status).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('map picker: "Couldn\'t load stops" over the map, Try again shows them', async ({
      page,
      context,
    }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/')
      await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
      const picker = page.getByLabel('Bus stops map', { exact: true })
      const notice = picker.getByRole('status').filter({ hasText: "Couldn't load stops" })
      await expect(notice).toBeVisible({ timeout: 20_000 })
      await expect(picker.getByRole('button', { name: 'Stops in view (0)' })).toBeVisible()
      await expectNoErrorPage(page)
      restore()
      await notice.getByRole('button', { name: 'Try again' }).click()
      await expect(picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })).toBeVisible({
        timeout: 20_000,
      })
      await expect(notice).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('/map: says stops failed, Try again draws them', async ({ page, context }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/map')
      const notice = page.getByRole('status').filter({ hasText: "Couldn't load stops" })
      await expect(notice).toBeVisible({ timeout: 20_000 })
      await expectNoErrorPage(page)
      restore()
      await notice.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByLabel(/^Map of [1-9]\d* bus stops$/)).toBeVisible({ timeout: 20_000 })
      await expect(notice).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('/nearby: "Couldn\'t load nearby stops", never "No bus stops"; Try again lists them', async ({
      page,
      context,
    }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/nearby')
      await page
        .getByRole('button', { name: 'Use my location' })
        .click({ timeout: 3_000 })
        .catch(() => {})
      const alert = page.getByRole('alert').filter({ hasText: "Couldn't load nearby stops" })
      await expect(alert).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('No bus stops within 2 km')).toHaveCount(0)
      await expectNoErrorPage(page)
      restore()
      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect(
        page
          .getByRole('list', { name: 'Nearby stops' })
          .getByText(/Cultural Centre/)
          .first(),
      ).toBeVisible({
        timeout: 20_000,
      })
      expect(errors).toEqual([])
    })
  })
}

busSearchRetryTests('')
busOnboardingRetryTests()
