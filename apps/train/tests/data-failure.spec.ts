/**
 * A failed station index read (data/train/stops.json; R2 slow: the edge's 503 JSON, or no answer) never takes
 * /stations to "Something went wrong": the search keeps working on the stations bundled with the app, a line says
 * the list didn't load with a Try again, and the map picker opens as usual.
 */
import { DATA_FAILURES, expectNoErrorPage, failData, pageErrors } from '@bft/ui/e2e/data-failure.ts'
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
}
