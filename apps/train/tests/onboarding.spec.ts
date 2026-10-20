/**
 * P4: first-visit onboarding in BrisbaneTrain, from a real first visit (no storage state; the other specs start with
 * the prompt answered). Once per device, when there are no favourites; Save adds each station as a favourite with no
 * destination (`bft-train-favourites`, format unchanged).
 */
import { disableWebGL } from '@bft/ui/e2e/no-webgl.ts'
import { expectNoPrompt, expectPrompt, FIRST_VISIT, prompt } from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const picker = (page: Page) => page.getByRole('dialog', { name: 'Set up your favourite stops' })
const tray = (page: Page) => picker(page).getByRole('complementary', { name: 'Your favourite stops' })
const favourites = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'))

async function addByName(page: Page, query: string, name: RegExp) {
  await tray(page).getByLabel('Find a station by name').fill(query)
  await tray(page).getByRole('button', { name }).first().click({ timeout: 20_000 })
}

test('first visit → Yes → pick stations → reorder → Save → favourites on the home page', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await addByName(page, 'central', /^Central/)
  await addByName(page, 'roma', /^Roma Street/)
  await tray(page).getByRole('button', { name: 'Move Roma Street up' }).click()
  await tray(page).getByRole('button', { name: 'Save 2 stops' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await favourites(page)).toEqual([
    { from: 'roma-street', to: null },
    { from: 'central', to: null },
  ])
  await expect(page.getByTestId('favourite')).toHaveCount(2, { timeout: 15_000 })
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('"Not now" is final', async ({ page }) => {
  await page.goto('/stations')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Not now' }).click()
  await page.reload()
  await expectNoPrompt(page)
})

test('no prompt once a favourite is saved', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }])),
  )
  await page.goto('/')
  await expectNoPrompt(page)
})

test('without WebGL: Map unavailable, and the stations-in-view list fills the tray and saves', async ({
  page,
}) => {
  await disableWebGL(page)
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page).getByText('Map unavailable on this device')).toBeVisible()
  await picker(page)
    .getByRole('button', { name: /Stations in view \([1-9]\d*\)/ })
    .click({ timeout: 20_000 })
  await picker(page).getByRole('list', { name: 'Train stations in view' }).getByRole('button').first().click()
  await tray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await favourites(page)).toHaveLength(1)
})
