/** Regression tests for Dev's smoke test round 1 (18 Oct 2026): phone width (F1) and offline (F3). */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { pinUpcoming, refreshBoards } from './upcoming.ts'

const UQ = { id: '319665', name: 'UQ St Lucia' }
const NORTHSHORE = { id: '318002', name: 'Northshore Hamilton' }

const remember = (page: Page, outbound: typeof UQ, inbound: typeof UQ) =>
  page.addInitScript((pair) => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem('brisbane-ferry-selected-stops', pair)
  }, JSON.stringify({ outbound, inbound }))

const box = async (l: Locator) => {
  const b = await l.boundingBox()
  if (!b) throw new Error('not rendered')
  return b
}

test.describe('phone width 360 px, longest stop names (F1)', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  for (const [from, to] of [
    [UQ, NORTHSHORE],
    [NORTHSHORE, UQ],
  ] as const) {
    test(`${from.name} → ${to.name}: no horizontal scroll, nothing clipped`, async ({
      page,
      context,
    }, testInfo) => {
      await remember(page, from, to)
      // A departure due in 10 minutes at any hour, so there is always a chip to measure.
      await pinUpcoming(context)
      await page.goto('/')
      const board = page.locator('[data-board=outbound]')
      await expect(board.getByTestId('departure').first()).toBeVisible()
      await refreshBoards(page)
      await expect(board.locator('[data-countdown]').first()).toBeVisible()
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth)
      expect(innerWidth).toBe(360)

      // "Depart from" select fully on screen.
      const depart = board.getByRole('combobox').filter({ hasText: 'Now' })
      const d = await box(depart)
      expect(d.x).toBeGreaterThanOrEqual(0)
      expect(d.x + d.width).toBeLessThanOrEqual(innerWidth)

      // Every countdown is inside its row and never overlaps the destination or the status line (THE-118 PR 4 row).
      const cards = board.getByTestId('departure')
      const n = await cards.count()
      let chips = 0
      for (let i = 0; i < n; i++) {
        const card = cards.nth(i)
        const chip = card.locator('[data-countdown]')
        if ((await chip.count()) === 0) continue
        chips++
        const c = await box(chip)
        const a = await box(card)
        expect(c.x).toBeGreaterThanOrEqual(a.x)
        expect(c.x + c.width).toBeLessThanOrEqual(a.x + a.width)
        expect(c.x + c.width).toBeLessThanOrEqual(innerWidth)
        // Countdown text isn't cut off.
        expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
        for (const part of [card.getByTestId('destination'), card.locator('[data-row-status]')]) {
          const t = await box(part)
          const overlaps =
            t.x < c.x + c.width && c.x < t.x + t.width && t.y < c.y + c.height && c.y < t.y + t.height
          expect(overlaps).toBe(false)
        }
      }
      expect(chips).toBeGreaterThan(0)
      await page.screenshot({ path: testInfo.outputPath(`360-${from.id}-${to.id}.png`) })
    })
  }
})

test.describe('phone width 360 px while offline', () => {
  test.use({ viewport: { width: 360, height: 740 } })
  test('the header still fits with the OFFLINE pill', async ({ page, context }) => {
    await remember(page, UQ, NORTHSHORE)
    await page.goto('/')
    await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
    await context.setOffline(true)
    await expect(page.getByText('OFFLINE', { exact: true })).toBeVisible()
    const header = await box(page.locator('header'))
    const pill = await box(page.getByText('OFFLINE', { exact: true }))
    expect(pill.x + pill.width).toBeLessThanOrEqual(header.width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
    await context.setOffline(false)
  })
})

test.describe('offline (F3)', () => {
  test('requests failing while the browser still says online: the banner shows at once, no LIVE', async ({
    page,
    context,
  }) => {
    await remember(page, { id: '317584', name: 'Bulimba' }, { id: '317590', name: 'Riverside' })
    // A LIVE row at any hour (the precondition for both tests).
    await pinUpcoming(context)
    await page.goto('/')
    const board = page.locator('[data-board=outbound]')
    await expect(board.getByTestId('departure').first()).toBeVisible()
    await refreshBoards(page)
    await expect(board.locator('[data-dot=live]').first()).toBeVisible()
    // Lie-fi: navigator.onLine stays true, but the API can't be reached.
    // context.route also covers the service worker's own network requests.
    await context.route('**/v1/**', (route) => route.abort('internetdisconnected'))
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByText('Offline · scheduled')).toBeVisible({ timeout: 3_000 })
    await expect(board.locator('[data-dot=live]')).toHaveCount(0)
    await expect(page.getByText('OFFLINE', { exact: true })).toBeVisible()
    // Back: the next successful request clears it.
    await context.unroute('**/v1/**')
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByText('Offline · scheduled')).toBeHidden()
    await expect(board.locator('[data-dot=live]').first()).toBeVisible()
  })

  test('LIVE never comes back while offline (polls keep failing)', async ({ page, context }) => {
    test.slow()
    await remember(page, { id: '317584', name: 'Bulimba' }, { id: '317590', name: 'Riverside' })
    // A LIVE row at any hour (the precondition for both tests).
    await pinUpcoming(context)
    await page.goto('/')
    const board = page.locator('[data-board=outbound]')
    await expect(board.getByTestId('departure').first()).toBeVisible()
    await refreshBoards(page)
    await expect(board.locator('[data-dot=live]').first()).toBeVisible()
    await context.setOffline(true)
    await expect(page.getByText('Offline · scheduled')).toBeVisible()
    // Two poll intervals (15 s): still offline, no live claims, no pulsing "Departing" for times that have passed.
    await page.waitForTimeout(32_000)
    await expect(page.getByText('Offline · scheduled')).toBeVisible()
    await expect(board.locator('[data-dot=live]')).toHaveCount(0)
    await expect(page.getByText('LIVE', { exact: true })).toHaveCount(0)
    await context.setOffline(false)
    await expect(page.getByText('Offline · scheduled')).toBeHidden()
  })
})
