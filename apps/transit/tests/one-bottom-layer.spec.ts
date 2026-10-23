/**
 * THE-118 PR 3, one bottom layer: no Train or Bus section bar, so on phones the five Mode Tabs are the only fixed bar
 * at the bottom and nothing covers the end of a page. What the bars held moved: Stations and Find a stop to the
 * search on mode home, Map to a chip on each board and mode home, Alerts to the count in each board's header, Home to
 * the mode tab (tapping the active tab again goes back to it). The first-visit prompt is inline on My Transit only.
 */
import { FIRST_VISIT, prompt } from '@bft/ui/e2e/onboarding.ts'
import { expect, type Page, test } from '@playwright/test'

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

/** Every transit mode page with a fixed URL. */
const PAGES = [
  '/ferry',
  '/ferry/terminal/bulimba',
  '/train',
  '/train/stations',
  '/train/station/central',
  '/train/alerts',
  '/train/map',
  '/bus',
  '/bus/stop/10802',
  '/bus/alerts',
  '/bus/route/333',
  '/bus/nearby',
  '/bus/map',
  '/bus/about',
]

/** The boards, each with the alerts page its count opens. */
const BOARDS: Array<[board: string, alerts: RegExp]> = [
  ['/ferry', /\/alerts\?mode=ferry$/],
  ['/ferry/terminal/bulimba', /\/alerts\?mode=ferry$/],
  ['/train/station/central', /\/train\/alerts$/],
  ['/bus/stop/10802', /\/bus\/alerts$/],
]

/** A board's own Map chip, and each mode home's (Ferry's home is its board). */
const MAPS = [
  '/ferry',
  '/ferry/terminal/bulimba',
  '/train',
  '/train/station/central',
  '/bus',
  '/bus/stop/10802',
]

/** A page under each mode, and the mode's tab. */
const UNDER: Array<[page: string, tab: string, home: string]> = [
  ['/ferry/terminal/bulimba', 'Ferry', '/ferry'],
  ['/train/station/central', 'Train', '/train'],
  ['/bus/stop/10802', 'Bus', '/bus'],
]

const ready = (page: Page) => expect(page.locator('html[data-hydrated]')).toHaveCount(1)

/** Visible fixed elements whose box reaches the lowest 40% of the viewport (the bottom layers). */
const bottomLayers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const s = getComputedStyle(el)
        if (s.position !== 'fixed' || s.visibility === 'hidden' || s.display === 'none') return false
        const r = el.getBoundingClientRect()
        return r.height > 0 && r.width > 0 && r.bottom > innerHeight * 0.6 && r.top < innerHeight
      })
      // Count each layer once: not its fixed descendants.
      .filter((el, _, all) => !all.some((o) => o !== el && o.contains(el)))
      .map((el) => el.getAttribute('aria-label') ?? el.tagName.toLowerCase()),
  )

/** The Mode Tabs: the bottom bar on phones, the header's pills on desktop. */
const modeTabs = (page: Page) => page.getByRole('navigation', { name: 'Modes' }).locator('visible=true')

function suite(phone: boolean) {
  for (const path of PAGES)
    test(`${path}: no section bar${phone ? ', the Mode Tabs are the only bottom layer' : ''}`, async ({
      page,
    }) => {
      await page.goto(path)
      await ready(page)
      await expect(page.getByRole('navigation', { name: /sections/i })).toHaveCount(0)
      if (!phone) return
      // The bus home's thumb-height "Find a stop" sheet is gone too.
      await expect(page.getByText('Find a stop', { exact: true })).toHaveCount(0)
      await expect.poll(() => bottomLayers(page)).toEqual(['Modes'])
    })

  if (phone)
    for (const path of PAGES.filter((p) => !p.endsWith('/map')))
      test(`${path}: scrolled to the bottom, nothing fixed covers the last row or the footer`, async ({
        page,
      }) => {
        await page.goto(path)
        await ready(page)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const bar = await modeTabs(page).boundingBox()
        expect(bar).not.toBeNull()
        const targets = [
          page.getByTestId('departure').locator('visible=true').last(),
          page.locator('footer').locator('visible=true').getByRole('link').last(),
        ]
        for (const t of targets) {
          if ((await t.count()) === 0) continue
          // Scroll the page so the target's bottom meets the bar's top: the page must have the room for that, and
          // then the target is what a tap at its centre reaches.
          const result = await t.evaluate((el, barTop) => {
            window.scrollBy(0, el.getBoundingClientRect().bottom - barTop)
            const r = el.getBoundingClientRect()
            const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            return { bottom: r.bottom, hit: at != null && (el === at || el.contains(at)) }
          }, bar?.y ?? 0)
          expect(result.bottom, path).toBeLessThanOrEqual((bar?.y ?? 0) + 0.5)
          expect(result.hit, path).toBe(true)
        }
      })

  for (const [board, alerts] of BOARDS)
    test(`${board}: the board header's alert count opens the alerts`, async ({ page }) => {
      await page.goto(board)
      await ready(page)
      const link = page.locator('[data-board-alerts] a').locator('visible=true').first()
      await expect(link).toHaveText(/^(\d+ alerts?|Alerts)$/)
      await link.click()
      await expect(page).toHaveURL(alerts)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })

  if (!phone)
    test('a train trip on desktop: both boards (and the return one) show their alert count (Codex r2)', async ({
      page,
    }) => {
      await page.goto('/train/station/roma-street?to=indooroopilly')
      await ready(page)
      // The station's in the board header (THE-118 PR 5), the return board's beside its title.
      await expect(page.locator('[data-board-header] [data-board-alerts] a')).toBeVisible()
      await expect(page.locator('[data-board="indooroopilly"] [data-board-alerts] a')).toBeVisible()
    })

  test('the ferry count opens Alerts on the Ferry chip', async ({ page }) => {
    await page.goto('/alerts?mode=ferry')
    await expect(page.getByRole('button', { name: /^Ferry/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  for (const path of MAPS)
    test(`${path}: a Map chip`, async ({ page }) => {
      await page.goto(path)
      await ready(page)
      const map = page
        .getByRole('link', { name: 'Map', exact: true })
        .or(page.getByRole('button', { name: /^(Map|Show stops on a map)$/ }))
        .locator('visible=true')
        .first()
      await expect(map).toBeVisible()
      const box = await map.boundingBox()
      // The boards' existing Map chips (PillButton, 36 px) stay until the filter row is rebuilt in THE-118 PR 5; the
      // mode homes' new ones are at least 44 px.
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(path === '/train' || path === '/bus' ? 44 : 36)
    })

  test('Train home: the search finds a station and opens its board', async ({ page }) => {
    await page.goto('/train')
    await ready(page)
    const search = page.getByRole('combobox', { name: 'Find a station' })
    await search.fill('Centr')
    await page
      .getByRole('option', { name: /^Central/ })
      .first()
      .click()
    await expect(page).toHaveURL(/\/train\/station\/central$/)
  })

  test('Bus home: the search at the top finds a stop and opens its board', async ({ page }) => {
    await page.goto('/bus')
    await ready(page)
    const search = page.getByRole('searchbox', { name: 'Stop name or number' })
    await expect(search).toBeInViewport()
    await search.fill('cultural centre')
    const first = page.getByRole('list', { name: 'Matching stops' }).getByRole('link').first()
    await expect(first).toBeVisible({ timeout: 20_000 })
    await first.click()
    await expect(page).toHaveURL(/\/bus\/stop\/\d+$/)
  })

  for (const [path, tab, home] of UNDER)
    test(`${path}: tapping the active ${tab} tab again goes back to ${home}`, async ({ page }) => {
      await page.goto(path)
      await ready(page)
      const link = modeTabs(page).getByRole('link', { name: tab, exact: true })
      await expect(link).toHaveAttribute('aria-current', 'page')
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${home}$`))
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

/** The first-visit prompt: inline at the top of My Transit, never over a board (a fresh browser). */
for (const [size, project, use] of [
  ['390×844 touch', 'phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['1280×900', 'desktop', { viewport: { width: 1280, height: 900 } }],
  ['1440×900', 'desktop', { viewport: { width: 1440, height: 900 } }],
] as const)
  test.describe(`first-visit prompt, ${size}`, () => {
    onlyIn(project)
    test.use({ ...use, storageState: FIRST_VISIT })

    test('inline at the top of My Transit, in the page flow', async ({ page }) => {
      await page.goto('/')
      await expect(prompt(page)).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('main [data-onboarding-prompt]')).toHaveCount(1)
      expect(await prompt(page).evaluate((el) => getComputedStyle(el).position)).toBe('static')
      // Above the Ask box: the first thing under the greeting.
      const order = await page.evaluate(() => {
        const p = document.querySelector('[data-onboarding-prompt]') as Element
        const ask = document.querySelector('main form, main [role="search"]')
        return ask ? p.compareDocumentPosition(ask) & Node.DOCUMENT_POSITION_FOLLOWING : 1
      })
      expect(order).toBeTruthy()
    })

    for (const [board] of BOARDS)
      test(`${board}: no prompt over the board`, async ({ page }) => {
        await page.goto(board)
        await ready(page)
        await page.waitForTimeout(3_500)
        await expect(prompt(page)).toHaveCount(0)
      })
  })
