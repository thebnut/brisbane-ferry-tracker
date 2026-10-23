/**
 * Pages with no live data of their own claim nothing in the header (Dev, 23 Oct): neither LIVE nor OFFLINE while
 * online, as BrisbaneTransit's header. A page with live data still says LIVE, and the header keeps its height without
 * the pill.
 */
import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const IDLE: [string, string][] = [
  ['/whats-new', "what's new"],
  ['/terms', 'terms'],
  ['/privacy', 'privacy'],
  ['/no-such-page', 'the error page'],
]

/** The page's own LIVE board (the home boards), for the control and the header height. */
const LIVE_PAGE = '/'

/** React has hydrated the header (its element carries a fiber). */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const header = document.querySelector('header')
    return header != null && Object.keys(header).some((k) => k.startsWith('__reactFiber'))
  })
}

async function headerHeight(page: Page) {
  return (await page.locator('header').boundingBox())?.height ?? 0
}

for (const [name, viewport] of [
  ['390 touch', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['1280', { viewport: { width: 1280, height: 900 } }],
] as const) {
  test.describe(`no LIVE pill without live data (${name})`, () => {
    test.use(viewport)

    test(`control: ${LIVE_PAGE} still says LIVE`, async ({ page, context }) => {
      await pinUpcoming(context)
      await page.goto(LIVE_PAGE)
      await expect(page.locator('header').getByText('LIVE', { exact: true })).toBeVisible()
    })

    for (const [path, label] of IDLE) {
      test(`${label} (${path}): no pill in the server HTML or after hydration, header height unchanged`, async ({
        page,
        context,
        request,
      }) => {
        const html = await (await request.get(path)).text()
        const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'))
        expect(header).toContain('<header')
        expect(header).not.toContain('data-live-claim')
        expect(header).not.toContain('>LIVE<')
        expect(header).not.toContain('>OFFLINE<')

        await pinUpcoming(context)
        await page.goto(LIVE_PAGE)
        await expect(page.locator('header').getByText('LIVE', { exact: true })).toBeVisible()
        const liveHeight = await headerHeight(page)

        const errors: string[] = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(path)
        await hydrated(page)
        const top = page.locator('header')
        await expect(top).toBeVisible()
        await expect(top.locator('[data-live-claim]')).toHaveCount(0)
        await expect(top.getByText('LIVE', { exact: true })).toHaveCount(0)
        await expect(top.getByText('OFFLINE', { exact: true })).toHaveCount(0)
        await expect(top.getByText('Connecting…', { exact: true })).toHaveCount(0)
        expect(await headerHeight(page)).toBe(liveHeight)
        // React #418/#423 would be a hydration mismatch.
        expect(errors.filter((e) => /418|423|hydrat/i.test(e))).toEqual([])
        // Nothing in the header overflows the page.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          viewport.viewport.width,
        )
      })
    }

    test(`offline: ${IDLE[0][1]} still says OFFLINE`, async ({ page, context }) => {
      await page.goto(IDLE[0][0])
      await hydrated(page)
      await context.setOffline(true)
      await expect(page.locator('header').getByText('OFFLINE', { exact: true })).toBeVisible()
      await expect(page.locator('header [data-live-claim]')).toHaveCount(0)
      await context.setOffline(false)
    })
  })
}
