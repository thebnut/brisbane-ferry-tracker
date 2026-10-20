/**
 * P4: first-visit onboarding in BrisbaneBus, from a real first visit (no storage state; the other specs start with
 * the prompt answered). Once per device, when My stops is empty; Yes opens the map picker in multi-select mode, and
 * Save adds the picks to My stops (`bft-bus-saved`, format unchanged).
 */
import { disableWebGL } from '@bft/ui/e2e/no-webgl.ts'
import { expectNoPrompt, expectPrompt, FIRST_VISIT, prompt } from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const picker = (page: Page) => page.getByRole('dialog', { name: 'Set up your favourite stops' })
const tray = (page: Page) => picker(page).getByRole('complementary', { name: 'Your favourite stops' })
const saved = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]') as { id: string; name: string }[],
  )

async function addByName(page: Page, query: string, name: RegExp) {
  await tray(page).getByLabel('Find a stop by name').fill(query)
  await tray(page).getByRole('button', { name }).first().click({ timeout: 20_000 })
}

test('first visit (the old home, then the prompt) → Yes → pick 3 stops → Save → My stops', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Live departures for every Brisbane bus stop' }),
  ).toBeVisible()
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page)).toBeVisible()
  await addByName(page, 'cultural centre', /Cultural Centre/)
  await addByName(page, 'king george', /King George Square/)
  // A stop from the map's keyboard list too (the stops in view load from the geo tiles).
  await picker(page)
    .getByRole('button', { name: /Stops in view \([1-9]\d*\)/ })
    .click({ timeout: 20_000 })
  const rows = picker(page).getByRole('list', { name: 'Bus stops in view' }).getByRole('button')
  const unpicked = rows.and(page.locator('[aria-pressed=false]')).first()
  await unpicked.click()
  await expect(tray(page).locator('[data-tray-items] > li')).toHaveCount(3)
  await tray(page).getByRole('button', { name: 'Save 3 stops' }).click()
  await expect(page).toHaveURL(/\/$/)
  const list = await saved(page)
  expect(list).toHaveLength(3)
  for (const s of list) expect(Object.keys(s).sort()).toEqual(['id', 'name'])
  await expect(
    page.locator(`main a[href="/stop/${list[0]?.id}"]`).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 15_000 })
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('"Not now" is final, on every page', async ({ page }) => {
  await page.goto('/nearby')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Not now' }).click()
  await page.goto('/')
  await expectNoPrompt(page)
})

test('no prompt once a stop is saved', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('bft-bus-saved', JSON.stringify([{ id: '10802', name: 'Cultural Centre' }])),
  )
  await page.goto('/')
  await expectNoPrompt(page)
})

test('without WebGL: Map unavailable, and the search still fills the tray and saves', async ({ page }) => {
  await disableWebGL(page)
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page).getByText('Map unavailable on this device')).toBeVisible()
  await addByName(page, 'cultural centre', /Cultural Centre/)
  await tray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await saved(page)).toHaveLength(1)
})
