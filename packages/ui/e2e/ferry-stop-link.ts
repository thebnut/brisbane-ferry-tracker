/**
 * R36-F1 (Dev, smoke round 36): old `?stop=<stop id>` links (the legacy site's, still shared in the wild) open that
 * terminal's board again, as `?from=` links do (R3-F2, THE-118 PR 5), with "To" when the origin reaches it and the
 * link's other parameters kept. `stop` takes a stop id or a slug; with both, a known `from` wins. Run on ferry home
 * (BrisbaneTransit's /ferry and the standalone ferry site's /) at 390×844 touch, 1280×900 and 1440×900.
 *
 * The board's old map links (`?map=1[&trip=]`, on ferry home or a terminal board) open the live ferry map (THE-118
 * PR 9) on that terminal, keeping the link's other parameters (e.g. `utm_*`) too.
 */
import { expect, type Page, test } from '@playwright/test'

const SIZES = [
  ['390×844 touch', 'phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['1280×900', 'desktop', { viewport: { width: 1280, height: 900 } }],
  ['1440×900', 'desktop', { viewport: { width: 1440, height: 900 } }],
] as const

/** [link query, board path and query, origin, "To" or null]. */
const LINKS: Array<[string, string, string, string | null]> = [
  ['stop=317584', '/terminal/bulimba', 'Bulimba', null],
  ['stop=317584&to=317590', '/terminal/bulimba?to=riverside', 'Bulimba', 'Riverside'],
  ['stop=bulimba&to=riverside', '/terminal/bulimba?to=riverside', 'Bulimba', 'Riverside'],
  // Across the river.
  ['stop=317589&to=317581', '/terminal/sydney-street?to=dockside', 'Sydney Street', 'Dockside'],
  [
    'stop=317584&to=317590&utm_source=legacy',
    '/terminal/bulimba?to=riverside&utm_source=legacy',
    'Bulimba',
    'Riverside',
  ],
  ['from=317583&stop=317584&to=317590', '/terminal/hawthorne?to=riverside', 'Hawthorne', 'Riverside'],
]

/** [old map link (a query on ferry home, or a board path and query), the map's query]. */
const MAP_LINKS: Array<[string, string]> = [
  ['?map=1&utm_source=x', '?utm_source=x'],
  [
    '?stop=317584&to=317590&map=1&trip=abc%4020200101&utm_source=x',
    '?terminal=bulimba&trip=abc%4020200101&utm_source=x',
  ],
  ['/terminal/bulimba?map=1', '?terminal=bulimba'],
  [
    '/terminal/bulimba?to=riverside&map=1&trip=abc%4020200101&utm_source=x&utm_campaign=y',
    '?terminal=bulimba&trip=abc%4020200101&utm_source=x&utm_campaign=y',
  ],
]

const board = (page: Page) => page.locator('[data-board=outbound]')

/** `home`: ferry home's path ('/ferry' or '/'); `base`: where its boards are ('/ferry' or ''). */
export function ferryStopLinkSuite({ home, base }: { home: string; base: string }) {
  const at = (q: string) => `${home}?${q}`
  for (const [size, project, use] of SIZES)
    test.describe(size, () => {
      test.beforeEach(() =>
        test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
      )
      test.use(use)
      test.describe('R36-F1: old ?stop= links open the terminal board', () => {
        for (const [q, to, origin, dest] of LINKS)
          test(`${home}?${q}`, async ({ page }) => {
            await page.goto(at(q))
            await expect(page).toHaveURL(`${base}${to}`)
            await expect(board(page)).toHaveAttribute(
              'aria-label',
              dest ? `${origin} to ${dest}` : `Departures from ${origin}`,
            )
            await expect(page.locator('[data-board-header]').getByRole('heading').first()).toHaveText(origin)
          })

        test('a server redirect (302), so it works before any script', async ({ request }) => {
          const res = await request.get(at('stop=317584&to=317590'), { maxRedirects: 0 })
          expect(res.status()).toBe(302)
          expect(res.headers().location).toBe(`${base}/terminal/bulimba?to=riverside`)
        })

        test('an unknown stop stays ferry home', async ({ page }) => {
          await page.goto(at('stop=nope&to=317590'))
          await expect(page).toHaveURL(at('stop=nope&to=317590'))
          await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ferry')
        })
      })

      test.describe('old ?map=1 links open the live ferry map, keeping their other parameters', () => {
        const link = (l: string) => (l.startsWith('?') ? `${home}${l}` : `${base}${l}`)
        for (const [l, q] of MAP_LINKS)
          test(link(l), async ({ page }) => {
            await page.goto(link(l))
            await expect(page).toHaveURL(`${base}/map${q}`)
            await expect(page.locator('[data-map-page=ferry]')).toBeVisible()
          })

        test('server redirects (302), so they work before any script', async ({ request }) => {
          for (const [l, q] of MAP_LINKS) {
            const res = await request.get(link(l), { maxRedirects: 0 })
            expect(res.status(), l).toBe(302)
            expect(res.headers().location, l).toBe(`${base}/map${q}`)
          }
        })
      })
    })
}
