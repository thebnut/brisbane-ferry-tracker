/**
 * A failed station index read (data/train/stops.json; R2 slow: the edge's 503 JSON, or no answer) never takes
 * /stations to "Something went wrong": the search keeps working on the stations bundled with the app, a line says
 * the list didn't load with a Try again, and the map picker opens as usual.
 */
import { DATA_FAILURES, expectNoErrorPage, failData, pageErrors } from '@bft/ui/e2e/data-failure.ts'
import { expectUnobscured } from '@bft/ui/e2e/onboarding.ts'
import { expect, test } from '@playwright/test'

for (const how of DATA_FAILURES) {
  test(`/stations with /data ${how}: search and map still work, Try again loads the list`, async ({
    page,
    context,
  }) => {
    const errors = pageErrors(page)
    const { restore } = await failData(context, how)
    await page.goto('/stations')
    const notice = page.getByRole('status').filter({ hasText: "Couldn't load the station list" })
    await expect(notice).toBeVisible({ timeout: 20_000 })
    await expectNoErrorPage(page)

    await page.getByRole('button', { name: 'Show stations on a map' }).click()
    const picker = page.getByLabel('Train stations map', { exact: true })
    await expect(picker.getByRole('button', { name: /Stations in view \([1-9]\d*\)/ })).toBeVisible({
      timeout: 20_000,
    })
    await picker.getByRole('button', { name: 'Close the station map' }).click()

    await page.getByRole('combobox', { name: 'From' }).fill('bowen hils')
    await page.getByRole('option', { name: 'Bowen Hills' }).click()
    await expect(page).toHaveURL(/from=bowen-hills/)

    restore()
    await notice.getByRole('button', { name: 'Try again' }).click()
    await expect(notice).toHaveCount(0)
    await expectNoErrorPage(page)
    expect(errors).toEqual([])
  })

  test(`/stations with /data ${how}: Try again shows in the open map sheet and clears both notices`, async ({
    page,
    context,
  }, testInfo) => {
    // Phones at 390 px, where the sheet covers the page's notice (staging 21 Oct).
    if (testInfo.project.name === 'phone') await page.setViewportSize({ width: 390, height: 844 })
    const errors = pageErrors(page)
    const { restore } = await failData(context, how)
    await page.goto('/stations')
    const notices = page.getByRole('status').filter({ hasText: "Couldn't load the station list" })
    await expect(notices.first()).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Show stations on a map' }).click()
    const picker = page.getByLabel('Train stations map', { exact: true })
    const inSheet = picker.getByRole('status').filter({ hasText: "Couldn't load the station list" })
    const retry = inSheet.getByRole('button', { name: 'Try again' })
    await expectUnobscured(retry)

    restore()
    await retry.click()
    await expect(inSheet).toHaveCount(0)
    await expect(notices).toHaveCount(0)
    await picker.getByRole('button', { name: 'Close the station map' }).click()
    await expect(notices).toHaveCount(0)
    await expectNoErrorPage(page)
    expect(errors).toEqual([])
  })
}
