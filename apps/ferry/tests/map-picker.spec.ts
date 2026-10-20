/**
 * P3: the map stop picker in the ferry stop selector. Map → a terminal from the keyboard list → its card (next
 * ferries) → "Use as From" fills the field → Save stores the pair as before; Open goes to the terminal page. The
 * transit app runs the same flow under /ferry (apps/transit/tests/map-picker.spec.ts).
 */
import { expect, test } from '@playwright/test'

test('Map → a terminal → its card → Use as From → Save stores the pair', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  const sheet = page.getByRole('dialog', { name: 'Select ferry stops' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('button', { name: 'Show origin terminals on a map' }).click()
  const picker = sheet.getByRole('region', { name: 'Choose where from map' })
  await picker.getByRole('button', { name: /Terminals in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  await picker
    .getByRole('list', { name: 'Choose where from in view' })
    .getByRole('button', { name: /Hawthorne/ })
    .click()
  const card = picker.getByRole('dialog', { name: 'Hawthorne' })
  await expect(card.getByRole('list', { name: 'Next departures from Hawthorne' })).toBeVisible({
    timeout: 10_000,
  })
  await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/terminal/hawthorne')
  // Escape steps back in the picker (closes the card), not the whole sheet.
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await expect(sheet).toBeVisible()
  await picker.getByRole('button', { name: /Terminals in view/ }).click()
  await picker
    .getByRole('list', { name: 'Choose where from in view' })
    .getByRole('button', { name: /Hawthorne/ })
    .click()
  await card.getByRole('button', { name: 'Use as From' }).click()
  await expect(picker).toHaveCount(0)
  await expect(sheet.getByRole('combobox', { name: 'From' })).toHaveValue('Hawthorne')
  await sheet.getByRole('checkbox', { name: 'Remember selection' }).check()
  await sheet.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('[data-board=outbound]')).toHaveAttribute('aria-label', /^Hawthorne to /)
  const pair = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? '{}'),
  )
  expect(pair.outbound.name).toBe('Hawthorne')
  expect(errors).toEqual([])
})

test('Open on a terminal card goes to the terminal page', async ({ page }) => {
  await page.goto('/')
  const sheet = page.getByRole('dialog', { name: 'Select ferry stops' })
  await sheet.getByRole('button', { name: 'Show destination terminals on a map' }).click()
  const picker = sheet.getByRole('region', { name: 'Choose where to map' })
  await picker.getByRole('button', { name: /Terminals in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  await picker.getByRole('list', { name: 'Choose where to in view' }).getByRole('button').first().click()
  const card = picker.locator('[data-stop-card]')
  await expect(card.getByRole('button', { name: 'Use as To' })).toBeVisible()
  await card.getByRole('link', { name: 'Open' }).click()
  await expect(page).toHaveURL(/\/terminal\/[a-z0-9-]+$/)
  await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
})
