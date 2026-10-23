/**
 * THE-118 PR 6, one trip-detail layout for every mode:
 *  - a board row opens the trip page (ferry now has one: /ferry/trip/:tripInstance?from=&to=, no details sheet), and
 *    "‹ {place}" goes back to the board where it was scrolled to;
 *  - the summary (tile, kicker, "To {headsign}", countdown, status line), up to three facts, and "Your trip" starting
 *    at your stop, with the earlier stops and those past your destination collapsed;
 *  - never a "—", "Not reported" or "Not reporting" anywhere on the page;
 *  - the dock's star saves the place you board at, plus the destination when `?to=` is known;
 *  - an expired or unknown trip shows a friendly note that links back to the board (a 404, not an error page);
 *  - the train's live marker still moves down the line.
 * Nothing here depends on the time of day: the trip is picked by its stops, and no countdown or row wording is
 * asserted. The marker test crafts its trip's times around the page clock.
 */
import type { TripResponse, TripStop } from '@bft/core/contract'
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

interface Mode {
  mode: 'ferry' | 'train' | 'bus'
  board: string
  /** The board's own rows (not the desktop return board's). */
  rows: string
  place: string
  kicker: RegExp
  /** The stop you board at and the one you get off at, as the trip's stops name them. */
  key: (s: TripStop) => string | undefined
  from: string
  to: string | null
  /** The saved favourites after tapping the dock's star. */
  storage: string
  saved: (stored: unknown) => boolean
  gone: string
  /** The place the expired trip's note links back to (a bus stop the page can't name: its stop number). */
  gonePlace: string
}

const MODES: Mode[] = [
  {
    mode: 'ferry',
    board: '/ferry/terminal/bulimba?to=riverside',
    rows: '[data-board=outbound] a[href*="/ferry/trip/"]',
    place: 'Bulimba',
    kicker: /CityCat|ferry/i,
    key: (s) => s.stopId,
    from: '317584',
    to: '317590',
    storage: 'bft-ferry-favourites',
    saved: (v) => (v as Array<{ from: string; to: string | null }>).some((f) => f.from === '317584' && f.to === '317590'),
    gone: '/ferry/trip/no-such-trip@20200101?from=bulimba&to=riverside',
    gonePlace: 'Bulimba',
  },
  {
    mode: 'train',
    board: '/train/station/central?to=bowen-hills',
    rows: '[data-board=central] a[href*="/train/trip/"]',
    place: 'Central',
    kicker: /line|City trains/,
    key: (s) => s.stationKey,
    from: 'central',
    to: 'bowen-hills',
    storage: 'bft-train-favourites',
    saved: (v) => (v as Array<{ from: string; to: string | null }>).some((f) => f.from === 'central' && f.to === 'bowen-hills'),
    gone: '/train/trip/no-such-trip@20200101?from=central',
    gonePlace: 'Central',
  },
  {
    mode: 'bus',
    board: '/bus/stop/10802',
    rows: 'main a[href*="/bus/trip/"]',
    place: 'Cultural Centre',
    kicker: /^(Metro|CityGlider|BUZ|Bus)$/i,
    key: (s) => s.stopId,
    from: '10802',
    to: null,
    storage: 'bft-bus-saved',
    saved: (v) => (v as Array<{ id: string }>).some((s) => s.id === '10802'),
    gone: '/bus/trip/no-such-trip@20200101?from=10802',
    gonePlace: 'Stop 010802',
  },
]

const tripOf = async (request: APIRequestContext, mode: string, href: string) => {
  const id = decodeURIComponent(new URL(href, 'http://x').pathname.split('/').pop() as string)
  const res = await request.get(`/__fixtures/v1/${mode}/trips/${encodeURIComponent(id)}`)
  return res.ok() ? ((await res.json()) as TripResponse) : null
}

/**
 * The board's row whose trip has stops before yours (and, with a destination, after it): the last such row, so the
 * board has to scroll to reach it. Its index among the rows.
 */
async function pickRow(page: Page, request: APIRequestContext, m: Mode): Promise<number> {
  const links = page.locator(m.rows)
  await expect(links.first()).toBeVisible()
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href') as string))
  for (let i = hrefs.length - 1; i >= 0; i--) {
    const t = await tripOf(request, m.mode, hrefs[i] as string)
    if (!t) continue
    const b = t.stops.findIndex((s) => m.key(s) === m.from)
    const a = m.to ? t.stops.findIndex((s, j) => j > b && m.key(s) === m.to) : -1
    if (b > 0 && (!m.to || (a > b && a < t.stops.length - 1))) return i
  }
  throw new Error(`no ${m.mode} row with stops before and after`)
}

const NO_PLACEHOLDERS = /—|Not reported|Not reporting/

function suite(phone: boolean) {
  for (const m of MODES)
    test.describe(m.mode, () => {
      test('row → trip: summary, facts and "Your trip" from your stop; back keeps the scroll', async ({
        page,
        request,
      }) => {
        await page.goto(m.board)
        await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
        const i = await pickRow(page, request, m)
        const row = page.locator(m.rows).nth(i)
        // The board's lazy parts (star, alert count) are in: no layout shift moves the scroll after it is measured.
        await expect(page.locator('[data-board-header] [data-star]')).toBeVisible()
        await page.waitForLoadState('networkidle')
        await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
        const y = await page.evaluate(() => scrollY)
        expect(y, 'the board is scrolled to the row').toBeGreaterThan(0)
        await row.click()
        await page.waitForURL(new RegExp(`/${m.mode}/trip/`))

        // The summary: tile, kicker, "To {headsign}", the countdown or clock, the status line; 1 to 3 facts.
        const summary = page.locator('[data-trip-summary]')
        await expect(summary.getByRole('heading', { level: 1 })).toHaveText(/^To /)
        await expect(summary.locator('[data-kicker]')).toHaveText(m.kicker)
        await expect(summary.locator('[data-trip-status]')).toHaveText(/Live|Scheduled|Cancelled|Status unknown/)
        const facts = summary.locator('[data-trip-facts] [data-fact]')
        await expect(facts.first()).toHaveAttribute('data-fact', 'Departs')
        expect(await facts.count()).toBeLessThanOrEqual(3)
        if (m.to) await expect(summary.locator('[data-fact=Arrives]')).toBeVisible()
        else await expect(summary.locator('[data-fact=Journey]')).toBeVisible()

        // "Your trip" starts at your stop: earlier stops collapsed above, later ones (with a destination) below.
        const trip = page.locator('[data-your-trip]')
        const stops = trip.getByRole('list', { name: 'Stops on your trip' }).locator(':scope > li[data-kind]')
        await expect(stops.first()).toHaveAttribute('data-mine', 'board')
        await expect(stops.first()).toContainText(m.place)
        const earlier = trip.locator('[data-collapsed=earlier]')
        await expect(earlier).toHaveText(/^▴ \d+ earlier stops?$/)
        await expect(earlier).toHaveAttribute('aria-expanded', 'false')
        if (m.to) {
          await expect(stops.last()).toHaveAttribute('data-mine', 'alight')
          await expect(trip.locator('[data-collapsed=later]')).toHaveText(/^▾ \d+ later stops?$/)
        } else await expect(trip.locator('[data-collapsed=later]')).toHaveCount(0)
        const shown = await stops.count()
        const n = Number((await earlier.textContent())?.match(/\d+/)?.[0])
        await earlier.click()
        await expect(earlier).toHaveAttribute('aria-expanded', 'true')
        await expect(stops).toHaveCount(shown + n)
        if (m.to) await trip.locator('[data-collapsed=later]').click()

        // Never an empty placeholder, collapsed stops included.
        await expect(page.locator('main')).not.toContainText(NO_PLACEHOLDERS)

        // The dock: Track on map and the star, pinned above the tab bar on phones, inline on desktop.
        const dock = page.locator('[data-trip-dock]')
        await expect(dock.getByRole('link', { name: 'Track on map' })).toBeVisible()
        expect(await dock.evaluate((el) => getComputedStyle(el).position)).toBe(phone ? 'fixed' : 'static')

        // Back: "‹ {place}" (the app bar's on phones, the page's on desktop) returns to the board, scrolled as left.
        const back = phone
          ? page.locator('header').getByRole('link', { name: new RegExp(`^${m.place}`) })
          : page.locator('main a:has([data-trip-back])')
        await expect(back).toBeVisible()
        await expect(back).toHaveText(new RegExp(m.place))
        await back.click()
        await expect(page).toHaveURL(m.board)
        // Restored once the board has laid out again (its lazy parts can shift it for a moment first).
        await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(40)
      })

      test('the dock star saves the place you board at (with ?to=)', async ({ page, request }) => {
        await page.goto(m.board)
        const i = await pickRow(page, request, m)
        await page.locator(m.rows).nth(i).click()
        await page.waitForURL(new RegExp(`/${m.mode}/trip/`))
        await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
        const star = page.locator('[data-trip-dock] [data-star]')
        await expect(star).toHaveAttribute('aria-pressed', 'false')
        await star.click()
        await expect(star).toHaveAttribute('aria-pressed', 'true')
        const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '[]'), m.storage)
        expect(m.saved(stored), JSON.stringify(stored)).toBe(true)
      })

      test('an expired trip shows a friendly note that links back to the board', async ({ page }) => {
        const res = await page.goto(m.gone)
        expect(res?.status()).toBe(404)
        const gone = page.locator('[data-trip-gone]')
        await expect(gone.getByRole('heading', { name: 'This trip has finished' })).toBeVisible()
        const link = gone.getByRole('link', { name: `See departures from ${m.gonePlace}` })
        await expect(link).toBeVisible()
        await expect(page.locator('main')).not.toContainText(NO_PLACEHOLDERS)
        // No LIVE claim for a trip that has gone.
        await expect(page.locator('header [data-connection=live]')).toHaveCount(0)
        await link.click()
        await expect(page).toHaveURL(new RegExp(`^[^?]*${m.board.split('?')[0]}`))
      })
    })

  for (const m of MODES)
    test(`${m.mode}: the inline map only while GPS is known`, async ({ page, context, request }) => {
      await page.clock.install({ time: Date.now() })
      await page.goto(m.board)
      const i = await pickRow(page, request, m)
      const href = (await page.locator(m.rows).nth(i).getAttribute('href')) as string
      // The trip's polls: a fresh live answer with a vehicle at the boarding stop, then the same without one.
      let gps = true
      await context.route(`**/__fixtures/v1/${m.mode}/trips/**`, async (route) => {
        try {
          const res = await route.fetch()
          const t = (await res.json()) as TripResponse
          const at = t.stops.find((s) => m.key(s) === m.from) ?? (t.stops[0] as TripStop)
          const vehicle = gps
            ? { id: 'fx-v', label: '1907', lat: -27.47, lon: 153.02, ts: Math.floor(Date.now() / 1000), stopId: at.stopId, status: 'STOPPED_AT' }
            : null
          await route.fulfill({
            response: res,
            json: { ...t, rtState: 'live', rtSourceTimestamp: Math.floor(Date.now() / 1000), generatedAt: Date.now(), vehicle },
          })
        } catch (error) {
          if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
        }
      })
      await page.goto(href)
      await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
      await page.clock.fastForward('00:16')
      await expect(page.locator('[data-trip-map]')).toHaveCount(1)
      await expect(page.locator('[data-trip-status]')).toContainText('GPS')
      gps = false
      await page.clock.fastForward('00:16')
      await expect(page.locator('[data-trip-map]')).toHaveCount(0)
      await expect(page.locator('[data-trip-status]')).not.toContainText('GPS')
    })

  for (const [mode, board, rows] of [
    ['ferry', '/ferry/terminal/bulimba', '[data-board=outbound] [data-testid=departure] a'],
    ['bus', '/bus/stop/10802', 'main [data-testid=departure] a'],
  ] as const)
    test(`${mode}: "More departures" is still open after a trip and back`, async ({ page }) => {
      await page.goto(board)
      await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
      const more = page.getByRole('button', { name: /More departures/ }).first()
      test.skip(!(await more.isVisible()), 'no more departures at this hour')
      const before = await page.locator(rows).count()
      await more.click()
      await expect.poll(() => page.locator(rows).count()).toBeGreaterThan(before)
      const opened = await page.locator(rows).count()
      const row = page.locator(rows).last()
      await row.evaluate((el) => el.scrollIntoView({ block: 'center' }))
      const y = await page.evaluate(() => scrollY)
      await row.click()
      await page.waitForURL(new RegExp(`/${mode}/trip/`))
      await page.goBack()
      await expect(page).toHaveURL(board)
      await expect(page.locator(rows)).toHaveCount(opened)
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(y - 40)
    })

  test('the train live marker still moves down the line', async ({ page, context, request }) => {
    const nowMs = Date.now()
    const T = Math.floor(nowMs / 1000)
    await page.clock.install({ time: nowMs })
    const m = MODES[1] as Mode
    await page.goto(m.board)
    const i = await pickRow(page, request, m)
    const href = (await page.locator(m.rows).nth(i).getAttribute('href')) as string
    // The trip's polls: you board at Central 10 s after the page clock started, then 4 minutes between stops.
    await context.route('**/__fixtures/v1/train/trips/**', async (route) => {
      try {
        const res = await route.fetch()
        const t = (await res.json()) as TripResponse
        const b = t.stops.findIndex((s) => s.stationKey === 'central')
        const stops = t.stops.map((s, j) => {
          const at = T + 10 + (j - b) * 240
          return {
            ...s,
            schedArr: j === 0 ? null : at - 30,
            schedDep: j === t.stops.length - 1 ? null : at,
            estArr: null,
            estDep: null,
            status: 'scheduled' as const,
          }
        })
        await route.fulfill({ response: res, json: { ...t, status: 'scheduled', vehicle: null, stops } })
      } catch (error) {
        if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
      }
    })
    await page.goto(href)
    await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
    // The first poll brings the crafted trip: the train has just left Central.
    await page.clock.fastForward('00:30')
    const capsule = page.locator('[data-your-trip] [data-train-position]')
    await expect(capsule).toBeVisible()
    const first = Number(await capsule.getAttribute('data-train-position'))
    await page.clock.fastForward('01:30')
    await expect.poll(async () => Number(await capsule.getAttribute('data-train-position'))).toBeGreaterThan(first)
  })
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  suite(true)
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  suite(false)
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  suite(false)
})
