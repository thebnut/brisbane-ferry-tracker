/**
 * Regression tests for Dev's smoke test round 2 (18 Oct 2026). T7: a page rendered from the service worker's cache
 * must never claim LIVE before freshness is known (the shared live guard in the root layout, @bft/ui connectivity).
 * Playwright's Chromium doesn't serve navigations from the service worker under offline emulation, so an offline
 * reload is simulated: the device reports offline from the first script on, and live API calls fail.
 */
import { expect, type Page, test } from '@playwright/test'

const PAGES = ['/station/central']

/** Records every frame in which a LIVE or GPS claim is visible, from the first paint on. */
const recordLiveClaims = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = []
    const w = window as unknown as { __liveSeen: string[]; __guardAtFirstFrame?: boolean }
    w.__liveSeen = seen
    const tick = () => {
      w.__guardAtFirstFrame ??= document.documentElement.hasAttribute('data-live-unconfirmed')
      for (const el of document.querySelectorAll<HTMLElement>('span')) {
        const claim =
          el.dataset.badge === 'live' ||
          el.dataset.badge === 'gps' ||
          (el.childElementCount === 0 && el.textContent === 'LIVE')
        if (claim && el.checkVisibility())
          seen.push(`${Math.round(performance.now())} ms: ${el.outerHTML.slice(0, 80)}`)
      }
      if (performance.now() < 10_000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

for (const path of PAGES) {
  test(`${path}: a reload while offline never shows LIVE, not even before hydration (R2-T7)`, async ({
    page,
    context,
  }) => {
    // The server HTML does claim LIVE (the guard has something to hide).
    expect(await (await page.request.get(path)).text()).toContain('data-live-claim')
    await recordLiveClaims(page)
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true })
    })
    await context.route('**/v1/**', (route) => route.abort('internetdisconnected'))
    await page.goto(path)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible()
    await page.waitForTimeout(1_500)
    const w = await page.evaluate(() => (window as unknown as { __liveSeen: string[] }).__liveSeen)
    expect(w).toEqual([])
  })

  test(`${path}: HTML rendered minutes ago shows no LIVE until a live call reaches the network (R2-T7)`, async ({
    page,
  }) => {
    await recordLiveClaims(page)
    // The device clock says the HTML is five minutes old, as for a page the service worker kept.
    await page.addInitScript(() => {
      const now = Date.now
      Date.now = () => now() + 5 * 60_000
    })
    await page.goto(path)
    await page.waitForTimeout(1_500)
    const w = await page.evaluate(() => {
      const { __liveSeen, __guardAtFirstFrame } = window as unknown as {
        __liveSeen: string[]
        __guardAtFirstFrame?: boolean
      }
      return { __liveSeen, __guardAtFirstFrame }
    })
    expect(w.__guardAtFirstFrame).toBe(true)
    expect(w.__liveSeen).toEqual([])
    // A live call that reaches the network (a poll) confirms freshness; the app's own state decides from then on.
    // (Polls run every 15 s; under a loaded test run the first can take longer, so wait for it rather than a clock.)
    await page.waitForResponse((r) => /\/v1\//.test(new URL(r.url()).pathname) && r.ok(), { timeout: 45_000 })
    await expect(page.locator('html')).not.toHaveAttribute('data-live-unconfirmed', '')
  })
}
