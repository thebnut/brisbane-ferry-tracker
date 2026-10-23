/**
 * THE-118 PR 7, desktop master–detail. At 1024 px and wider every board (ferry terminal, train station, bus stop) is a
 * column beside a panel:
 *  - a row opens its trip in the panel at the trip's URL; back closes it and forward opens it again; the row is marked
 *    (aria-current) and the panel is labelled "Trip details";
 *  - Enter on a row opens the panel and moves focus into it; Esc closes it and gives focus back to the row;
 *  - "Open full page" goes to the trip page without fetching the board or the trip again, and opening or closing the
 *    panel never fetches the board again;
 *  - with no row open the panel shows the return board (a destination is set) or the place's map ("Map unavailable"
 *    without WebGL, the board unharmed);
 *  - a trip URL opened directly shows the board with the panel open;
 *  - from 768 to 1023 px, and on phones, the board is one column and a row opens the trip's full page.
 * Nothing here depends on the time of day: rows are fixtures, picked by position, and no countdown or clock wording is
 * asserted. Polling is held still with the page clock, so the request counts are the navigation's own.
 */
import { disableWebGL, expectMapUnavailable } from '@bft/ui/e2e/no-webgl.ts'
import { expect, type Page, type Request, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

interface Board {
  mode: 'ferry' | 'train' | 'bus'
  url: string
  /** What the idle panel shows on this board. */
  idle: 'return' | 'map'
  /** The board's name in its header. */
  name: string
}

const BOARDS: Board[] = [
  { mode: 'ferry', url: '/ferry/terminal/bulimba?to=riverside', idle: 'return', name: 'Bulimba' },
  { mode: 'ferry', url: '/ferry/terminal/bulimba', idle: 'map', name: 'Bulimba' },
  { mode: 'train', url: '/train/station/central?to=bowen-hills', idle: 'return', name: 'Central' },
  { mode: 'train', url: '/train/station/central', idle: 'map', name: 'Central' },
  { mode: 'bus', url: '/bus/stop/10802', idle: 'map', name: 'Cultural Centre' },
]

const rows = (page: Page) => page.locator('[data-board-column] [data-testid=departure] a')
const panel = (page: Page) => page.getByRole('region', { name: 'Trip details' })
const header = (page: Page) => page.locator('[data-board-header]')
/** The idle panel's content: the return board, or the place's map. */
const idle = (page: Page, kind: Board['idle']) =>
  page.locator(kind === 'return' ? '[data-panel] [data-board]' : '[data-panel] [data-place-map]')

/** The board, hydrated, with its polls held still (the page clock runs only when a test moves it). */
async function openBoard(page: Page, b: Board) {
  await page.clock.install({ time: Date.now() })
  await page.goto(b.url)
  await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
  await expect(rows(page).first()).toBeVisible()
  await page.waitForLoadState('networkidle')
}

/** The API and loader requests a step makes (not scripts, styles, map tiles or fonts). */
function watch(page: Page) {
  const seen: string[] = []
  const on = (r: Request) => {
    const u = new URL(r.url())
    if (u.pathname.includes('/v1/') || u.pathname.endsWith('.data')) seen.push(`${u.pathname}${u.search}`)
  }
  page.on('request', on)
  return {
    take: () => seen.splice(0),
    board: () =>
      seen.filter((u) =>
        /\/departures|\/stops\/|_routes=(ferry|train|bus)%2F(terminal|station|stop)/.test(u),
      ),
  }
}

const tripUrl = (mode: string) => new RegExp(`/${mode}/trip/[^?]+\\?`)

function desktop() {
  for (const b of BOARDS)
    test.describe(`${b.mode} ${b.url}`, () => {
      test('a row opens the panel at the trip URL; back closes it, forward opens it again', async ({
        page,
      }) => {
        await openBoard(page, b)
        await expect(idle(page, b.idle)).toBeVisible()
        const req = watch(page)
        const row = rows(page).first()
        const href = (await row.getAttribute('href')) as string
        await row.click()
        await page.waitForURL(tripUrl(b.mode))
        expect(new URL(page.url()).pathname).toBe(new URL(href, page.url()).pathname)
        await expect(panel(page)).toBeVisible()
        await expect(panel(page).locator('[data-trip-summary]')).toBeVisible()
        // The board is still there beside it, its row marked; no trip page header or back link of its own.
        await expect(header(page)).toContainText(b.name)
        await expect(row).toHaveAttribute('aria-current', 'true')
        await expect(rows(page).and(page.locator('[aria-current]'))).toHaveCount(1)
        await expect(page.locator('[data-trip-back]')).toHaveCount(0)
        await expect(panel(page).getByRole('button', { name: 'Close trip details' })).toBeVisible()
        await expect(panel(page).getByRole('link', { name: 'Open full page' })).toBeVisible()
        expect(req.board(), 'the board is not fetched again when the panel opens').toEqual([])

        await page.goBack()
        await expect(page).toHaveURL(b.url)
        await expect(panel(page)).toHaveCount(0)
        await expect(idle(page, b.idle)).toBeVisible()
        await expect(row).not.toHaveAttribute('aria-current', 'true')
        await page.goForward()
        await page.waitForURL(tripUrl(b.mode))
        await expect(panel(page)).toBeVisible()
        expect(req.board(), 'nor when it closes or opens again').toEqual([])
      })

      test('keyboard: Enter opens the panel and focuses it, Esc closes it back to the row', async ({
        page,
      }) => {
        await openBoard(page, b)
        const row = rows(page).nth(1)
        await row.focus()
        await page.keyboard.press('Enter')
        await page.waitForURL(tripUrl(b.mode))
        await expect(panel(page)).toBeFocused()
        // Tab moves on inside the panel: its first control.
        await page.keyboard.press('Tab')
        await expect(panel(page).getByRole('link', { name: 'Open full page' })).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(page).toHaveURL(b.url)
        await expect(panel(page)).toHaveCount(0)
        await expect(row).toBeFocused()
        // ✕ does the same.
        await page.keyboard.press('Enter')
        await expect(panel(page)).toBeFocused()
        await panel(page).getByRole('button', { name: 'Close trip details' }).click()
        await expect(page).toHaveURL(b.url)
        await expect(row).toBeFocused()
      })

      test('"Open full page" shows the trip page with no board or trip fetch', async ({ page }) => {
        await openBoard(page, b)
        await rows(page).first().click()
        await expect(panel(page).locator('[data-trip-summary]')).toBeVisible()
        const req = watch(page)
        await panel(page).getByRole('link', { name: 'Open full page' }).click()
        await page.waitForURL(/[?&]full=1/)
        await expect(page.locator('[data-trip-summary]')).toBeVisible()
        await expect(panel(page)).toHaveCount(0)
        await expect(header(page)).toHaveCount(0)
        await page.waitForLoadState('networkidle')
        expect(req.take(), 'no loader or API request: the panel and the page share the trip').toEqual([])
        // Its back link returns to the board (the panel was replaced in history).
        await page.locator('main a:has([data-trip-back])').click()
        await expect(page).toHaveURL(b.url)
        await expect(panel(page)).toHaveCount(0)
      })

      test('a trip URL opened directly shows the board with the panel open', async ({ page }) => {
        await openBoard(page, b)
        const href = (await rows(page).first().getAttribute('href')) as string
        await page.goto(href)
        await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
        await expect(panel(page)).toBeVisible()
        await expect(panel(page).locator('[data-trip-summary]')).toBeVisible()
        await expect(header(page)).toContainText(b.name)
        await expect(rows(page).first()).toBeVisible()
        await expect(page.locator('[data-board-column] a[aria-current=true]')).toHaveAttribute('href', href)
        // Refresh keeps it; ✕ opens the board (there is no board behind it in history).
        await page.reload()
        await expect(panel(page)).toBeVisible()
        await panel(page).getByRole('button', { name: 'Close trip details' }).click()
        await expect(page).toHaveURL(b.url)
        await expect(idle(page, b.idle)).toBeVisible()
      })
    })

  test('an expired trip beside the board says so, and ✕ goes back to the board', async ({ page }) => {
    for (const b of BOARDS.filter((x) => x.idle === 'map')) {
      const res = await page.goto(
        `/${b.mode}/trip/no-such-trip@20200101?from=${new URL(b.url, 'http://x').pathname.split('/').pop()}`,
      )
      expect(res?.status()).toBe(404)
      await expect(panel(page).getByRole('heading', { name: 'This trip has finished' })).toBeVisible()
      await expect(panel(page)).not.toContainText(/—|Not reported|Not reporting/)
      await expect(header(page)).toContainText(b.name)
      await panel(page).getByRole('button', { name: 'Close trip details' }).click()
      await expect(page).toHaveURL(b.url)
    }
  })

  test('idle panel: the return board with a destination', async ({ page }) => {
    for (const b of BOARDS.filter((x) => x.idle === 'return')) {
      await openBoard(page, b)
      const ret = idle(page, 'return')
      await expect(ret.locator('[data-testid=departure]').first()).toBeVisible()
      await expect(ret.getByRole('heading', { level: 2 })).toContainText(`→ ${b.name}`)
      await expect(page.locator('[data-place-map]')).toHaveCount(0)
    }
  })

  test('a return-board row opens beside the same board; Esc gives focus back to that row', async ({
    page,
  }) => {
    for (const b of BOARDS.filter((x) => x.idle === 'return')) {
      await openBoard(page, b)
      const req = watch(page)
      const row = idle(page, 'return').locator('[data-testid=departure] a').first()
      await row.focus()
      await page.keyboard.press('Enter')
      await page.waitForURL(tripUrl(b.mode))
      await expect(panel(page)).toBeFocused()
      // The board is the one it was: its own name and rows, not the other end's.
      await expect(header(page)).toContainText(b.name)
      expect(req.board()).toEqual([])
      await page.keyboard.press('Escape')
      await expect(page).toHaveURL(b.url)
      await expect(row).toBeFocused()
      expect(req.board()).toEqual([])
    }
  })

  test("idle panel: the place's map without one", async ({ page }) => {
    for (const b of BOARDS.filter((x) => x.idle === 'map')) {
      await openBoard(page, b)
      await expect(idle(page, 'map')).toBeVisible()
      // The only map on the board.
      await expect(page.locator('[data-place-map]')).toHaveCount(1)
    }
  })

  test('without WebGL the idle map says so and the board stays', async ({ page }) => {
    await disableWebGL(page)
    for (const b of BOARDS.filter((x) => x.idle === 'map')) {
      await openBoard(page, b)
      await expectMapUnavailable(page)
      await expect(rows(page).first()).toBeVisible()
    }
  })
}

/** Below 1024: one column, and a row opens the trip's full page. */
function narrow() {
  for (const b of BOARDS.filter((x) => x.idle === 'return' || x.mode === 'bus'))
    test(`${b.mode} ${b.url}: one column, a row opens the full page`, async ({ page }) => {
      await openBoard(page, b)
      await expect(page.locator('[data-panel]')).toBeHidden()
      await expect(page.locator('[data-place-map]')).toHaveCount(0)
      await rows(page).first().click()
      await page.waitForURL(tripUrl(b.mode))
      await expect(page.locator('[data-trip-summary]')).toBeVisible()
      await expect(panel(page)).toHaveCount(0)
      await expect(header(page)).toHaveCount(0)
    })
}

for (const width of [1024, 1280, 1440])
  test.describe(`${width}×900`, () => {
    onlyIn('desktop')
    test.use({ viewport: { width, height: 900 } })
    desktop()
  })

test.describe('800×900 (768–1023)', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 800, height: 900 } })
  narrow()
})

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  narrow()
})
