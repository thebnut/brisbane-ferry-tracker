/**
 * THE-118 PR 3 (Codex r4): a board header's alert count comes only from a current alerts answer. A board that starts
 * from a non-live answer, and whose next request fails, says plain "Alerts" (still linking to the alerts), never the
 * old answer's "1 alert" for as long as the requests keep failing.
 */
import { expect, type Page, test } from '@playwright/test'

// page.route only sees requests the service worker doesn't answer.
test.use({ serviceWorkers: 'block' })

const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

const ready = (page: Page) => expect(page.locator('html[data-hydrated]')).toHaveCount(1)

/**
 * Each mode's board. Bus seeds its count from the page's own render (`?rt=unavailable`: the cold, non-live answer);
 * Train and Ferry ask after hydration, and their first answer is made non-live here.
 */
const BOARDS: Array<[mode: string, path: string, alerts: RegExp]> = [
  ['bus', '/bus/stop/10802?rt=unavailable', /\/bus\/alerts$/],
  ['train', '/train/station/central', /\/train\/alerts$/],
  ['ferry', '/ferry/terminal/bulimba?to=riverside', /\/alerts\?mode=ferry$/],
]

function suite() {
  for (const [mode, path, alerts] of BOARDS)
    test(`${mode}: a non-live alerts answer and a failed refetch show plain "Alerts", no number`, async ({
      page,
    }) => {
      let answered = mode === 'bus'
      let failed = 0
      await page.route('**/v1/alerts*', async (route) => {
        if (answered) {
          failed++
          return route.abort('internetdisconnected')
        }
        answered = true
        const res = await route.fetch()
        const body = await res.json()
        // An old answer with an open-ended alert the board would count, were the answer current.
        const old = {
          id: 'e2e-old',
          header: 'Old notice',
          activePeriods: [],
          routes: [],
          stops: [],
          modes: [mode],
        }
        return route.fulfill({
          response: res,
          json: {
            ...body,
            rtState: 'unavailable',
            generatedAt: Date.now() - 600_000,
            alerts: [...body.alerts, old],
          },
        })
      })
      // Ferry's count asks again at its next minute's poll.
      test.setTimeout(120_000)
      await page.goto(path)
      await ready(page)
      // The board asks again (R27-RT1 for the seeded bus board; on Train, coming back to the page once the answer is
      // stale; on Ferry, its next poll), and that fails.
      if (mode === 'train') {
        await page.waitForTimeout(11_000)
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      }
      await expect.poll(() => failed, { timeout: 80_000 }).toBeGreaterThan(0)
      const link = page.locator('[data-board-alerts] a').locator('visible=true').first()
      await expect(link).toHaveText('Alerts')
      // And it stays that way (past the failed request's retry).
      await page.waitForTimeout(2_500)
      await expect(link).toHaveText('Alerts')
      await expect(link).toHaveAttribute('href', alerts)
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
