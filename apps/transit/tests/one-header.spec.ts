/**
 * THE-118 PR 2, one header: every mode page has the one BrisbaneTransit header (a back link or the emblem, the LIVE
 * state and an icon-only gear on phones; the lockup, mode pills, Alerts, LIVE and the gear on desktop), the status
 * line refreshes, and the header starts as "Connecting…": LIVE only after a successful answer, OFFLINE only when a
 * request can't reach the network (or the browser is offline), and SCHEDULED, a neutral pill, when the device is
 * online but the answer isn't live: an HTTP error, a stale feed (19 Nov 2026: that said OFFLINE before).
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

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
  const emblem = header.getByRole('link', { name: 'BrisbaneTransit, home' })
  if (phone) {
    await expect(header.getByRole('navigation', { name: 'Modes' })).toBeHidden()
    if (back) {
      const link = header.getByRole('link', { name: back })
      await expect(link).toBeVisible()
      await expect(emblem).toBeHidden()
      expect(stops[0]).toMatch(back)
    } else {
      await expect(emblem).toBeVisible()
      expect(stops[0]).toBe('BrisbaneTransit, home')
    }
  } else {
    await expect(emblem).toBeVisible()
    await expect(header.getByRole('navigation', { name: 'Modes' }).getByRole('link')).toHaveCount(5)
    await expect(header.getByRole('link', { name: 'Alerts' })).toBeVisible()
    expect(stops).toContain('BrisbaneTransit, home')
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

  for (const path of [
    '/ferry/terminal/bulimba?to=riverside',
    '/train/station/central',
    '/bus/stop/10802',
    '/bus/route/333',
  ])
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
    (await gate) === 'abort' ? route.abort('failed') : route.fallback(),
  )
  await page.addInitScript(() => {
    const seen: Record<string, number> = {}
    ;(window as unknown as { __seen: Record<string, number> }).__seen = seen
    new MutationObserver(() => {
      for (const s of ['live', 'offline', 'scheduled'])
        if (!(s in seen) && document.querySelector(`header [data-connection="${s}"]`))
          seen[s] = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  const seen = () => page.evaluate(() => (window as unknown as { __seen: Record<string, number> }).__seen)
  return { release: open, seen }
}

/** Records in the page when each header state first shows (a flash shorter than a poll included). */
async function watchStates(page: Page) {
  await page.addInitScript(() => {
    const seen: Record<string, number> = {}
    ;(window as unknown as { __states: Record<string, number> }).__states = seen
    new MutationObserver(() => {
      for (const s of ['live', 'offline', 'scheduled'])
        if (!(s in seen) && document.querySelector(`header [data-connection="${s}"]`))
          seen[s] = performance.now()
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  return () => page.evaluate(() => (window as unknown as { __states: Record<string, number> }).__states)
}

/** Answers a stop's departures with the real response marked as a stale feed (the device is online). */
const staleFeed = (context: BrowserContext, glob = '**/__fixtures/v1/bus/stops/*/departures*') =>
  context.route(glob, async (route) => {
    try {
      const res = await route.fetch()
      await route.fulfill({ response: res, json: { ...(await res.json()), rtState: 'stale' } })
    } catch (error) {
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })

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
    // My Transit reports its saved cards the same way (P-3167c11-O1/H1): never OFFLINE while a card waits.
    name: 'My Transit',
    path: '/saved',
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
      // A home is LIVE only over a live row it shows (R36-L1): one is due and live at any hour.
      await pinUpcoming(context, home.glob)
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

    test(`${home.name}: online + API error (HTTP 503) => SCHEDULED, never OFFLINE`, async ({
      page,
      context,
    }) => {
      await page.addInitScript(home.seed)
      // The request reaches a server that answers an error: the device is online.
      await context.route(home.glob, (route) =>
        route.fulfill({ status: 503, json: { error: 'upstream unavailable', detail: 'test' } }),
      )
      const seen = await watchStates(page)
      await page.goto(home.path)
      await expect(page.locator('header [data-connection="scheduled"]')).toHaveText('SCHEDULED', {
        timeout: 15_000,
      })
      await page.waitForTimeout(1_000)
      expect(Object.keys(await seen())).toEqual(['scheduled'])
    })

    test(`${home.name}: Connecting… → OFFLINE when the request can't reach the network`, async ({
      page,
      context,
    }) => {
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

  test('bus stop: LIVE → SCHEDULED, not OFFLINE, when a refresh answers a stale feed', async ({
    page,
    context,
  }) => {
    await page.goto('/bus/stop/10802')
    await expect(page.locator('header [data-connection="live"]')).toBeVisible()
    // Online + stale feed: the request reaches the API, whose live feed is behind.
    await staleFeed(context)
    await page.locator('[data-status-line]').click()
    await expect(page.locator('header [data-connection="scheduled"]')).toHaveText('SCHEDULED')
    await expect(page.locator('header [data-connection="offline"]')).toHaveCount(0)
    await expect(page.locator('[data-status-line]')).toHaveText(/^Scheduled/)
  })

  test('My Transit: a saved stop the timetable no longer has (404) never makes the page OFFLINE', async ({
    page,
    context,
  }) => {
    // 19 Nov 2026: Bulimba ferry terminal closed for works, the API 404s it ("unknown stop").
    await page.addInitScript(() => {
      localStorage.setItem('bft-ferry-favourites', JSON.stringify([{ from: '317584', to: '317590' }]))
      localStorage.setItem(
        'bft-bus-saved',
        JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
      )
    })
    await pinUpcoming(context, '**/__fixtures/v1/bus/stops/*/departures*')
    await context.route('**/__fixtures/v1/ferry/stops/317584/departures*', (route) =>
      route.fulfill({ status: 404, json: { error: 'unknown stop', detail: '317584' } }),
    )
    const seen = await watchStates(page)
    await page.goto('/saved')
    await expect(page.getByText('No services in the current timetable.', { exact: false })).toBeVisible({
      timeout: 15_000,
    })
    // The bus card is live: the closed stop claims nothing, so the page is LIVE.
    await expect(page.locator('header [data-connection="live"]')).toHaveText('LIVE')
    expect(Object.keys(await seen())).toEqual(['live'])
    await expect(page.getByText("Live times aren't loading", { exact: false })).toHaveCount(0)
  })

  test("bus stop: LIVE → OFFLINE when a refresh can't reach the network", async ({ page, context }) => {
    await page.goto('/bus/stop/10802')
    await expect(page.locator('header [data-connection="live"]')).toBeVisible()
    await context.route('**/__fixtures/v1/bus/stops/*/departures*', (route) => route.abort('failed'))
    await page.locator('[data-status-line]').click()
    await expect(page.locator('header [data-connection="offline"]')).toBeVisible()
    await expect(page.locator('[data-status-line]')).toHaveText(/^Offline/)
  })
}

test.describe('360 px phone', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true })
  test('the header still fits with the wider SCHEDULED pill', async ({ page, context }) => {
    await page.goto('/bus/stop/10802')
    await expect(page.locator('header [data-connection="live"]')).toBeVisible()
    await staleFeed(context)
    await page.locator('[data-status-line]').click()
    const pill = page.locator('header [data-connection="scheduled"]')
    await expect(pill).toHaveText('SCHEDULED', { timeout: 15_000 })
    const box = await pill.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360)
    await expect(
      page.locator('header').getByRole('button', { name: 'Settings', exact: true }),
    ).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)
  })
})

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
