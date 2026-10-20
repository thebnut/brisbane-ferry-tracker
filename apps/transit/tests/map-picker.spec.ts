/**
 * P3: the map stop picker in BrisbaneTransit's Bus tab (the bus app's screens, mounted under /bus). Open links stay
 * inside the tab, and Save uses the bus store, so My Transit lists the saved stop. (Train and Ferry: the next PR.)
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
