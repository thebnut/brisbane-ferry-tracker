/**
 * A board header's alert count shows a number only while its answer is recent (ALERTS_MAX_AGE_MS, Codex release
 * review of f943ff5). With the page's clock moved four minutes on (a tab hidden that long, a device asleep), then the
 * tab shown again and the refetch that starts still unanswered, each mode's board says plain "Alerts", never the old
 * answer's number; the fresh answer brings the number back.
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
 * Each mode's board. Bus counts from the page's own loader answer first (stop 10802 has detours on its routes in the
 * fixtures); Train and Ferry ask after hydration, and their answer gets an open-ended alert they count.
 */
const BOARDS: Array<[mode: string, path: string]> = [
  ['bus', '/bus/stop/10802'],
  ['train', '/train/station/central'],
  ['ferry', '/ferry/terminal/bulimba?to=riverside'],
]

function suite() {
  for (const [mode, path] of BOARDS)
    test(`${mode}: an answer four minutes old shows "Alerts" until a fresh one arrives`, async ({ page }) => {
      let hold: Promise<void> | null = null
      let release = () => {}
      let asked = 0
      await page.route('**/v1/alerts*', async (route) => {
        asked++
        const held = hold
        if (held) await held
        const res = await route.fetch()
        const body = await res.json()
        if (mode === 'bus') return route.fulfill({ response: res, json: body })
        const open = {
          id: 'e2e-open',
          header: 'Open notice',
          activePeriods: [],
          routes: [],
          stops: [],
          modes: [mode],
        }
        return route.fulfill({ response: res, json: { ...body, alerts: [...body.alerts, open] } })
      })
      await page.goto(path)
      await ready(page)
      const link = page.locator('[data-board-alerts] a').locator('visible=true').first()
      await expect(link).toHaveText(/^\d+ alerts?$/)

      // Every alerts request from here on waits. The page's clock goes four minutes on with no timer run (a hidden
      // tab's; installed only now: installed before the page loads, the fake clock gives its scripts a
      // `performance.timeOrigin` of -1), then the tab is shown again, and the board refetches.
      hold = new Promise((r) => {
        release = r
      })
      const before = asked
      await page.clock.install()
      await page.clock.fastForward('04:00')
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
      await expect.poll(() => asked).toBeGreaterThan(before)
      // That answer hasn't arrived: the old one is too old to count.
      await expect(link).toHaveText('Alerts')

      // The fresh answer brings the number back.
      hold = null
      release()
      await expect(link).toHaveText(/^\d+ alerts?$/)
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
