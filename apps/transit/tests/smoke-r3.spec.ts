/**
 * Regression tests for Dev's smoke test round 3 (19 Oct 2026).
 * X9: back online, the offline state clears at once (a refetch), not at the next poll.
 * F1: an offline load must render the styled offline/scheduled board (or a styled offline page), never LIVE.
 */
import { offlineLoadSuite, reconnectSuite } from '@bft/ui/e2e/offline-suite.ts'
import { expect, test } from '@playwright/test'

offlineLoadSuite({
  path: '/ferry/terminal/bulimba?to=riverside',
  unvisited: '/train/station/central',
  pagesCache: 'transit-pages',
})

test.describe('R3-X8: geo tiles never 404', () => {
  // Bulimba: the r7hu cells Dev's device asked for, most of them without ferry stops.
  test.use({ geolocation: { latitude: -27.452, longitude: 153.058 }, permissions: ['geolocation'] })

  test('the Ferry tab and Nearby load every data file and tile they ask for without an error', async ({
    page,
    context,
  }) => {
    const failed: string[] = []
    const tiles: string[] = []
    context.on('response', (r) => {
      // (Fixture mode has recorded departures for only some bus stops, so only data files are checked.)
      if (r.status() >= 400 && r.url().includes('/data/')) failed.push(`${r.status()} ${r.url()}`)
      if (/\/data\/ferry\/geo\/r7hu/.test(r.url())) tiles.push(r.url())
    })
    await page.goto('/ferry')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await page.goto('/nearby')
    await expect(page.locator('main')).toContainText(/ferry|train|bus/i)
    await expect.poll(() => tiles.length, { timeout: 15_000 }).toBeGreaterThan(0)
    await page.getByRole('link', { name: 'Ferry', exact: true }).first().click()
    await page.waitForTimeout(1_500)
    expect(failed).toEqual([])
  })
})

reconnectSuite({
  path: '/',
  prepare: async (page) => {
    await page.addInitScript(() => {
      localStorage.setItem('brisbane-ferry-remember-selection', 'true')
      localStorage.setItem(
        'brisbane-ferry-selected-stops',
        JSON.stringify({
          outbound: { id: '317584', name: 'Bulimba' },
          inbound: { id: '317590', name: 'Riverside' },
        }),
      )
      localStorage.setItem(
        'bft-bus-saved',
        JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
      )
    })
  },
})

test('R3-X11: the home page never shows "Timetable" next to the LIVE badge', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toBeVisible()
  await expect(page.getByText('Timetable', { exact: true })).toHaveCount(0)
})
