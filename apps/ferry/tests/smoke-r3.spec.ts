/**
 * Regression tests for Dev's smoke test round 3 (19 Oct 2026).
 * X9: back online, the offline state clears at once (a refetch), not at the next poll.
 * F1: an offline load must render the styled offline/scheduled board (or a styled offline page), never LIVE.
 */
import { offlineLoadSuite, reconnectSuite } from '@bft/ui/e2e/offline-suite.ts'
import { expect, test } from '@playwright/test'

offlineLoadSuite({ path: '/', unvisited: '/terminal/riverside', pagesCache: 'ferry-pages' })

reconnectSuite({
  path: '/',
  prepare: (page) =>
    page.addInitScript(() => {
      localStorage.setItem('brisbane-ferry-remember-selection', 'true')
      localStorage.setItem(
        'brisbane-ferry-selected-stops',
        JSON.stringify({
          outbound: { id: '317584', name: 'Bulimba' },
          inbound: { id: '317590', name: 'Riverside' },
        }),
      )
    }),
})

test('R3-F2: ?from=&to= opens that pair without replacing the saved one', async ({ page }) => {
  // THE-118 PR 5: the terminal's board, with "To" set.
  await page.goto('/?from=317583&to=317590')
  await expect(page).toHaveURL('/terminal/hawthorne?to=riverside')
  await expect(page.locator('[data-board-header]').getByRole('heading')).toHaveText('Hawthorne')
  await expect(page.getByRole('button', { name: 'To Riverside' })).toBeVisible()
  // No first-visit selector over a deep link, and the next plain visit is unchanged (default pair).
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(
    await page.evaluate(() => localStorage.getItem('brisbane-ferry-selected-stops') ?? ''),
  ).not.toContain('317583')
  const html = await (await page.request.get('/?from=317583&to=317590')).text()
  expect(html).toContain('Hawthorne to Riverside')
  // An unknown origin stays a home link: the default board.
  await page.goto('/?from=nope&to=317590')
  await expect(page).toHaveURL('/?from=nope&to=317590')
  await expect(page.locator('[data-board-header]').getByRole('heading')).toHaveText('Bulimba')
})
