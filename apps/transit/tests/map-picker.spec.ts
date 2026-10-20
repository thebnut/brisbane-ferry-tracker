/**
 * P3: the map stop picker in BrisbaneTransit's Bus, Train and Ferry tabs (the mode apps' screens, mounted under their
 * prefix). Open links stay inside the tab, and Save uses each mode's own store, so My Transit lists the saved stop.
 */
import { expect, test } from '@playwright/test'

test('Bus tab: Map → Cultural Centre → Save shows in My Transit → Open stays under /bus', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: -27.4732, longitude: 153.0195 })
  await page.goto('/bus')
  await page.getByRole('button', { name: 'Show stops on a map' }).locator('visible=true').click()
  const picker = page.getByLabel('Bus stops map', { exact: true })
  await picker.getByRole('button', { name: /Stops in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  const stop = picker
    .getByRole('list', { name: 'Bus stops in view' })
    .getByRole('button', { name: /Cultural Centre/ })
    .first()
  const name = ((await stop.locator('span').first().textContent()) ?? '').trim()
  await stop.click()
  const card = picker.getByRole('dialog', { name })
  await expect(card.getByRole('list', { name: `Next departures from ${name}` })).toBeVisible({
    timeout: 10_000,
  })
  await card.getByRole('button', { name: 'Save' }).click()
  const id = (await card.getAttribute('data-stop-card')) as string
  await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/bus/stop/${id}`)
  await card.getByRole('link', { name: 'Open' }).click()
  await expect(page).toHaveURL(new RegExp(`/bus/stop/${id}$`))
  await page.goto('/')
  await expect(page.getByText(name).locator('visible=true').first()).toBeVisible()
})

test('Train tab: the station search has the map; Open stays under /train', async ({ page }) => {
  await page.goto('/train/stations')
  await page.getByRole('button', { name: 'Show stations on a map' }).click()
  const picker = page.getByLabel('Train stations map', { exact: true })
  await picker.getByRole('button', { name: /Stations in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  await picker
    .getByRole('list', { name: 'Train stations in view' })
    .getByRole('button', { name: /^Central/ })
    .click()
  const card = picker.getByRole('dialog', { name: 'Central' })
  await expect(card.getByRole('list', { name: 'Next departures from Central' })).toBeVisible({
    timeout: 10_000,
  })
  await card.getByRole('link', { name: 'Open' }).click()
  await expect(page).toHaveURL(/\/train\/station\/central$/)
})

test('Ferry tab: the stop selector has the map; Use as From fills the field', async ({ page }) => {
  await page.goto('/ferry')
  // The selector no longer opens by itself (P4: the first visit gets the onboarding prompt): Settings opens it.
  await page.getByRole('button', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Select ferry stops' })
  await sheet.getByRole('button', { name: 'Show origin terminals on a map' }).click()
  const picker = sheet.getByRole('region', { name: 'Choose where from map' })
  await picker.getByRole('button', { name: /Terminals in view \([1-9]\d*\)/ }).click({ timeout: 20_000 })
  await picker
    .getByRole('list', { name: 'Choose where from in view' })
    .getByRole('button', { name: /Bulimba/ })
    .click()
  const card = picker.getByRole('dialog', { name: 'Bulimba' })
  await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/ferry/terminal/bulimba')
  await card.getByRole('button', { name: 'Use as From' }).click()
  await expect(sheet.getByRole('combobox', { name: 'From' })).toHaveValue('Bulimba')
})
