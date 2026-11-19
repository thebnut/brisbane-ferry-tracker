/**
 * The ferry journey planner ("Where are you going?", rider feedback 19 Nov 2026): From first, then To; Popular chips
 * fill To; landmark search resolves to the terminal to get off at; a pair with no direct ferry shows where to change;
 * the last destination is kept on the device; a terminal board offers "Plan a trip there". Location is never asked
 * for by itself. Nothing here depends on the time of day (no row's countdown is asserted).
 */
import { allowLocation, NEW_FARM } from '@bft/ui/e2e/locate-me.ts'
import { expect, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block' })

const planner = (page: Page) => page.locator('[data-planner]')
const place = (page: Page, which: 'from' | 'to') => planner(page).locator(`[data-planner-place=${which}]`)
const sheet = (page: Page, name: string) => page.getByRole('dialog', { name })
/** Bulimba is closed for works until mid-December 2026 (apps/ferry/app/lib/journey.ts CLOSED). */
const bulimbaClosed = () => new Date(Date.now() + 10 * 3_600_000).toISOString().slice(0, 10) <= '2026-12-15'

test('From comes first, then To; Popular fills To and asks where you start; the board says "Your trip"', async ({
  page,
}) => {
  await page.goto('/ferry')
  await expect(place(page, 'from')).toContainText('Choose start')
  await expect(place(page, 'to')).toContainText('Pick a terminal')
  const [from, to] = await Promise.all([place(page, 'from').boundingBox(), place(page, 'to').boundingBox()])
  expect(from && to && from.y < to.y).toBe(true)
  const popular = planner(page).getByRole('list', { name: 'Popular destinations' })
  await expect(popular.getByRole('button')).toContainText(['South Bank', 'Howard Smith Wharves'])
  if (bulimbaClosed()) await expect(popular.getByRole('button', { name: 'Bulimba' })).toHaveCount(0)

  await popular.getByRole('button', { name: 'Howard Smith Wharves' }).click()
  const start = sheet(page, 'Where are you starting?')
  await expect(start).toContainText('Going to Howard Smith Wharves')
  await expect(start.getByRole('button', { name: 'Use my location' })).toBeVisible()
  // Each start says whether a ferry runs straight there.
  await expect(start.locator('[data-place-option="317588"]')).toContainText('direct')
  await expect(start.locator('[data-place-option="317581"]')).toContainText('change at Sydney Street')
  await start.locator('[data-place-option="317588"]').click()

  await expect(page).toHaveURL('/ferry/terminal/new-farm-park?to=howard-smith-wharves')
  const header = page.locator('[data-board-header]')
  await expect(header.locator('[data-kicker]')).toHaveText('Your trip · Direct ferry')
  await expect(
    header.getByRole('heading', { name: 'From New Farm Park to Howard Smith Wharves' }),
  ).toBeAttached()
  const row = page.locator('[data-board=outbound] [data-testid=departure]').first()
  await expect(row.getByTestId('destination')).toHaveText(/^towards /)
})

test('the last destination is remembered on this device', async ({ page }) => {
  await page.goto('/ferry')
  await planner(page).getByRole('button', { name: 'South Bank' }).click()
  await expect(sheet(page, 'Where are you starting?')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(place(page, 'to')).toContainText('South Bank')
  expect(await page.evaluate(() => localStorage.getItem('bft-ferry-last-to'))).toBe('south-bank')
})

test('landmarks resolve to the terminal to get off at; a stadium off the river points to the train', async ({
  page,
}) => {
  await page.goto('/ferry')
  await place(page, 'to').click()
  const dest = sheet(page, 'Where are you going?')
  const search = dest.getByLabel('Search terminals and places')
  await search.fill('eat street')
  const card = dest.locator('[data-landmark=eat-street]')
  await expect(card).toContainText('Get off at Northshore Hamilton for Eat Street')
  await search.fill('suncorp')
  const stadium = dest.locator('[data-landmark=suncorp-stadium]')
  await expect(stadium).toContainText('Not near a ferry terminal. Take the train to Milton or Roma Street')
  await expect(stadium.getByRole('link')).toHaveAttribute('href', '/train/station/milton')
  await search.fill('eat street')
  await card.click()
  await expect(place(page, 'to')).toContainText('Northshore Hamilton')
  await expect(place(page, 'to')).toContainText('for Eat Street')
  await expect(sheet(page, 'Where are you starting?')).toBeVisible()
})

test('no direct ferry: "Change at" with both legs and a link to each board', async ({ page }) => {
  // A board's "Somewhere else?" link: the start set, then the destination sheet.
  await page.goto('/ferry/terminal/dockside')
  await page.locator('[data-destination-field]').click()
  await sheet(page, 'Where are you going from Dockside?')
    .getByRole('link', { name: /Plan a trip with a change/ })
    .click()
  await expect(page).toHaveURL('/ferry/?plan=from&start=dockside')
  await expect(place(page, 'from')).toContainText('Dockside')
  await sheet(page, 'Where are you going?').locator('[data-place-option="321208"]').click()
  await expect(page).toHaveURL('/ferry/?plan=from&start=dockside')
  const plan = planner(page).locator('[data-plan=change]')
  await expect(plan).toContainText('No direct ferry. Change at Sydney Street.')
  await expect(plan.locator('[data-leg="1"]')).toHaveAttribute(
    'href',
    '/ferry/terminal/dockside?to=sydney-street',
  )
  await expect(plan.locator('[data-leg="2"]')).toHaveAttribute(
    'href',
    '/ferry/terminal/sydney-street?to=howard-smith-wharves',
  )
  // Each leg's next ferry, once the times are in (or why not).
  await expect(plan.locator('[data-leg]')).not.toContainText(['Getting times…', 'Getting times…'], {
    timeout: 15_000,
  })
})

test('"Plan a trip there" on a terminal board opens the planner with To set', async ({ page }) => {
  await page.goto('/ferry/terminal/howard-smith-wharves')
  const header = page.locator('[data-board-header]')
  await expect(header.locator('[data-kicker]')).toHaveText('Departures from')
  await expect(header).toContainText('Every ferry leaving here')
  await expect(header.locator('[data-plan-there]')).toHaveText(
    'Not at Howard Smith Wharves? Plan a trip there ›',
  )
  await header.getByRole('link', { name: 'Plan a trip there ›' }).click()
  await expect(page).toHaveURL('/ferry/?plan=to&to=howard-smith-wharves')
  await expect(place(page, 'to')).toContainText('Howard Smith Wharves')
  await expect(place(page, 'from')).toContainText('Choose start')
})

test('location allowed: From is the nearest terminal, and a Popular pick opens the board at once', async ({
  page,
  context,
}) => {
  await allowLocation(context, NEW_FARM)
  await page.goto('/ferry')
  await expect(place(page, 'from')).toContainText('New Farm Park')
  await expect(place(page, 'from')).toContainText('Nearest terminal')
  await planner(page).getByRole('button', { name: 'South Bank' }).click()
  await expect(page).toHaveURL('/ferry/terminal/new-farm-park?to=south-bank')
})

test('location is never asked for by itself', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as Window & { __geo?: number }
    w.__geo = 0
    const geo = navigator.geolocation
    if (geo)
      geo.getCurrentPosition = () => {
        w.__geo = (w.__geo ?? 0) + 1
      }
  })
  await page.goto('/ferry')
  await planner(page).getByRole('button', { name: 'South Bank' }).click()
  await expect(sheet(page, 'Where are you starting?')).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { __geo?: number }).__geo)).toBe(0)
})

test.describe('360 px', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })
  for (const url of [
    '/ferry',
    '/ferry/terminal/howard-smith-wharves',
    '/ferry/terminal/new-farm-park?to=howard-smith-wharves',
  ])
    test(`${url}: one page width, every planner and header control at least 44 px`, async ({ page }) => {
      await page.goto(url)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const targets = page.locator(
        '[data-planner] button, [data-destination-field], [data-board-header] button',
      )
      for (const h of await targets.evaluateAll((els) =>
        els.filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().height),
      ))
        expect(h).toBeGreaterThanOrEqual(44)
    })
})
