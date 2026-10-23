import { expect, type Page, test } from '@playwright/test'

const collectErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  return errors
}

test('station page has departure rows in the server HTML', async ({ request }) => {
  const html = await (await request.get('/station/central')).text()
  expect(html.match(/data-testid="departure"/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
  expect(html).toContain('Next train from Central')
  expect(html).toContain('"@type":"TrainStation"')
})

test('station board: platform tiles on the line colour, countdowns, no strips; hydrates cleanly', async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page)
  await page.goto('/station/roma-street?to=indooroopilly')
  const board = page.locator('[data-board=roma-street]')
  await expect(board.getByTestId('departure').first()).toBeVisible()
  await expect(board.getByRole('img', { name: /Platform/ }).first()).toBeVisible()
  // THE-118 PR 4: the stopping pattern moved to trip detail; the row says the line or "arr …" instead.
  await expect(board.getByRole('list', { name: /Stops from here to/ })).toHaveCount(0)
  await expect(board.locator('[data-row-status]').first()).toContainText(
    /arr \d{1,2}:\d{2} (am|pm)|line|express/,
  )
  await expect(board.locator('[data-countdown]').first()).toBeVisible()
  await expect(page.getByText(/updated \d+ s ago/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('station.png') })
  expect(errors).toEqual([])
})

test('reachable-only picker narrows the board to one destination', async ({ page }) => {
  await page.goto('/station/bowen-hills')
  await page.getByRole('button', { name: 'Going to…' }).click()
  const sheet = page.getByRole('dialog')
  const fg = sheet.locator('[data-line="Ferny Grove"]').first()
  await expect(fg).toBeVisible()
  await expect(
    sheet.locator('[data-line="Doomben"]').getByRole('button', { name: 'Ferny Grove' }),
  ).toHaveCount(0)
  await fg.getByRole('button', { name: 'Ferny Grove', exact: true }).click()
  await expect(page).toHaveURL(/\/station\/bowen-hills\?to=ferny-grove/)
  await expect(page.locator('[data-board=bowen-hills]').getByTestId('departure').first()).toBeVisible()
})

test('service detail shows the stopping pattern and the train', async ({ page }) => {
  await page.goto('/station/central')
  await page.locator('[data-board=central] [data-testid=departure] a').first().click()
  await expect(page).toHaveURL(/\/trip\//)
  // Its own page's h1, or beside the board on desktop (THE-118 PR 7) the panel's h2.
  await expect(page.locator('#trip-title')).toHaveText(/^To /)
  await expect(page.getByRole('list', { name: 'Stops on your trip' })).toBeVisible()
  // TRIP_WS=1 in the test server: updates arrive over the hibernating-WebSocket prototype, polling stops.
  await expect(page.locator('[data-transport=websocket]')).toBeVisible()
})

test('search: fuzzy station name, then a reachable destination', async ({ page }) => {
  await page.goto('/stations')
  const from = page.getByRole('combobox', { name: 'From' })
  await from.fill('bowen hils')
  await page.getByRole('option', { name: 'Bowen Hills' }).click()
  await expect(page).toHaveURL(/from=bowen-hills/)
  await expect(page.getByText('Only stations with a direct train from Bowen Hills are shown.')).toBeVisible()
  await page
    .locator('[data-line="Airport"]')
    .getByRole('button', { name: 'Domestic Airport' })
    .first()
    .click()
  await expect(page.getByTestId('trip-match')).toContainText('Bowen Hills → Domestic Airport')
})

test('alerts: line status board', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByRole('heading', { name: 'Service alerts' })).toBeVisible()
  await expect(page.getByText('Platform change', { exact: true })).toBeVisible()
  await expect(page.getByText('Good service').first()).toBeVisible()
})

test('favourite shows on home and its day is saved for offline', async ({ page, context }) => {
  await page.goto('/station/roma-street?to=indooroopilly')
  await page.getByRole('button', { name: /^Save Roma Street → Indooroopilly to My Transit/ }).click()
  await page.goto('/')
  await expect(page.getByTestId('favourite')).toContainText('Roma Street → Indooroopilly')
  // The rest of today's timetable is saved; how much is left depends on the hour (little near midnight).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const v = JSON.parse(localStorage.getItem('bft-train-offline:roma-street:indooroopilly') ?? 'null')
        return Array.isArray(v?.departures) && typeof v.savedAt === 'number'
      }),
    )
    .toBe(true)
  await page.goto('/station/roma-street?to=indooroopilly')
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Offline · scheduled').first()).toBeVisible()
  await expect(page.getByText(/saved timetable/).first()).toBeVisible()
  // Offline rows claim nothing live: no live dot, no platform-change ring.
  const board = page.locator('[data-board=roma-street]')
  await expect(board.locator('[data-dot=live], [data-platform-change=true]')).toHaveCount(0)
})

test('sitemap lists all 154 stations; robots keeps staging out', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text()
  expect(xml.match(/\/station\//g)).toHaveLength(154)
  expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /')
  expect((await request.get('/station/atlantis')).status()).toBe(404)
})

test('dark mode follows the device', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'dark' })
  const page = await ctx.newPage()
  await page.goto('/station/central')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await ctx.close()
})
