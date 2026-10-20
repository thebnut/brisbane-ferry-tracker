/** Regression tests for Dev's smoke test round 1b (18 Oct 2026): X1 ferry selector, X2 nearby tiles, X4 offline. */
import { expect, test } from '@playwright/test'

test('Ferry tab: no stop selector opens by itself (X1; P4 moved the first visit to the onboarding prompt)', async ({
  page,
}) => {
  await page.goto('/ferry')
  await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toBeHidden()
  for (let i = 0; i < 2; i++) {
    await page.reload()
    await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toBeHidden()
  }
})

test('Around you: every tile request answers (no 404s for empty cells) (X2)', async ({ page }) => {
  const missing: string[] = []
  page.on('response', (r) => {
    if (r.url().includes('/data/') && r.status() >= 400) missing.push(`${r.status()} ${r.url()}`)
  })
  await page.goto('/nearby?lat=-27.4717&lon=153.0206')
  await expect(page.locator('[data-nearby-ms]')).toBeVisible()
  expect(missing).toEqual([])
})

test('Saved: LIVE never comes back while offline (X4)', async ({ page, context }) => {
  test.slow()
  await page.addInitScript(() => {
    localStorage.setItem('bft-bus-saved', JSON.stringify([{ id: '10802', name: 'Cultural Centre' }]))
  })
  await page.goto('/')
  await expect(page.getByText('LIVE', { exact: true }).first()).toBeVisible()
  await context.setOffline(true)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 2_000 })
  await page.waitForTimeout(32_000)
  await expect(page.locator('[data-banner=offline]')).toBeVisible()
  await expect(page.getByText('LIVE', { exact: true })).toHaveCount(0)
  await context.setOffline(false)
  await expect(page.locator('[data-banner=offline]')).toBeHidden()
})
