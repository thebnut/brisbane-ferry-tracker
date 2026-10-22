/** Regression tests for Dev's smoke test round 1b (18 Oct 2026): B1 stop names, B2 phone width, B3/B4 offline, B5. */
import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const watchErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/openfreemap|tiles|Failed to load resource/i.test(m.text()))
      errors.push(m.text())
  })
  return errors
}

test.describe('phone width 360 px (B2)', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('stop board: no horizontal scroll; destinations wrap instead of being cut short', async ({
    page,
  }, testInfo) => {
    await page.goto('/stop/10802')
    await expect(page.getByTestId('departure').first()).toBeVisible()
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
    const destinations = page.getByTestId('destination')
    const n = await destinations.count()
    expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      // Up to two lines, never clipped sideways.
      expect(await destinations.nth(i).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath('stop-360.png') })
  })
})

test('trip page names its stops, not "Stop 6298" (B1)', async ({ page }) => {
  await page.goto('/stop/10802')
  await page.getByTestId('departure').first().locator('a').click()
  const stops = page.getByRole('list', { name: 'Stops on this trip' })
  await expect(stops).toBeVisible()
  const names = await stops.locator('li').allInnerTexts()
  expect(names.length).toBeGreaterThan(1)
  for (const n of names) expect(n.split('\n')[0]).not.toMatch(/^Stop \d+$/)
})

test('page loaded while offline hydrates without a mismatch and shows no LIVE (B4, B3)', async ({ page }) => {
  const errors = watchErrors(page)
  // The device says offline from the first script on (as after an offline reload served by the service worker).
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true })
  })
  await page.goto('/stop/10802')
  await expect(page.locator('[data-banner=offline]')).toBeVisible()
  await expect(page.locator('[data-status=live]')).toHaveCount(0)
  await page.waitForTimeout(1_000)
  // React #418/#423 would be a hydration mismatch.
  expect(errors.filter((e) => /418|423|hydrat/i.test(e))).toEqual([])
  expect(errors).toEqual([])
})

test('offline: the banner stays and LIVE never comes back while offline (B3)', async ({ page, context }) => {
  test.slow()
  await pinUpcoming(context)
  await page.goto('/stop/10802')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await expect(page.locator('[data-status=live]').first()).toBeVisible()
  await context.setOffline(true)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 2_000 })
  await expect(page.locator('[data-status=live]')).toHaveCount(0)
  await page.waitForTimeout(32_000)
  await expect(page.locator('[data-banner=offline]')).toBeVisible()
  await expect(page.locator('[data-status=live]')).toHaveCount(0)
  await context.setOffline(false)
  await expect(page.locator('[data-banner=offline]')).toBeHidden()
})

test('opening a busy stop from the home chips does not save it (B5)', async ({ page }) => {
  await page.goto('/')
  await page
    .getByRole('link', { name: 'Cultural Centre station, platform 1' })
    .locator('visible=true')
    .click()
  await expect(page).toHaveURL(/\/stop\/10802/)
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /to My Transit/ })).toHaveAttribute('aria-pressed', 'false')
  await page.goto('/')
  expect(await page.evaluate(() => localStorage.getItem('bft-bus-saved'))).toBeNull()
})

test('trip page: no LIVE or GPS while offline (Codex review)', async ({ page, context }) => {
  await pinUpcoming(context)
  await page.goto('/stop/10802')
  await page.getByRole('button', { name: 'Refresh' }).click()
  await page.locator('[data-status=live] a').first().click()
  await expect(page.getByRole('list', { name: 'Stops on this trip' })).toBeVisible()
  await context.setOffline(true)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 2_000 })
  await expect(page.locator('main [data-badge=live]')).toHaveCount(0)
  await expect(page.locator('main [data-badge=gps]')).toHaveCount(0)
  await expect(page.getByText('LIVE', { exact: true })).toHaveCount(0)
  await context.setOffline(false)
})
