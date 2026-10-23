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

  test(`${path}: a fresh page is never held back by the device clock, five minutes fast (R15-S1)`, async ({
    page,
  }) => {
    await recordLiveClaims(page)
    // Before R15 the live guard compared the render time with the device clock, so a fast clock hid LIVE (and showed
    // OFFLINE) on a fresh page until the first poll. Pages from the service worker's cache are marked by it instead
    // (markCachedPages: the tests below inject that mark); @bft/ui/e2e/clock-skew.ts covers the rest.
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
    expect(w.__guardAtFirstFrame).toBe(false)
    expect(w.__liveSeen).not.toEqual([])
  })
}

test('a cached page: each board claims LIVE only after its own fresh departures arrive (Codex review rounds 2-3)', async ({
  page,
  context,
}) => {
  test.slow()
  // Serve the page as the service worker's page cache does (markCachedPages marks the <html> tag).
  await context.route('**/station/roma-street?to=indooroopilly', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const res = await route.fetch()
    const body = (await res.text()).replace(/<html(?=[\s>])/, '<html data-live-unconfirmed=""')
    await route.fulfill({ response: res, body })
  })
  // Hold the return board's departures back; the outbound board's answer goes through.
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await context.route('**/__fixtures/v1/train/stops/indooroopilly/departures*', async (route) => {
    await held
    await route.continue()
  })
  await recordLiveClaims(page)
  await page.goto('/station/roma-street?to=indooroopilly')
  const outbound = page.locator('[data-board=roma-street]')
  const back = page.locator('[data-board=indooroopilly]')
  // After hydration both boards came with the cached HTML: neither is live, each is a copy kept on the device until
  // its own answer arrives ("Offline · scheduled", never "Live times delayed": R6-B1). (Counts, not visibility: a
  // phone shows one board at a time.)
  await expect(outbound.locator('[data-banner=offline]')).toHaveCount(1)
  await expect(back.locator('[data-banner=offline]')).toHaveCount(1)
  // The outbound board's own fresh answer (polled every 15 s) makes it live; the held board stays as it was.
  await page.waitForResponse((r) => r.url().includes('/stops/roma-street/departures') && r.ok(), {
    timeout: 45_000,
  })
  await expect(outbound.locator('[data-banner=offline]')).toHaveCount(0)
  await expect(back.locator('[data-banner=offline]')).toHaveCount(1)
  await expect(back.locator('[data-dot=live]')).toHaveCount(0)
  // The header pill waits for every board.
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toHaveCount(0)
  release()
  await page.waitForResponse((r) => r.url().includes('/stops/indooroopilly/departures') && r.ok(), {
    timeout: 45_000,
  })
  await expect(back.locator('[data-banner=offline]')).toHaveCount(0)
  // Nothing claimed LIVE before its board's own fresh data was on screen: the recorder saw no LIVE while both boards
  // were cached (it runs for the first 10 s, all before the first poll).
  const seen = await page.evaluate(() => (window as unknown as { __liveSeen: string[] }).__liveSeen)
  expect(seen).toEqual([])
})
