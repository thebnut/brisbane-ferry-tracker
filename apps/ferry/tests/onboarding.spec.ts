/**
 * P4: first-visit onboarding on the ferry home, from a real first visit (no storage state; the other specs start with
 * the prompt answered). It replaced the stop selector opening by itself: the first visit shows the default board,
 * then the prompt. "Not now" leaves that board, as closing the selector did; Yes opens the map picker, where a tapped
 * terminal is From and the tray asks for a reachable To, and Save stores the pair as the selector's Save does.
 */
import { disableWebGL } from '@bft/ui/e2e/no-webgl.ts'
import {
  expectNoPrompt,
  expectPrompt,
  expectPromptClearOfDocks,
  FIRST_VISIT,
  PHONE_WIDTHS,
  prompt,
} from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ storageState: FIRST_VISIT })

const picker = (page: Page) => page.getByRole('dialog', { name: 'Set up your favourite stops' })
const tray = (page: Page) => picker(page).getByRole('complementary', { name: 'Your favourite stops' })
const board = (page: Page) => page.locator('[data-board=outbound]')

test('first visit (the old path): default board, no selector, then the prompt; "Not now" keeps the board, for good', async ({
  page,
}) => {
  await page.goto('/')
  await expect(board(page)).toHaveAttribute('aria-label', 'Bulimba to Riverside')
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toHaveCount(0)
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Not now' }).click()
  await expect(prompt(page)).toHaveCount(0)
  await expect(board(page)).toHaveAttribute('aria-label', 'Bulimba to Riverside')
  expect(await page.evaluate(() => localStorage.getItem('brisbane-ferry-selector-seen'))).toBe('1')
  // The selector is one tap away, as after closing it on a first visit before.
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(board(page)).toHaveAttribute('aria-label', 'Bulimba to Riverside')
  await expectNoPrompt(page)
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toHaveCount(0)
})

test('Yes → tap a terminal (From) → a reachable To → Save: the boards show the pair, saved as before', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page)).toBeVisible()
  // From the keyboard list of terminals in view: it goes into the tray, the map stays open.
  await picker(page)
    .getByRole('button', { name: /Terminals in view \([1-9]\d*\)/ })
    .click({ timeout: 20_000 })
  await picker(page)
    .getByRole('list', { name: 'Ferry terminals in view' })
    .getByRole('button', { name: /^Riverside/ })
    .click()
  await expect(tray(page).locator('[data-tray-items] > li')).toHaveText([/From Riverside/])
  await expect(tray(page).getByRole('status')).toHaveText(/From Riverside\. Now choose where you're going\./)
  const save = tray(page).getByRole('button', { name: 'Save' })
  await expect(save).toBeDisabled()
  const to = tray(page).getByRole('combobox', { name: 'To' })
  // Only terminals with a direct service from Riverside.
  expect(await to.locator('option').allTextContents()).not.toContain('Riverside')
  await to.selectOption({ label: 'Bulimba' })
  await save.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(board(page)).toHaveAttribute('aria-label', 'Riverside to Bulimba')
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? 'null')),
  ).toEqual({ outbound: { id: '317590', name: 'Riverside' }, inbound: { id: '317584', name: 'Bulimba' } })
  // The server renders the pair from its cookie too.
  expect(await (await page.request.get('/')).text()).toContain('Riverside to Bulimba')
  await expectNoPrompt(page)
  expect(errors).toEqual([])
})

test('no prompt over a deep link or a terminal page, or once a pair is saved', async ({ page }) => {
  await page.goto('/?from=317583&to=317590')
  await expectNoPrompt(page)
  await page.goto('/terminal/bulimba')
  await expectNoPrompt(page)
  await page.evaluate(() =>
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    ),
  )
  await page.evaluate(() => localStorage.setItem('brisbane-ferry-remember-selection', 'true'))
  await page.goto('/')
  await expectNoPrompt(page)
})

test('no prompt for a device the stop selector already opened on', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('brisbane-ferry-selector-seen', '1'))
  await page.goto('/')
  await expectNoPrompt(page)
})

test('without WebGL: Map unavailable, and the search still picks From and saves the pair', async ({
  page,
}) => {
  await disableWebGL(page)
  await page.goto('/')
  await expectPrompt(page)
  await prompt(page).getByRole('button', { name: 'Yes' }).click()
  await expect(picker(page).getByText('Map unavailable on this device')).toBeVisible()
  await tray(page).getByLabel('Find a terminal by name').fill('new farm')
  await tray(page)
    .getByRole('button', { name: /New Farm/ })
    .first()
    .click()
  const to = tray(page).getByRole('combobox', { name: 'To' })
  await to.selectOption({ index: 1 })
  await tray(page).getByRole('button', { name: 'Save' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(board(page)).toHaveAttribute('aria-label', /^New Farm/)
})

for (const size of PHONE_WIDTHS) {
  test(`${size.width} px: the prompt sits clear of the bottom nav (R15)`, async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'the bottom nav is phone-only')
    await page.setViewportSize(size)
    await page.goto('/')
    await expectPrompt(page)
    await expectPromptClearOfDocks(page)
  })
}
