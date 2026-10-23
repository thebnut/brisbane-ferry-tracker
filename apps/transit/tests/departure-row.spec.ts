/**
 * THE-118 PR 4, one departure row on every board: a tile (bus route, train platform on the line colour, ferry service
 * circle), the destination, a status line (a dot, one word, one fact) and the big countdown. No LIVE/GPS/SCHEDULED
 * pills; a "Tomorrow · Fri 23 Oct" divider instead of a date on every time; the soonest row you can board gets the
 * orange border (never a cancelled one); a train platform change rings the tile; wide boards add an arrival column.
 *
 * Each board's own polls get crafted rows relative to now (the first paint is the fixtures'): a cancelled service,
 * then live on time, live late, a live platform change (train) and one after Brisbane midnight. The page clock is
 * installed, so the board's 15 s poll can be fast-forwarded, at noon Brisbane time on the day the suite runs: well clear
 * of midnight, so only the last row is tomorrow's whatever the time (at the real time, the rows 4–20 minutes ahead
 * crossed midnight from about 23:52). `DEPARTURE_ROW_AT` (an ISO time) runs it as if at another time.
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { expect, type Locator, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

const DAY = 86_400
const TZ = 'Australia/Brisbane'
/** Brisbane midnight at the start of the next day, epoch s (UTC+10, no DST). */
const nextMidnight = (s: number) => Math.floor((s + 10 * 3600) / DAY) * DAY - 10 * 3600 + DAY
/** Noon Brisbane time on the day the suite runs (or on `DEPARTURE_ROW_AT`'s day), epoch ms. */
const pinnedNowMs = () => {
  const runS = Math.floor((Date.parse(process.env.DEPARTURE_ROW_AT ?? '') || Date.now()) / 1000)
  return (nextMidnight(runS) - DAY + 12 * 3600) * 1000
}

interface Mode {
  name: string
  url: string
  glob: string
  /** The first board's rows. */
  board: (page: Page) => Locator
  /** Does a wide row show the arrival column? (A destination is set.) */
  arrives: boolean
  route: (i: number) => Departure['route']
}

const MODES: Mode[] = [
  {
    name: 'bus',
    url: '/bus/stop/10802',
    glob: '**/__fixtures/v1/bus/stops/*/departures*',
    board: (page) => page.getByRole('list', { name: 'Departures' }).first(),
    arrives: false,
    route: (i) => ({ id: `6${i}-1`, short: `6${i}` }),
  },
  {
    name: 'train',
    url: '/train/station/central?to=ferny-grove',
    glob: '**/__fixtures/v1/train/**/departures*',
    board: (page) => page.locator('[data-board=central]').getByRole('list'),
    arrives: true,
    route: () => ({ id: 'BRFG-1', short: 'BRFG', long: 'Brisbane City - Ferny Grove', color: 'D53E45' }),
  },
  {
    name: 'ferry',
    url: '/ferry/terminal/bulimba',
    glob: '**/__fixtures/v1/ferry/stops/*/departures*',
    board: (page) => page.locator('[data-board=outbound]').getByRole('list', { name: 'Departures' }),
    arrives: true,
    route: (i) => (i === 1 ? { id: 'F11-1', short: 'F11' } : { id: 'F1-1', short: 'F1' }),
  },
]

/** The crafted board: cancelled, live on time, live 3 min late, live platform change, then tomorrow 5:10 am. */
function rows(mode: Mode, template: Departure, nowS: number): Departure[] {
  const row = (i: number, at: number, over: Partial<Departure>): Departure => ({
    ...template,
    tripInstance: `row-${mode.name}-${i}@x`,
    route: mode.route(i),
    headsign: mode.name === 'train' ? 'Ferny Grove station' : `Destination ${i}`,
    platform: mode.name === 'train' ? '2' : null,
    scheduledPlatform: undefined,
    schedDep: at,
    estDep: at,
    schedArrTo: at + 20 * 60,
    estArrTo: at + 20 * 60,
    status: 'live',
    gps: false,
    stopsAfter: mode.name === 'train' ? template.stopsAfter : undefined,
    ...over,
  })
  const tomorrow = nextMidnight(nowS) + 5 * 3600 + 10 * 60
  return [
    row(0, nowS + 120, { status: 'cancelled', estDep: null, estArrTo: null }),
    row(1, nowS + 4 * 60 + 30, {}),
    row(2, nowS + 9 * 60, { estDep: nowS + 12 * 60 }),
    row(3, nowS + 20 * 60, mode.name === 'train' ? { platform: '4', scheduledPlatform: '1' } : {}),
    row(4, tomorrow, { status: 'scheduled', estDep: null, estArrTo: null }),
  ]
}

async function open(page: Page, mode: Mode) {
  const nowMs = pinnedNowMs()
  const nowS = Math.floor(nowMs / 1000)
  await page.clock.install({ time: nowMs })
  await page.context().route(mode.glob, async (route) => {
    try {
      const res = await route.fetch()
      const body = (await res.json()) as DeparturesResponse
      const template = body.departures[0] as Departure
      await route.fulfill({
        response: res,
        json: {
          ...body,
          rtState: 'live',
          rtSourceTimestamp: nowS,
          // On the page's clock (the poll is 16 s in), as the source time is.
          generatedAt: nowMs + 16_000,
          departures: rows(mode, template, nowS),
        },
      })
    } catch (error) {
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })
  await page.goto(mode.url)
  await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
  // The board's first poll brings the crafted rows.
  await page.clock.fastForward('00:16')
  const list = mode.board(page)
  await expect(list.getByTestId('departure').first()).toHaveAttribute('data-status', 'cancelled', {
    timeout: 15_000,
  })
  return { list, rows: list.getByTestId('departure'), tomorrowS: nextMidnight(nowS) + 5 * 3600 + 10 * 60 }
}

function suite(wide: boolean) {
  for (const mode of MODES) {
    test.describe(mode.name, () => {
      test('row anatomy: tile, destination, dot and word, one fact, countdown; no pills', async ({
        page,
      }) => {
        const { list, rows } = await open(page, mode)
        const live = rows.nth(1)
        await expect(live.getByTestId('destination')).toHaveText(
          mode.name === 'train' ? 'Ferny Grove' : 'Destination 1',
        )
        const status = live.locator('[data-row-status]')
        await expect(status.locator('[data-dot=live]')).toHaveCount(1)
        await expect(status.locator('[data-live-claim]')).toContainText('Live · on time')
        await expect(live.locator('[data-countdown]')).toContainText(/^4 min\d/)
        await expect(rows.nth(2).locator('[data-row-status]')).toContainText('Live · 3 min late')
        await expect(rows.nth(0).locator('[data-row-status]')).toContainText(/^Cancelled/)
        await expect(rows.nth(0).locator('[data-dot=cancelled]')).toHaveCount(1)
        // A cancelled service never counts down: a dash and the struck clock time.
        await expect(rows.nth(0).locator('[data-countdown]')).toHaveAttribute('data-countdown', 'cancelled')
        await expect(rows.nth(4).locator('[data-row-status]')).toContainText(/^Scheduled/)
        // The tile per mode.
        if (mode.name === 'bus') await expect(live).toContainText('Route 61')
        if (mode.name === 'ferry') {
          await expect(live.locator('[data-tile=service]')).toHaveText('Service F11')
          await expect(live.locator('[data-tile=service]')).toHaveClass(/rounded-full.*bg-ferry-orange-aa/)
          await expect(rows.nth(2).locator('[data-tile=service]')).toHaveClass(/bg-aqua-text/)
        }
        if (mode.name === 'train') {
          await expect(live.getByRole('img', { name: 'Platform 2' })).toHaveText('PLAT2')
          await expect(live.locator('[data-row-status]')).toContainText(
            wide ? 'Ferny Grove line' : /arr \d+:\d\d [ap]m/,
          )
          // No stopping strip on the row any more.
          await expect(list.locator('[data-compact]')).toHaveCount(0)
        }
        // The row's accessible name is its content: it says Live while live, and nothing live while the live guard
        // hides the claims (an unconditional aria-label would, Codex r2).
        const target = live.locator('a, button').first()
        await expect(target).toHaveAccessibleName(/Live/)
        await page.evaluate(() => document.documentElement.setAttribute('data-live-unconfirmed', ''))
        await expect(target).not.toHaveAccessibleName(/Live|on time/)
        await expect(target).toHaveAccessibleName(mode.name === 'train' ? /Ferny Grove/ : /Destination 1/)
        await page.evaluate(() => document.documentElement.removeAttribute('data-live-unconfirmed'))
        // The line (or "express") stays in the name on phones, where "arr …" is the visible fact (Codex r3).
        if (mode.name === 'train') await expect(target).toHaveAccessibleName(/Ferny Grove line/)
        // No LIVE/GPS/SCHEDULED pills, and no "(23/10)" date tags.
        await expect(list.locator('[data-badge]')).toHaveCount(0)
        await expect(list).not.toContainText(/\(\d\d\/\d\d\)|LIVE|SCHEDULED|GPS ·/)
      })

      test('the soonest row you can board is highlighted, never the cancelled one', async ({ page }) => {
        const { rows } = await open(page, mode)
        await expect(rows.nth(0)).not.toHaveAttribute('data-highlighted')
        await expect(rows.nth(1)).toHaveAttribute('data-highlighted', 'true')
        await expect(rows.and(page.locator('[data-highlighted]'))).toHaveCount(1)
      })

      test('a "Tomorrow" divider above the first of tomorrow’s rows', async ({ page }) => {
        const { list, rows, tomorrowS } = await open(page, mode)
        const day = new Date(tomorrowS * 1000)
          .toLocaleDateString('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
          .replace(/,/g, '')
        const dividers = list.locator('[data-day-divider]')
        await expect(dividers).toHaveCount(1)
        await expect(dividers).toHaveText(`Tomorrow · ${day}`)
        // In the same list item as the row it heads.
        await expect(dividers.locator('xpath=..').getByTestId('departure')).toHaveAttribute(
          'data-status',
          'scheduled',
        )
        await expect(rows.nth(4).locator('[data-countdown]')).toContainText(/5:10 am/)
      })

      test(`the arrival column ${wide && mode.arrives ? 'shows' : 'is hidden'}; no occupancy on the row`, async ({
        page,
      }) => {
        const { list, rows } = await open(page, mode)
        const extra = rows.nth(1).locator('[data-extra]')
        if (mode.arrives) {
          await expect(extra).toHaveCount(1)
          if (wide) await expect(extra).toBeVisible()
          else await expect(extra).toBeHidden()
          if (wide) await expect(extra).toContainText(/Arrives \d+:\d\d [ap]m/)
        } else {
          await expect(extra).toHaveCount(0)
        }
        await expect(list).not.toContainText(/seats|standing|Empty|Full|occupancy/i)
      })

      if (mode.name === 'train')
        test('a platform change rings the tile in orange and says so', async ({ page }) => {
          const { rows } = await open(page, mode)
          const tile = rows.nth(3).getByRole('img', { name: 'Platform 4, changed from 1' })
          await expect(tile).toHaveAttribute('data-platform-change', 'true')
          const ring = await tile.evaluate((el) => getComputedStyle(el).boxShadow)
          expect(ring).toContain('rgb(194, 65, 12)')
          await expect(rows.nth(3).locator('[data-row-status]')).toContainText(
            'Live · platform changed from 1',
          )
          await expect(rows.nth(1).getByRole('img', { name: 'Platform 2' })).not.toHaveAttribute(
            'data-platform-change',
          )
        })

      if (mode.name === 'train')
        test('platform tiles: the number reads on its line colour (4.5:1)', async ({ page }) => {
          await page.goto('/train/station/central')
          const tiles = page.locator('[data-board=central] [role=img][aria-label^=Platform]')
          await expect(tiles.first()).toBeVisible()
          const pairs = await tiles.evaluateAll((els) =>
            els.map((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]),
          )
          expect(pairs.length).toBeGreaterThan(3)
          // On the line colours, not white tiles: Central's board has several lines.
          expect(new Set(pairs.map(([bg]) => bg)).size).toBeGreaterThan(1)
          expect(pairs.some(([bg]) => bg === 'rgb(255, 255, 255)')).toBe(false)
          const lum = (rgb: string) => {
            const [r, g, b] = (rgb.match(/\d+/g) ?? []).slice(0, 3).map((v) => {
              const c = Number(v) / 255
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
            }) as [number, number, number]
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
          }
          for (const [bg, fg] of pairs as Array<[string, string]>) {
            const [hi, lo] = [lum(bg), lum(fg)].sort((a, b) => b - a) as [number, number]
            expect((hi + 0.05) / (lo + 0.05), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
          }
        })
    })
  }
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  suite(false)
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  suite(true)
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  suite(true)
})
