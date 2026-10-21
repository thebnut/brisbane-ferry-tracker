/**
 * THE-113: "Set up My Transit stops" in Settings re-opens the onboarding picker whenever wanted, with every mode's
 * saved stops already in the tray. In BrisbaneTransit every Settings has it (My Transit's, and each mode tab's own,
 * which opens this app's picker with all three modes); one Save makes each mode's store match the tray; Cancel
 * changes nothing; the first-visit prompt never comes back.
 */
import {
  cancelRerun,
  expectNoPrompt,
  expectPrompt,
  FIRST_VISIT,
  openRerun,
  prompt,
  rerunPicker,
  rerunTray,
  rerunTrayNames,
} from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const stores = (page: Page) =>
  page.evaluate(() => ({
    bus: JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]') as { id: string; name: string }[],
    train: JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'),
    ferry: JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? 'null'),
  }))

async function add(tray: ReturnType<typeof rerunTray>, label: string, query: string, name: RegExp) {
  await tray.getByLabel(label).fill(query)
  await tray
    .getByRole('list', { name: /matching/ })
    .getByRole('button', { name })
    .first()
    .click({ timeout: 20_000 })
}

test('fresh device: onboarding, then the Bus tab’s Settings re-runs it for every mode; add one, remove one, Save', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  const first = page.getByRole('dialog', { name: 'Set up your favourite stops' })
  await add(first.getByRole('complementary'), 'Find a stop by name', 'cultural centre', /Cultural Centre/)
  await first.getByRole('button', { name: 'Train', exact: true }).click()
  await add(first.getByRole('complementary'), 'Find a station by name', 'central', /^Central/)
  await first.getByRole('button', { name: /^Save/ }).click()
  await expect(page).toHaveURL(/\/$/)
  const [cultural] = (await stores(page)).bus
  expect(cultural).toBeTruthy()

  // The bus app's own Settings, inside BrisbaneTransit: the picker has every mode, and opens on Bus.
  await page.goto('/bus')
  await openRerun(page)
  await expect(rerunPicker(page).getByRole('button', { name: 'Bus', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(rerunTrayNames(page)).toHaveText(['Central', cultural?.name ?? ''])
  await rerunPicker(page).getByRole('button', { name: 'Train', exact: true }).click()
  await add(rerunTray(page), 'Find a station by name', 'roma', /^Roma Street/)
  await rerunTray(page)
    .getByRole('button', { name: `Remove ${cultural?.name}` })
    .click()
  await rerunTray(page).getByRole('button', { name: 'Save 2 stops' }).click()
  await expect(page).toHaveURL(/\/$/)
  const after = await stores(page)
  expect(after.bus).toEqual([])
  expect(after.train).toEqual([
    { from: 'central', to: null },
    { from: 'roma-street', to: null },
  ])
  expect(after.ferry).toBeNull()
  await expect(page.locator('main a[href="/train/station/roma-street"]').first()).toBeVisible({
    timeout: 15_000,
  })
  await page.reload()
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('My Transit’s Settings and the Ferry tab’s: Cancel changes nothing; the prompt never comes back', async ({
  page,
}) => {
  const seeded = {
    bus: [{ id: '10802', name: 'Cultural Centre' }],
    train: [{ from: 'central', to: null }],
    ferry: { outbound: { id: '317584', name: 'Bulimba' }, inbound: { id: '317590', name: 'Riverside' } },
  }
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('bft-onboarding', '1')
    localStorage.setItem('bft-bus-saved', JSON.stringify(s.bus))
    localStorage.setItem('bft-train-favourites', JSON.stringify(s.train))
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem('brisbane-ferry-selected-stops', JSON.stringify(s.ferry))
  }, seeded)
  await page.goto('/')
  await openRerun(page)
  await expect(rerunTrayNames(page)).toHaveText(['From Bulimba', 'Central', 'Cultural Centre'])
  await rerunTray(page).getByRole('button', { name: 'Remove Central' }).click()
  await cancelRerun(page)
  expect(await stores(page)).toEqual(seeded)

  // The Ferry tab's Settings is its stop selector: the entry is there too, and opens on Ferry.
  await page.goto('/ferry')
  await openRerun(page)
  await expect(rerunPicker(page).getByRole('button', { name: 'Ferry', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await rerunTray(page).getByRole('button', { name: 'Remove Bulimba' }).click()
  await cancelRerun(page)
  expect(await stores(page)).toEqual(seeded)
  await page.reload()
  await expectNoPrompt(page)
})
