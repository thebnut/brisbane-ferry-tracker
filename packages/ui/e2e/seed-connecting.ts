/**
 * R32-RT1 (Dev, smoke round 32, staging bus stop 10802 on a phone): a cold API isolate answered the page's own render
 * from its expired copy (`stale`) once its realtime wait ran out, and for about a second, until the board's own
 * refetch came back live, the page showed OFFLINE, "Offline", "Live times delayed" and every row Scheduled. While that
 * refetch is out the board is pending: "Connecting…", no banner, no LIVE (rows may stay Scheduled). Once it answers it
 * is judged as before: a live answer shows LIVE, a stale one OFFLINE and the banner.
 *
 * The server render is the stale seed (?rt=stale, the fixture API's forced state). The board's own departures
 * requests are held until the pending page has been checked (at least 1.5 s), then answered live (rt removed) or still
 * stale. Rows are pinned (the apps' tests/upcoming.ts), so nothing depends on the time of day.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { visibleLiveClaims } from './offline.ts'

const HOLD_MS = 1_500

/** The page claims nothing while it waits: no OFFLINE, no "Offline" status, no delayed banner and no LIVE. */
async function expectConnecting(page: Page) {
  const header = page.locator('header')
  await expect(header.locator('[data-connection=connecting]').first()).toBeVisible()
  await expect(header.getByText('OFFLINE', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-status-line]').filter({ hasText: 'Offline' })).toHaveCount(0)
  // The demo-data notice (fixtures) is not a live-data banner.
  await expect(page.locator('[data-banner]:not([data-banner=demo])')).toHaveCount(0)
  await expect(page.getByText('Live times delayed')).toHaveCount(0)
  expect(await visibleLiveClaims(page)).toEqual([])
}

export function seedConnectingSuite({
  path,
  departures,
  pin,
  prepare,
  cookie,
}: {
  /** A board page with an SSR seed. */
  path: string
  /** Matches the board's own departures requests (URL glob). */
  departures: string
  /** Routes the departures so a row is due and live at any hour: the apps' tests/upcoming.ts. */
  pin: (context: BrowserContext) => Promise<unknown>
  /** Runs before the first load (e.g. dismissing a first-run selector). */
  prepare?: (page: Page) => Promise<unknown>
  /** A cookie the seed needs (ferry home's first saved trip, THE-118 PR 8), set for the server render too. */
  cookie?: { name: string; value: string }
}) {
  const url = `${path}${path.includes('?') ? '&' : '?'}rt=stale`
  const withCookie = async (context: BrowserContext) => {
    if (cookie) await context.addCookies([{ ...cookie, url: test.info().project.use.baseURL as string }])
  }

  test.describe('R32-RT1: a stale SSR seed while its own refetch is out', () => {
    // page.route only sees requests the service worker doesn't answer.
    test.use({ serviceWorkers: 'block' })

    /** Holds the board's own departures requests until `release`, then answers them live or still stale. */
    async function hold(context: BrowserContext, answer: 'live' | 'stale') {
      await pin(context)
      let release = () => {}
      const released = new Promise<void>((r) => (release = r))
      let asked = 0
      // Registered last, so it runs before pin.
      await context.route(departures, async (route) => {
        asked++
        await released
        const u = new URL(route.request().url())
        if (answer === 'live') u.searchParams.delete('rt')
        return route.fallback({ url: u.toString() }).catch(() => {})
      })
      return { release, asked: () => asked }
    }

    test('the server render says Connecting…, not OFFLINE, and claims nothing', async ({ context }) => {
      await withCookie(context)
      const html = await (await context.request.get(url)).text()
      expect(html).toContain('data-connection="connecting"')
      expect(html).not.toContain('>OFFLINE<')
      expect(html).not.toMatch(/data-banner="(?!demo")/)
      expect(html).not.toContain('Live times delayed')
    })

    test('pending while the first answer is held, then LIVE once it arrives', async ({ page, context }) => {
      await withCookie(context)
      await prepare?.(page)
      const gate = await hold(context, 'live')
      const t0 = Date.now()
      await page.goto(url)
      await expectConnecting(page)
      // Hydrated and the board's own request is out: still pending, never OFFLINE or LIVE.
      await expect.poll(gate.asked).toBeGreaterThan(0)
      await expectConnecting(page)
      await page.waitForTimeout(Math.max(0, HOLD_MS - (Date.now() - t0)))
      await expectConnecting(page)
      gate.release()
      await expect(page.locator('header [data-live-claim]').first()).toBeVisible({ timeout: 5_000 })
      await expect(page.locator('header').getByText('OFFLINE', { exact: true })).toHaveCount(0)
      await expect(page.locator('[data-banner=stale]')).toHaveCount(0)
    })

    test('a stale first answer of its own: OFFLINE and "Live times delayed", as before', async ({
      page,
      context,
    }) => {
      await withCookie(context)
      await prepare?.(page)
      const gate = await hold(context, 'stale')
      await page.goto(url)
      await expect.poll(gate.asked).toBeGreaterThan(0)
      await expectConnecting(page)
      gate.release()
      await expect(page.locator('header').getByText('OFFLINE', { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      })
      await expect(page.locator('[data-banner=stale]').first()).toBeVisible()
      await expect(page.locator('header [data-connection=connecting]')).toHaveCount(0)
      expect(await visibleLiveClaims(page)).toEqual([])
    })
  })
}

const SIZES = [
  ['390×844 touch', 'phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['1280×900', 'desktop', { viewport: { width: 1280, height: 900 } }],
  ['1440×900', 'desktop', { viewport: { width: 1440, height: 900 } }],
] as const

/** seedConnectingSuite for each board, at each size (each size in one project only, so it runs once). */
export function seedConnectingSizes(
  boards: Array<{ name: string } & Parameters<typeof seedConnectingSuite>[0]>,
) {
  for (const [size, project, use] of SIZES)
    test.describe(size, () => {
      test.beforeEach(() =>
        test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
      )
      test.use(use)
      for (const { name, ...board } of boards) test.describe(name, () => seedConnectingSuite(board))
    })
}
