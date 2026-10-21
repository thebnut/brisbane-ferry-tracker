/**
 * THE-113: "Set up My Transit stops" in Settings re-opens the onboarding picker whenever wanted, with My stops already
 * in the tray. Save makes My stops match the tray (`bft-bus-saved`, format unchanged); Cancel changes nothing; the
 * first-visit prompt never comes back.
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

const saved = (page: Page) =>
  page.evaluate(
    () => JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]') as { id: string; name: string }[],
  )

async function addByName(tray: ReturnType<typeof rerunTray>, query: string, name: RegExp) {
  await tray.getByLabel('Find a stop by name').fill(query)
  await tray
    .getByRole('list', { name: /matching/ })
    .getByRole('button', { name })
    .first()
    .click({ timeout: 20_000 })
}

test('fresh device: onboarding, then Settings re-runs it with My stops in the tray; add one, remove one, Save', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  const first = page.getByRole('dialog', { name: 'Set up your favourite stops' })
  await addByName(first.getByRole('complementary'), 'cultural centre', /Cultural Centre/)
  await first.getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  const [cultural] = await saved(page)
  expect(cultural).toBeTruthy()

  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText([cultural?.name ?? ''])
  await addByName(rerunTray(page), 'king george', /King George Square/)
  await rerunTray(page)
    .getByRole('button', { name: `Remove ${cultural?.name}` })
    .click()
  await expect(rerunTrayNames(page)).toHaveText([/King George Square/])
  await rerunTray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  const after = await saved(page)
  expect(after.map((s) => s.name)).toEqual([expect.stringMatching(/King George Square/)])
  for (const s of after) expect(Object.keys(s).sort()).toEqual(['id', 'name'])
  await expect(
    page.locator(`main a[href="/stop/${after[0]?.id}"]`).filter({ visible: true }).first(),
  ).toBeVisible({
    timeout: 15_000,
  })
  // The tray shows the new list next time.
  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText([/King George Square/])
  await cancelRerun(page)
  await page.reload()
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('Cancel changes nothing, and the first-visit prompt never comes back', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('bft-onboarding', '1')
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([
        { id: '10802', name: 'Cultural Centre' },
        { id: '1832', name: 'King George Square' },
      ]),
    )
  })
  await page.goto('/nearby')
  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['Cultural Centre', 'King George Square'])
  await rerunTray(page).getByRole('button', { name: 'Remove Cultural Centre' }).click()
  await cancelRerun(page)
  expect((await saved(page)).map((s) => s.id)).toEqual(['10802', '1832'])
  // Escape from the tray is a cancel too.
  await openRerun(page)
  await rerunTray(page).getByRole('button', { name: 'Remove King George Square' }).click()
  await rerunTray(page).getByLabel('Find a stop by name').press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect((await saved(page)).map((s) => s.id)).toEqual(['10802', '1832'])
  // Emptying it and saving unsaves every stop; the prompt still never returns.
  await openRerun(page)
  await rerunTray(page).getByRole('button', { name: 'Remove Cultural Centre' }).click()
  await rerunTray(page).getByRole('button', { name: 'Remove King George Square' }).click()
  await rerunTray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await saved(page)).toEqual([])
  expect(await page.evaluate(() => localStorage.getItem('bft-onboarding'))).toBe('1')
  await expectNoPrompt(page)
})
