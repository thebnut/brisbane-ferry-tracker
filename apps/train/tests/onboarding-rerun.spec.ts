/**
 * THE-113: "Set up My Transit stops" in Settings re-opens the onboarding picker whenever wanted, with the station
 * favourites already in the tray. Save makes them match the tray (`bft-train-favourites`, format unchanged; favourite
 * trips with a destination are kept); Cancel changes nothing; the first-visit prompt never comes back.
 */
import {
  cancelRerun,
  expectNoPrompt,
  expectPrompt,
  FIRST_VISIT,
  openRerun,
  prompt,
  rerunTray,
  rerunTrayNames,
} from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const favourites = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'))

async function addStation(tray: ReturnType<typeof rerunTray>, query: string, name: RegExp) {
  await tray.getByLabel('Find a station by name').fill(query)
  await tray
    .getByRole('list', { name: /matching/ })
    .getByRole('button', { name })
    .first()
    .click()
}

test('fresh device: onboarding, then Settings re-runs it with the favourites in the tray; add one, remove one, Save', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  const first = page.getByRole('dialog', { name: 'Set up your favourite stops' }).getByRole('complementary')
  await addStation(first, 'central', /^Central/)
  await addStation(first, 'roma', /^Roma Street/)
  await first.getByRole('button', { name: 'Save 2 stops' }).click()
  await expect(page.getByTestId('favourite')).toHaveCount(2, { timeout: 15_000 })

  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['Central', 'Roma Street'])
  await addStation(rerunTray(page), 'bowen', /^Bowen Hills/)
  await rerunTray(page).getByRole('button', { name: 'Remove Central' }).click()
  await rerunTray(page).getByRole('button', { name: 'Save 2 stops' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await favourites(page)).toEqual([
    { from: 'roma-street', to: null },
    { from: 'bowen-hills', to: null },
  ])
  await expect(page.getByTestId('favourite')).toHaveCount(2, { timeout: 15_000 })
  await page.reload()
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('Cancel changes nothing; a favourite trip stays out of the tray and is kept; the prompt never comes back', async ({
  page,
}) => {
  const seeded = [
    { from: 'central', to: 'roma-street' },
    { from: 'bowen-hills', to: null },
  ]
  await page.addInitScript((list) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('bft-onboarding', '1')
    localStorage.setItem('bft-train-favourites', JSON.stringify(list))
  }, seeded)
  await page.goto('/stations')
  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['Bowen Hills'])
  await rerunTray(page).getByRole('button', { name: 'Remove Bowen Hills' }).click()
  await cancelRerun(page)
  expect(await favourites(page)).toEqual(seeded)
  await openRerun(page)
  await rerunTray(page).getByRole('button', { name: 'Remove Bowen Hills' }).click()
  await rerunTray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await favourites(page)).toEqual([{ from: 'central', to: 'roma-street' }])
  await expectNoPrompt(page)
})
