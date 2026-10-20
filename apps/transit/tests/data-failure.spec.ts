/**
 * A failed /data read (R2 slow: the edge's 503 JSON, or no answer) degrades in place on BrisbaneTransit and never
 * reaches "Something went wrong" (staging 20 Oct: /train/stations went to the error page). Around you says the stops
 * couldn't load (never a false "No stops nearby"), "Use a stop" and the onboarding picker say so too, and each
 * Try again brings the data back.
 */
import { DATA_FAILURES, expectNoErrorPage, failData, pageErrors } from '@bft/ui/e2e/data-failure.ts'
import { expectPrompt, expectUnobscured, FIRST_VISIT, prompt } from '@bft/ui/e2e/onboarding.ts'
import { expect, test } from '@playwright/test'

for (const how of DATA_FAILURES) {
  test.describe(`/data ${how}`, () => {
    test('Train tab /stations: no error page, the map opens, Try again loads the list', async ({
      page,
      context,
    }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/train/stations')
      await page.getByRole('button', { name: 'Show stations on a map' }).click()
      const picker = page.getByLabel('Train stations map', { exact: true })
      await expect(picker.getByRole('button', { name: /Stations in view \([1-9]\d*\)/ })).toBeVisible({
        timeout: 20_000,
      })
      await expectNoErrorPage(page)
      // The search keeps the stations bundled with the app, and says the list didn't load (phones: under the map).
      await picker.getByRole('button', { name: 'Close the station map' }).click()
      const notice = page.getByRole('status').filter({ hasText: "Couldn't load the station list" })
      await expect(notice).toBeVisible()
      restore()
      await notice.getByRole('button', { name: 'Try again' }).click()
      await expect(notice).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test(`Train tab /stations: Try again shows in the open map sheet and clears both notices`, async ({
      page,
      context,
    }, testInfo) => {
      // Phones at 390 px, where the sheet covers the page's notice (staging 21 Oct).
      if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/train/stations')
      const notices = page.getByRole('status').filter({ hasText: "Couldn't load the station list" })
      await expect(notices.first()).toBeVisible({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Show stations on a map' }).click()
      const picker = page.getByLabel('Train stations map', { exact: true })
      const inSheet = picker.getByRole('status').filter({ hasText: "Couldn't load the station list" })
      const retry = inSheet.getByRole('button', { name: 'Try again' })
      await expectUnobscured(retry)
      // A station's card opens above the map's bottom edge too: the notice moves up, never under it (Codex review).
      await picker.getByRole('button', { name: /Stations in view/ }).click()
      await picker.getByRole('list', { name: 'Train stations in view' }).getByRole('button').first().click()
      const card = picker.locator('[data-stop-card]')
      await expect(card).toBeVisible()
      await expectUnobscured(retry)
      await expectUnobscured(card.getByRole('button', { name: /^Close / }))

      restore()
      await retry.click()
      await expect(inSheet).toHaveCount(0)
      await expect(notices).toHaveCount(0)
      await picker.getByRole('button', { name: 'Close the station map' }).click()
      await expect(notices).toHaveCount(0)
      await expectNoErrorPage(page)
      expect(errors).toEqual([])
    })

    test('Around you: "Couldn\'t load nearby stops", never "No stops nearby"; Try again lists them', async ({
      page,
      context,
    }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/nearby?lat=-27.4732&lon=153.0195')
      const alert = page.getByRole('alert').filter({ hasText: "Couldn't load nearby stops" })
      await expect(alert).toBeVisible({ timeout: 20_000 })
      await expect(page.getByText('No stops nearby')).toHaveCount(0)
      await expectNoErrorPage(page)
      restore()
      await alert.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByRole('heading', { name: 'Bus', exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(alert).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test('"Use a stop": says the stops failed, Try again finds the station', async ({ page, context }) => {
      const errors = pageErrors(page)
      const { restore } = await failData(context, how)
      await page.goto('/nearby')
      await page.getByRole('button', { name: 'Use a stop' }).click()
      await page.getByRole('searchbox', { name: 'Stop, station or terminal' }).fill('central')
      const notice = page.getByRole('status').filter({ hasText: "Couldn't load every stop" })
      await expect(notice).toBeVisible({ timeout: 20_000 })
      await expectNoErrorPage(page)
      restore()
      await notice.getByRole('button', { name: 'Try again' }).click()
      await expect(page.getByRole('button', { name: /^Central/ }).first()).toBeVisible({ timeout: 20_000 })
      await expect(notice).toHaveCount(0)
      expect(errors).toEqual([])
    })

    test.describe(() => {
      test.use({ storageState: FIRST_VISIT })
      test('onboarding picker (bus): map and name search say stops failed; Try again loads them', async ({
        page,
        context,
      }) => {
        const errors = pageErrors(page)
        await context.grantPermissions(['geolocation'])
        await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
        const { restore } = await failData(context, how)
        await page.goto('/')
        await expectPrompt(page)
        await prompt(page).getByRole('button', { name: 'Yes' }).click()
        const picker = page.getByRole('dialog', { name: 'Set up your favourite stops' })
        const notice = picker.getByRole('status').filter({ hasText: "Couldn't load stops" })
        await expect(notice.first()).toBeVisible({ timeout: 20_000 })
        const tray = picker.getByRole('complementary', { name: 'Your favourite stops' })
        await tray.getByLabel('Find a stop by name').fill('cultural centre')
        const searchNotice = tray.getByRole('status').filter({ hasText: "Couldn't load stops" })
        await expect(searchNotice).toBeVisible({ timeout: 20_000 })
        await expect(tray.getByText('No stops match.')).toHaveCount(0)
        await expectNoErrorPage(page)
        restore()
        await searchNotice.getByRole('button', { name: 'Try again' }).click()
        await expect(tray.getByRole('button', { name: /Cultural Centre/ }).first()).toBeVisible({
          timeout: 20_000,
        })
        await notice.first().getByRole('button', { name: 'Try again' }).click()
        await expect(picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })).toBeVisible({
          timeout: 20_000,
        })
        expect(errors).toEqual([])
      })
    })
  })
}
