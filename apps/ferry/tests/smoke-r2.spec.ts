/**
 * Regression tests for Dev's smoke test round 2 (18 Oct 2026). T7: a page rendered from the service worker's cache
 * must never claim LIVE before freshness is known (the shared live guard in the root layout, @bft/ui connectivity).
 * Playwright's Chromium doesn't serve navigations from the service worker under offline emulation, so an offline
 * reload is simulated: the device reports offline from the first script on, and live API calls fail.
 */
import { expect, type Page, test } from '@playwright/test'

const PAGES = ['/']

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

test("a cached page: the header and an inbound departure wait for the inbound board's own data (Codex review round 4)", async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(isMobile, 'the inbound board is on the desktop layout')
  test.slow()
  await page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })
  // Serve the page as the service worker's page cache does (markCachedPages marks the <html> tag).
  await context.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const res = await route.fetch()
      const body = (await res.text()).replace(/<html(?=[\s>])/, '<html data-live-unconfirmed=""')
      await route.fulfill({ response: res, body })
    },
  )
  // Hold the inbound board's departures; the outbound board's answer goes through.
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await context.route('**/__fixtures/v1/ferry/stops/317590/departures*', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/')
  await page.waitForResponse((r) => r.url().includes('/stops/317584/departures') && r.ok(), {
    timeout: 45_000,
  })
  await page.waitForTimeout(500)
  // Outbound is confirmed, inbound is still the cached copy: no LIVE in the header.
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-board=inbound] [data-badge=live]')).toHaveCount(0)
  // An inbound departure's details follow the inbound board: no LIVE or GPS from the cached row.
  await page.locator('[data-board=inbound]').getByTestId('departure').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.locator('[data-badge=live], [data-badge=gps]')).toHaveCount(0)
  release()
})

test('a cached page: the live map (both directions) waits for every board, not just one (Codex review round 5)', async ({
  page,
  context,
}) => {
  test.slow()
  await page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })
  await context.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const res = await route.fetch()
      const body = (await res.text()).replace(/<html(?=[\s>])/, '<html data-live-unconfirmed=""')
      await route.fulfill({ response: res, body })
    },
  )
  // Hold the outbound board's departures; the inbound board's answer goes through.
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await context.route('**/__fixtures/v1/ferry/stops/317584/departures*', async (route) => {
    await held
    await route.continue()
  })
  await page.goto('/')
  await page.waitForResponse((r) => r.url().includes('/stops/317590/departures') && r.ok(), {
    timeout: 45_000,
  })
  await page.getByRole('button', { name: 'Map' }).click()
  await expect(page.getByText('Live positions are unavailable right now.')).toBeVisible()
  release()
})
