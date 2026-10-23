/**
 * A cancelled train's "next" suggestion heads the same way (release 15 review, P2). At Sunnybank with no destination,
 * a cancelled Beenleigh-bound train must never point at a Bowen Hills-bound train on the same (Beenleigh) line: plain
 * "Cancelled" when no train the same way is on the board, else the next one that is.
 *
 * The board's own polls get crafted rows relative to now (the first paint is the fixtures'), so the test doesn't
 * depend on the time of day. The page clock is installed at the real time so the 15 s poll can be fast-forwarded.
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { expect, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

/** Sunnybank platform 1 (the committed network data). */
const SUNNYBANK_P1 = '600209'

function row(i: number, at: number, toBeenleigh: boolean, over: Partial<Departure> = {}): Departure {
  return {
    tripInstance: `sb-${i}@x`,
    stopSequence: 10,
    route: toBeenleigh
      ? { id: 'BRBN-1', short: 'BRBN', long: 'Brisbane City - Beenleigh', color: 'D53E45' }
      : { id: 'BNBR-1', short: 'BNBR', long: 'Beenleigh - Brisbane City', color: 'D53E45' },
    headsign: toBeenleigh ? 'Beenleigh station' : 'Bowen Hills station',
    directionId: toBeenleigh ? 0 : 1,
    stopId: SUNNYBANK_P1,
    platform: '1',
    schedDep: at,
    estDep: at,
    schedArrTo: null,
    estArrTo: null,
    status: 'live',
    gps: false,
    vehicleId: null,
    ...over,
  }
}

async function open(page: Page, sameWayToo: boolean) {
  const nowMs = Date.now()
  const nowS = Math.floor(nowMs / 1000)
  await page.clock.install({ time: nowMs })
  await page.context().route('**/__fixtures/v1/train/stops/sunnybank/departures*', async (route) => {
    try {
      const res = await route.fetch()
      const body = (await res.json()) as DeparturesResponse
      const departures = [
        row(0, nowS + 120, true, { status: 'cancelled', estDep: null }),
        // The other way on the same line, sooner than any train the same way.
        row(1, nowS + 5 * 60, false),
        ...(sameWayToo ? [row(2, nowS + 11 * 60 + 30, true)] : []),
      ]
      await route.fulfill({
        response: res,
        json: { ...body, rtState: 'live', rtSourceTimestamp: nowS, generatedAt: Date.now(), departures },
      })
    } catch (error) {
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })
  await page.goto('/train/station/sunnybank')
  await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
  // The board's first poll brings the crafted rows.
  await page.clock.fastForward('00:16')
  const rows = page.locator('[data-board=sunnybank]').first().getByTestId('departure')
  await expect(rows.first()).toHaveAttribute('data-status', 'cancelled', { timeout: 15_000 })
  await expect(rows).toHaveCount(sameWayToo ? 3 : 2)
  return rows
}

function suite() {
  test('a cancelled train never points at one going the other way on its line', async ({ page }) => {
    const rows = await open(page, false)
    await expect(rows.nth(1).getByTestId('destination')).toHaveText('Bowen Hills')
    await expect(rows.nth(0).locator('[data-row-status]')).toHaveText('Cancelled')
  })

  test('it points at the next train the same way, past one going the other way', async ({ page }) => {
    const rows = await open(page, true)
    await expect(rows.nth(0).locator('[data-row-status]')).toHaveText(
      /^Cancelled · next Beenleigh line in 1[01] min$/,
    )
  })
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  suite()
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  suite()
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  suite()
})
