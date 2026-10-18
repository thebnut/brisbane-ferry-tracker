/** Regression tests for Dev's smoke test round 1 (18 Oct 2026): T1 overlap, T4 am/pm, T5 offline, T6 desktop nav. */
import { expect, type Locator, test } from '@playwright/test'

const box = async (l: Locator) => {
  const b = await l.boundingBox()
  if (!b) throw new Error('not rendered')
  return b
}

test.describe('phone width 360 px (T1, T4)', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  test('Central → Ferny Grove: the countdown never overlaps the times; arrivals have am/pm', async ({
    page,
  }, testInfo) => {
    await page.goto('/station/central?to=ferny-grove')
    const board = page.locator('[data-board=central]')
    await expect(board.getByTestId('departure').first()).toBeVisible()
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }))
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
    const cards = board.getByTestId('departure')
    let checked = 0
    for (let i = 0; i < (await cards.count()); i++) {
      const card = cards.nth(i)
      const chip = card.locator('[data-tone]')
      const times = card.getByTestId('times')
      if ((await chip.count()) === 0 || (await times.count()) === 0) continue
      checked++
      const c = await box(chip)
      const t = await box(times)
      const overlaps =
        t.x < c.x + c.width && c.x < t.x + t.width && t.y < c.y + c.height && c.y < t.y + t.height
      expect(overlaps, `card ${i}: times and countdown overlap`).toBe(false)
      expect(c.x + c.width).toBeLessThanOrEqual(innerWidth)
      // Each time chunk fits inside the times column (nothing runs under the chip).
      expect(await times.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
      // T4: "9:25 pm", never a bare "9:25".
      const text = (await times.innerText()).replace(/\s+/g, ' ')
      expect(text).toMatch(/^\d{1,2}:\d{2} (am|pm)/)
      // (" arriving " is the screen-reader text after the arrow.)
      if (text.includes('→')) expect(text).toMatch(/→ (arriving )?\d{1,2}:\d{2} (am|pm)/)
    }
    expect(checked).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('central-ferny-grove-360.png') })
  })
})

test('desktop: section links in the header, no phone bottom nav (T6)', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop layout')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/station/central')
  const header = page.locator('header')
  await expect(header.getByRole('navigation', { name: 'Sections' })).toBeVisible()
  await expect(header.getByRole('link', { name: 'Alerts' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden()
})

test('phone: bottom nav, no header links (T6)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/station/central')
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.locator('header').getByRole('navigation', { name: 'Sections' })).toBeHidden()
})

test('offline: the banner at once, no LIVE badge, and it stays that way (T5)', async ({ page, context }) => {
  test.slow()
  await page.goto('/station/central')
  const board = page.locator('[data-board=central]')
  await expect(board.locator('[data-badge=live]').first()).toBeVisible()
  await context.setOffline(true)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 2_000 })
  await expect(board.locator('[data-badge=live]')).toHaveCount(0)
  await page.waitForTimeout(32_000)
  await expect(page.locator('[data-banner=offline]')).toBeVisible()
  await expect(board.locator('[data-badge=live]')).toHaveCount(0)
  await context.setOffline(false)
  await expect(page.locator('[data-banner=offline]')).toBeHidden()
})

test('API unreachable while the browser says online: offline banner at the next refresh (T5)', async ({
  page,
  context,
}) => {
  await page.goto('/station/central')
  const board = page.locator('[data-board=central]')
  await expect(board.locator('[data-badge=live]').first()).toBeVisible()
  // context.route also covers the service worker's own network requests.
  await context.route('**/v1/**', (route) => route.abort('internetdisconnected'))
  // Polls run every 15 s.
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 20_000 })
  await expect(board.locator('[data-badge=live]')).toHaveCount(0)
})

test('service page: no LIVE or GPS while offline (Codex review)', async ({ page, context }) => {
  await page.goto('/station/central')
  await page.locator('[data-board=central] [data-testid=departure] a').first().click()
  await expect(page.getByRole('list', { name: 'Stopping pattern' })).toBeVisible()
  await context.setOffline(true)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 2_000 })
  await expect(page.locator('main [data-badge=live]')).toHaveCount(0)
  await expect(page.locator('main [data-badge=gps]')).toHaveCount(0)
  await expect(page.getByText('LIVE', { exact: true })).toHaveCount(0)
  await context.setOffline(false)
})

test('header LIVE follows the boards: stale data, no LIVE pill (Codex review)', async ({ page }) => {
  await page.goto('/station/roma-street?to=indooroopilly')
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toBeVisible()
  await page.goto('/station/roma-street?to=indooroopilly&rt=stale')
  await expect(page.locator('[data-banner=stale]').first()).toBeVisible()
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toHaveCount(0)
})
