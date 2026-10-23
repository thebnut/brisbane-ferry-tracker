/**
 * Regression tests for Dev's smoke test round 2 (18 Oct 2026). T7: a page rendered from the service worker's cache
 * must never claim LIVE before freshness is known (the shared live guard in the root layout, @bft/ui connectivity).
 * Playwright's Chromium doesn't serve navigations from the service worker under offline emulation, so an offline
 * reload is simulated: the device reports offline from the first script on, and live API calls fail.
 */
import { expect, type Page, test } from '@playwright/test'

const PAGES = ['/terminal/bulimba?to=riverside']

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
    (url) => url.pathname === '/terminal/bulimba',
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
  await page.goto('/terminal/bulimba?to=riverside')
  await page.waitForResponse((r) => r.url().includes('/stops/317584/departures') && r.ok(), {
    timeout: 45_000,
  })
  await page.waitForTimeout(500)
  // Outbound is confirmed, inbound is still the cached copy: no LIVE in the header.
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-board=inbound] [data-dot=live]')).toHaveCount(0)
  // An inbound departure opens its own trip page (THE-118 PR 6), from Riverside, which claims only from its own data.
  await expect(page.locator('[data-board=inbound] [data-testid=departure] a').first()).toHaveAttribute(
    'href',
    /\/trip\/[^?]+\?from=riverside&to=bulimba$/,
  )
  release()
})

test("a cached map page: no LIVE and no positions until its own answer, and none from one that isn't live (THE-118 PR 9)", async ({
  page,
  context,
}) => {
  test.slow()
  // The live ferry map replaced the board's map sheet: it judges its positions by their own answer (Codex review
  // round 5 asked the sheet to wait for every board).
  await context.route(
    (url) => url.pathname === '/map',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.continue()
      const res = await route.fetch()
      const body = (await res.text()).replace(/<html(?=[\s>])/, '<html data-live-unconfirmed=""')
      await route.fulfill({ response: res, body })
    },
  )
  let release = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await context.route('**/__fixtures/v1/ferry/vehicles*', async (route) => {
    await held
    const res = await route.fetch()
    await route.fulfill({ response: res, json: { ...(await res.json()), rtState: 'stale' } })
  })
  await page.goto('/map?terminal=bulimba')
  await expect(page.locator('[data-map-page=ferry]')).toBeVisible()
  await page.waitForTimeout(500)
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toHaveCount(0)
  await expect(page.locator('.bft-marker[data-tone=allstops], .bft-marker[data-tone=express]')).toHaveCount(0)
  release()
  await expect(page.getByText('Live positions are unavailable right now.')).toBeVisible()
  await expect(page.locator('header').getByText('LIVE', { exact: true })).toHaveCount(0)
})
