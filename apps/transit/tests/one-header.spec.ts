/**
 * THE-118 PR 2, one header: every mode page has the one BrisbaneTransit header (a back link or the emblem, the LIVE
 * state and an icon-only gear on phones; the lockup, mode pills, Alerts, LIVE and the gear on desktop), the status
 * line refreshes, and the header starts as "Connecting…": LIVE only after a successful answer, OFFLINE only after a
 * failure.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

/** Mode pages and the phone's back link on each (null: a mode home, which shows the emblem). */
const PAGES: Array<[path: string, back: string | null]> = [
  ['/ferry', null],
  ['/ferry/terminal/bulimba', 'Ferry'],
  ['/ferry/privacy', 'Ferry'],
  ['/train', null],
  ['/train/stations', 'Train'],
  ['/train/station/central', 'Train'],
  ['/train/alerts', 'Train'],
  ['/train/map', 'Train'],
  ['/bus', null],
  ['/bus/stop/10802', 'Bus'],
  ['/bus/alerts', 'Bus'],
  ['/bus/route/333', 'Bus'],
  ['/bus/nearby', 'Bus'],
  ['/bus/map', 'Bus'],
  ['/bus/about', 'Bus'],
]

/** Trip pages, opened from their board: the back link goes to that place. */
const TRIPS: Array<[board: string, back: RegExp]> = [
  ['/train/station/central', /^Central/],
  ['/bus/stop/10802', /^Cultural Centre/],
]

/** Accessible names of the first `n` elements the Tab key reaches. */
async function tabStops(page: Page, n = 12): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  const names: string[] = []
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab')
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return (el?.getAttribute('aria-label') ?? el?.textContent ?? '').trim()
      }),
    )
  }
  return names
}

async function expectOneHeader(page: Page, phone: boolean, back: string | RegExp | null) {
  await expect(page.locator('header')).toHaveCount(1)
  const header = page.locator('header')
  const gear = header.getByRole('button', { name: 'Settings', exact: true })
  await expect(gear).toBeVisible()
  const box = await gear.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)
  // Gear only: no "Settings" text pill anywhere.
  await expect(page.getByText('Settings', { exact: true })).toHaveCount(0)
  // The bar's height: 52 px on phones, 60 px on desktop (plus its border).
  const bar = await header.boundingBox()
  expect(bar?.height).toBeLessThanOrEqual(phone ? 54 : 62)
  const stops = await tabStops(page)
  expect(stops).toContain('Settings')
  const emblem = header.getByRole('link', { name: 'BrisbaneTransit, My Transit' })
  if (phone) {
    await expect(header.getByRole('navigation', { name: 'Modes' })).toBeHidden()
    if (back) {
      const link = header.getByRole('link', { name: back })
      await expect(link).toBeVisible()
      await expect(emblem).toBeHidden()
      expect(stops[0]).toMatch(back)
    } else {
      await expect(emblem).toBeVisible()
      expect(stops[0]).toBe('BrisbaneTransit, My Transit')
    }
  } else {
    await expect(emblem).toBeVisible()
    await expect(header.getByRole('navigation', { name: 'Modes' }).getByRole('link')).toHaveCount(5)
    await expect(header.getByRole('link', { name: 'Alerts' })).toBeVisible()
    expect(stops).toContain('BrisbaneTransit, My Transit')
    expect(stops).toContain('Alerts')
  }
}

function headerTests(phone: boolean) {
  for (const [path, back] of PAGES)
    test(`${path}: one header, gear only, keyboard reachable`, async ({ page }) => {
      await page.goto(path)
      await expectOneHeader(page, phone, back)
    })

  for (const [board, back] of TRIPS)
    test(`trip from ${board}: back link to the place`, async ({ page }) => {
      await page.goto(board)
      await page.locator('a[href*="/trip/"]').first().click()
      await page.waitForURL(/\/trip\//)
      // Desktop opens the trip beside the board (THE-118 PR 7): this checks its own page.
      if (!phone) {
        await page.getByRole('link', { name: 'Open full page' }).click()
        await page.waitForURL(/[?&]full=1/)
      }
      await expectOneHeader(page, phone, back)
      if (phone)
        await expect(page.locator('header').getByRole('link', { name: back })).toHaveAttribute('href', board)
    })

  for (const path of ['/ferry', '/train/station/central', '/bus/stop/10802', '/bus/route/333'])
    test(`${path}: tapping the status line refreshes`, async ({ page }) => {
      await page.goto(path)
      const line = page.locator('[data-status-line]')
      await expect(line).toHaveText(/Live · updated \d+ (s|min) ago/)
      const refetch = page.waitForRequest(/\/v1\/([a-z]+\/stops\/[^/]+\/departures|bus\/vehicles)/)
      await line.click()
      await refetch
    })
}

/**
 * Holds the page's departures requests until `release`, then answers them (`'continue'`) or fails them (`'abort'`).
 * Records in the page when a LIVE or OFFLINE state first shows (a flash shorter than a poll included).
 */
async function holdDepartures(context: BrowserContext, page: Page, glob: string) {
  let open!: (how: 'continue' | 'abort') => void
  const gate = new Promise<'continue' | 'abort'>((r) => {
    open = r
  })
  await context.route(glob, async (route) =>
    (await gate) === 'abort' ? route.abort('failed') : route.continue(),
  )
  await page.addInitScript(() => {
    const seen: Record<string, number> = {}
    ;(window as unknown as { __seen: Record<string, number> }).__seen = seen
    new MutationObserver(() => {
      for (const s of ['live', 'offline'])
        if (!(s in seen) && document.querySelector(`header [data-connection="${s}"]`))
          seen[s] = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  const seen = () => page.evaluate(() => (window as unknown as { __seen: Record<string, number> }).__seen)
  return { release: open, seen }
}

const SAVED_HOMES = [
  {
    name: 'bus home',
    path: '/bus',
    glob: '**/__fixtures/v1/bus/stops/*/departures*',
    seed: () =>
      localStorage.setItem(
        'bft-bus-saved',
        JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
      ),
  },
  {
    name: 'train home',
    path: '/train',
    glob: '**/__fixtures/v1/train/**/departures*',
    seed: () => localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }])),
  },
]

function connectionTests() {
  // Saved stops only on the device (no cookie): the boards fetch their first answer from the browser.
  for (const home of SAVED_HOMES) {
    test(`${home.name}: Connecting… → LIVE, never LIVE before the first answer`, async ({
      page,
      context,
    }) => {
      await page.addInitScript(home.seed)
      const { release, seen } = await holdDepartures(context, page, home.glob)
      await page.goto(home.path)
      const state = page.locator('header [data-connection]')
      await expect(state).toHaveText('Connecting…')
      await expect(state).toHaveAttribute('data-connection', 'connecting')
      expect(await seen()).toEqual({})
      release('continue')
      await expect(page.locator('header [data-connection="live"]')).toHaveText('LIVE')
      expect(Object.keys(await seen())).toEqual(['live'])
    })

    test(`${home.name}: Connecting… → OFFLINE only after a failure`, async ({ page, context }) => {
      await page.addInitScript(home.seed)
      const { release, seen } = await holdDepartures(context, page, home.glob)
      await page.goto(home.path)
      await expect(page.locator('header [data-connection]')).toHaveText('Connecting…')
      // Give a flash time to happen: still Connecting, nothing failed yet.
      await page.waitForTimeout(1_000)
      await expect(page.locator('header [data-connection]')).toHaveText('Connecting…')
      expect(await seen()).toEqual({})
      release('abort')
      await expect(page.locator('header [data-connection="offline"]')).toHaveText('OFFLINE')
      expect(Object.keys(await seen())).toEqual(['offline'])
    })
  }

  test('bus stop: LIVE → OFFLINE when a refresh fails', async ({ page, context }) => {
    await page.goto('/bus/stop/10802')
    await expect(page.locator('header [data-connection="live"]')).toBeVisible()
    await context.route('**/__fixtures/v1/bus/stops/*/departures*', (route) => route.abort('failed'))
    await page.locator('[data-status-line]').click()
    await expect(page.locator('header [data-connection="offline"]')).toBeVisible()
    await expect(page.locator('[data-status-line]')).toHaveText(/^Offline/)
  })
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  headerTests(true)
  connectionTests()
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  headerTests(false)
  connectionTests()
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  headerTests(false)
  connectionTests()
})
