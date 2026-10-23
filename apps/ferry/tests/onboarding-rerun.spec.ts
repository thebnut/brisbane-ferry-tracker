/**
 * THE-113: "Set up My Transit stops" in Settings (the stop selector) re-opens the onboarding picker whenever wanted,
 * with the saved pair already in the tray. Save stores the tray's trip as the pair (or unsaves it when taken out);
 * Cancel changes nothing; the first-visit prompt never comes back.
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

/** Ferry home's headline: its first saved trip (THE-118 PR 8). */
const headline = (page: Page) => page.locator('[data-headline]')
const pair = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? 'null'))

async function addTerminal(tray: ReturnType<typeof rerunTray>, query: string, name: RegExp) {
  await tray.getByLabel('Find a terminal by name').fill(query)
  await tray
    .getByRole('list', { name: /matching/ })
    .getByRole('button', { name })
    .first()
    .click()
}

test('fresh device: onboarding, then Settings re-runs it with the pair in the tray; replace it, Save', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  const first = page.getByRole('dialog', { name: 'Set up your favourite stops' }).getByRole('complementary')
  await first.getByLabel('Find a terminal by name').fill('riverside')
  await first
    .getByRole('list', { name: /matching/ })
    .getByRole('button', { name: /^Riverside/ })
    .click()
  await first.getByRole('combobox', { name: 'To' }).selectOption({ label: 'Bulimba' })
  await first.getByRole('button', { name: 'Save' }).click()
  await expect(headline(page)).toContainText('Riverside → Bulimba')

  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['From Riverside'])
  await expect(rerunTray(page).getByRole('combobox', { name: 'To' })).toHaveValue('317584')
  // Remove the trip, add another one.
  await rerunTray(page).getByRole('button', { name: 'Remove Riverside' }).click()
  await addTerminal(rerunTray(page), 'bulimba', /^Bulimba/)
  await rerunTray(page).getByRole('combobox', { name: 'To' }).selectOption({ label: 'Riverside' })
  await rerunTray(page).getByRole('button', { name: 'Save' }).click()
  await expect(headline(page)).toContainText('Bulimba → Riverside')
  expect(await pair(page)).toEqual({
    outbound: { id: '317584', name: 'Bulimba' },
    inbound: { id: '317590', name: 'Riverside' },
  })
  expect(await (await page.request.get('/')).text()).toContain('Bulimba → Riverside')
  await page.reload()
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('Cancel changes nothing; taking the trip out and saving unsaves the pair; the prompt never comes back', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('bft-onboarding', '1')
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317590', name: 'Riverside' },
        inbound: { id: '317584', name: 'Bulimba' },
      }),
    )
  })
  await page.goto('/')
  await expect(headline(page)).toContainText('Riverside → Bulimba')
  await openRerun(page)
  await rerunTray(page).getByRole('button', { name: 'Remove Riverside' }).click()
  await cancelRerun(page)
  expect((await pair(page))?.outbound.id).toBe('317590')
  await openRerun(page)
  await rerunTray(page).getByRole('button', { name: 'Remove Riverside' }).click()
  await rerunTray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Tap ☆ on any board to save it.')).toBeVisible()
  await expect(headline(page)).toHaveCount(0)
  expect(await pair(page)).toBeNull()
  await expectNoPrompt(page)
})
