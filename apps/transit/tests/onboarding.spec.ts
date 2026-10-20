/**
 * P4: first-visit onboarding in BrisbaneTransit, from a real first visit (no storage state; the other specs start
 * with the prompt answered). The prompt comes up once, after an idle moment, only when nothing is saved in any mode;
 * Yes opens the map picker in multi-select mode with a mode switch, and one Save fills each mode's own store, which
 * My Transit lists. The Ferry tab's stop selector no longer opens by itself (the prompt replaced it).
 */
import { disableWebGL } from '@bft/ui/e2e/no-webgl.ts'
import { expectNoPrompt, expectPrompt, FIRST_VISIT, prompt } from '@bft/ui/e2e/onboarding.ts'
import { encodeHandoff } from '@bft/ui/handoff-codec'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const picker = (page: Page) => page.getByRole('dialog', { name: 'Set up your favourite stops' })
const tray = (page: Page) => picker(page).getByRole('complementary', { name: 'Your favourite stops' })

/** Search the current mode by name in the tray and add the first result named `name`. */
async function addByName(page: Page, label: string, query: string, name: RegExp) {
  await tray(page).getByLabel(label).fill(query)
  await tray(page).getByRole('button', { name }).first().click({ timeout: 20_000 })
}

test('first visit on My Transit: prompt → Yes → pick bus, train and ferry → one Save → My Transit lists them', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByText('Nothing in My Transit yet')).toBeVisible()
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page)).toBeVisible()
  await expect(prompt(page)).toHaveCount(0)

  // Bus (the first mode on My Transit): from the stop index search.
  await addByName(page, 'Find a stop by name', 'cultural centre', /Cultural Centre/)
  // Train: a station from the keyboard list of stations in view.
  await picker(page).getByRole('button', { name: 'Train', exact: true }).click()
  await addByName(page, 'Find a station by name', 'central', /^Central/)
  // Ferry: the tapped terminal is From; the tray asks for a reachable To.
  await picker(page).getByRole('button', { name: 'Ferry', exact: true }).click()
  await addByName(page, 'Find a terminal by name', 'bulimba', /Bulimba/)
  const save = tray(page).getByRole('button', { name: /^Save/ })
  await expect(save).toBeDisabled()
  await tray(page).getByRole('combobox', { name: 'To' }).selectOption({ label: 'Riverside' })
  await expect(tray(page).locator('[data-tray-items] > li')).toHaveCount(3)
  // Reorder: the ferry trip to the top.
  await tray(page).getByRole('button', { name: 'Move Bulimba up' }).click()
  await tray(page).getByRole('button', { name: 'Move Bulimba up' }).click()
  await expect(tray(page).locator('[data-tray-items] > li').first()).toContainText('From Bulimba')
  await save.click()

  await expect(page).toHaveURL(/\/$/)
  const main = page.locator('main')
  await expect(main.locator('a[href="/ferry"]').first()).toBeVisible({ timeout: 15_000 })
  await expect(main.locator('a[href="/train/station/central"]').first()).toBeVisible()
  await expect(main.locator('a[href^="/bus/stop/"]').first()).toBeVisible()
  // Each mode's own store and format.
  const stores = await page.evaluate(() => ({
    bus: JSON.parse(localStorage.getItem('bft-bus-saved') ?? '[]'),
    train: JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]'),
    ferry: JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? 'null'),
  }))
  expect(stores.bus).toHaveLength(1)
  expect(Object.keys(stores.bus[0]).sort()).toEqual(['id', 'name'])
  expect(stores.train).toEqual([{ from: 'central', to: null }])
  expect(stores.ferry).toEqual({
    outbound: { id: '317584', name: 'Bulimba' },
    inbound: { id: '317590', name: 'Riverside' },
  })
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('"Not now" is final: no prompt on a reload or another tab', async ({ page }) => {
  await page.goto('/nearby')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Not now' }).click()
  await expect(prompt(page)).toHaveCount(0)
  await page.reload()
  await expectNoPrompt(page)
  await page.goto('/bus')
  await expectNoPrompt(page)
})

test('Ferry tab first visit (the old path): no stop selector, the default board, then the prompt; "Not now" keeps the board and the selector is one tap away', async ({
  page,
}) => {
  await page.goto('/ferry')
  const board = page.locator('[data-board=outbound]')
  await expect(board).toHaveAttribute('aria-label', 'Bulimba to Riverside')
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toHaveCount(0)
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Not now' }).click()
  await expect(board).toHaveAttribute('aria-label', 'Bulimba to Riverside')
  // Written as the old first visit did, so nothing else changes.
  expect(await page.evaluate(() => localStorage.getItem('brisbane-ferry-selector-seen'))).toBe('1')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toBeVisible()
})

test('no prompt when something is already saved, or for a device the Ferry selector opened on', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
      sessionStorage.setItem('seeded', '1')
    }
  })
  await page.goto('/')
  await expectNoPrompt(page)
  expect(await page.evaluate(() => localStorage.getItem('bft-onboarding'))).toBe('1')
})

test('no prompt for an older Ferry-tab visitor (selector seen)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brisbane-ferry-selector-seen', '1'))
  await page.goto('/ferry')
  await expectNoPrompt(page)
})

test('no prompt after favourites are handed over (P6b import), during or after its notice', async ({
  page,
}) => {
  const hash = encodeHandoff({ v: 1, bus: [{ id: '10802', name: 'Cultural Centre station, platform 1' }] })
  await page.goto(`/${hash}`)
  await expect(page.locator('[data-handoff-notice]')).toBeVisible()
  await expectNoPrompt(page)
  await page.goto('/nearby')
  await expectNoPrompt(page)
})

test('without WebGL: Map unavailable, and the list and search still fill the tray and save', async ({
  page,
}) => {
  await disableWebGL(page)
  await page.goto('/train')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page).getByText('Map unavailable on this device')).toBeVisible()
  // Opened on the tab's mode. The keyboard list of stations in view, then the search.
  await picker(page)
    .getByRole('button', { name: /Stations in view \([1-9]\d*\)/ })
    .click({ timeout: 20_000 })
  const row = picker(page).getByRole('list', { name: 'Train stations in view' }).getByRole('button').first()
  await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await addByName(page, 'Find a station by name', 'roma', /^Roma Street/)
  await expect(tray(page).locator('[data-tray-items] > li')).toHaveCount(2)
  await tray(page).getByRole('button', { name: 'Save 2 stops' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('bft-train-favourites') ?? '[]')),
  ).toHaveLength(2)
})

test('keyboard: the prompt never takes focus, and the picker traps it and closes on Escape', async ({
  page,
}) => {
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).focus()
  await page.keyboard.press('Enter')
  await expect(picker(page)).toBeVisible()
  // Focus starts inside the dialog and Tab stays there.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-onboarding-picker]'))).toBe(
      true,
    )
  }
  await tray(page).getByLabel('Find a stop by name').focus()
  await page.keyboard.press('Escape')
  await expect(picker(page)).toHaveCount(0)
})
