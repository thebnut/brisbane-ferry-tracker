/**
 * Regression tests for Dev's smoke test round 8 (19 Oct 2026).
 * T1: the home `/` is saved when the service worker installs, so the first offline reload after the first visit (or
 * after a visit to a mode page only) is the styled app, not the service worker's "page isn't saved" page. With
 * nothing saved, an offline home shows the offline banner with its OFFLINE pill, and both clear once back online.
 */
import { bodyFont, goOffline, visibleLiveClaims } from '@bft/ui/e2e/offline.ts'
import { expect, type Page, test } from '@playwright/test'

/** The service worker controls the page (installed, so its install-time pages are saved). */
const controlled = (page: Page) =>
  expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 30_000 })
    .toBe(true)

const offlineHome = async (page: Page) => {
  await expect(page.locator('[data-offline-page]')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(await bodyFont(page)).toContain('Inter')
  await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('OFFLINE', { exact: true })).toBeVisible()
  expect(await visibleLiveClaims(page)).toEqual([])
}

test.describe('R8-T1: the home opens offline after the first visit', () => {
  test('first visit to /, then an offline reload: the styled home, offline banner and pill; online again, both clear', async ({
    page,
    context,
  }) => {
    test.slow()
    await page.goto('/')
    await controlled(page)
    const goOnline = await goOffline(context)
    await page.reload()
    await offlineHome(page)
    await expect(page.getByText('Nothing is saved on this device yet')).toBeVisible()

    // No reload: the home's own network answer confirms it.
    await goOnline()
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 5_000 })
    await expect(page.getByText('OFFLINE', { exact: true })).toHaveCount(0)
  })

  test('only a mode page opened online: / still opens offline', async ({ page, context }) => {
    test.slow()
    await page.goto('/ferry')
    await controlled(page)
    expect(
      await page.evaluate(async () =>
        (await (await caches.open('transit-pages')).keys()).map((r) => new URL(r.url).pathname),
      ),
    ).toContain('/')
    await goOffline(context)
    await page.goto('/')
    await offlineHome(page)
  })
})
