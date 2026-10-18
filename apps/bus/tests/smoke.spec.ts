import { expect, type Page, test } from '@playwright/test'

const watchErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    // MapLibre tile fetches can fail offline in CI; app errors can't.
    if (m.type() === 'error' && !/openfreemap|tiles|Failed to load resource/i.test(m.text()))
      errors.push(m.text())
  })
  return errors
}

const saveStops = async (page: Page) => {
  await page.context().addCookies([
    {
      name: 'bft_bus_saved',
      value: '10802.37',
      url: page.url().startsWith('http') ? page.url() : 'http://localhost:8791',
    },
  ])
  await page.addInitScript(() => {
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([
        { id: '10802', name: 'Cultural Centre station, platform 1' },
        { id: '37', name: 'Adelaide Street Stop 37 near Anzac Square' },
      ]),
    )
  })
}

test('stop page has departure rows in the server HTML', async ({ request }) => {
  const res = await request.get('/stop/10802')
  expect(res.status()).toBe(200)
  const html = await res.text()
  expect(html.match(/data-testid="departure"/g)?.length ?? 0).toBeGreaterThanOrEqual(15)
  expect(html).toContain('<title>Cultural Centre station, platform 1 (stop 010802)')
  expect(html).toContain('rel="canonical"')
  expect(html).toContain('"@type":"BusStop"')
})

test('first visit: search by name with a typo, open the stop, open a bus', async ({
  page,
  isMobile,
}, testInfo) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Live departures for every Brisbane bus stop' }),
  ).toBeVisible()
  const field = page.locator(isMobile ? '#stop-search' : '#stop-search-desktop')
  await field.fill('cultral centre')
  const results = page.getByRole('list', { name: 'Matching stops' }).locator('visible=true')
  await expect(results.getByTestId('stop-result').first()).toBeVisible()
  await expect(page.locator('[data-best]').locator('visible=true')).toContainText('Cultural Centre station')
  await page.screenshot({ path: testInfo.outputPath('search.png') })
  await page.locator('[data-best] a').locator('visible=true').click()
  await expect(page).toHaveURL(/\/stop\/\d+/)
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await expect(page.getByText('LIVE', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/updated \d+ s ago/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('stop.png') })
  await page.getByTestId('departure').first().locator('a').click()
  await expect(page.getByRole('list', { name: 'Stops on this trip' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('trip.png') })
  expect(errors).toEqual([])
})

test('exact stop number search', async ({ page, isMobile }) => {
  await page.goto('/')
  await page.locator(isMobile ? '#stop-search' : '#stop-search-desktop').fill('010802')
  await expect(page.locator('[data-best]').locator('visible=true')).toContainText(
    'Cultural Centre station, platform 1',
  )
})

test('My stops: saved stops render with their next buses', async ({ page, isMobile }, testInfo) => {
  await page.goto('/about')
  await saveStops(page)
  const errors = watchErrors(page)
  await page.goto('/')
  if (isMobile) {
    await expect(page.getByTestId('my-stop')).toHaveCount(2)
    await expect(page.getByTestId('my-stop').first().locator('li')).toHaveCount(3)
  } else {
    await expect(
      page.getByRole('region', { name: 'Cultural Centre station, platform 1' }).getByTestId('departure'),
    ).toHaveCount(5)
  }
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: !isMobile })
  expect(errors).toEqual([])
})

test('save and unsave a stop', async ({ page }) => {
  await page.goto('/stop/19051')
  const star = page.getByRole('button', { name: /Save Mater Hill station, platform 1 to My stops/ })
  await star.click()
  await expect(page.getByRole('button', { name: /Remove Mater Hill/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.goto('/')
  await expect(page.getByText('Mater Hill station, platform 1').locator('visible=true').first()).toBeVisible()
})

test('route filter and per-stop map', async ({ page }) => {
  await page.goto('/stop/10802')
  // The first route pill, not a fixed route: pills follow departure order, which depends on the time of day.
  const pill = page.getByRole('group', { name: 'Filter by route' }).getByRole('button').nth(1)
  const route = (await pill.textContent())?.trim() ?? ''
  await pill.click()
  const rows = page.getByTestId('departure')
  await expect(rows.first()).toBeVisible()
  for (const t of await rows.allTextContents()) expect(t).toMatch(new RegExp(`^Route ${route}(?![0-9])`))
  await page.getByRole('button', { name: 'Map' }).click()
  await expect(page.getByRole('region', { name: /Map of Cultural Centre/ })).toBeVisible()
})

test('nearby from a position, including stops across the tile edge', async ({ page }, testInfo) => {
  await page.goto('/nearby?lat=-27.4732&lon=153.0195')
  const list = page.getByRole('list', { name: 'Nearby stops' })
  await expect(list.getByTestId('stop-result').first()).toContainText('Cultural Centre station, platform 1')
  await expect(list.getByTestId('stop-result').first()).toContainText(/\d+ m/)
  await page.screenshot({ path: testInfo.outputPath('nearby.png') })
})

test('route page lists stops and live buses', async ({ page }, testInfo) => {
  const errors = watchErrors(page)
  await page.goto('/route/M2')
  await expect(page.getByRole('heading', { name: 'Route M2', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Stops towards/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: /buses? on route M2/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /Map of route stops/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('route.png') })
  // The map is client-only: no hydration mismatch from the server's MapLibre stub (Codex review).
  expect(errors).toEqual([])
})

test('map page hydrates cleanly and shows stops', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/map?lat=-27.4732&lon=153.0195')
  await expect(page.getByRole('region', { name: /Map of \d+ bus stops/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /Map of [1-9]\d* bus stops/ })).toBeVisible({
    timeout: 15_000,
  })
  expect(errors).toEqual([])
})

test('malformed preference cookies do not break SSR', async ({ page }) => {
  await page.goto('/about')
  await page.context().addCookies([{ name: 'bft_theme', value: '%E0%A4%A', url: page.url() }])
  const res = await page.goto('/stop/10802')
  expect(res?.status()).toBe(200)
  await expect(page.getByTestId('departure').first()).toBeVisible()
})

test('a saved stop opens offline from My stops with its saved timetable', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'service worker flow checked once')
  await page.goto('/stop/19051')
  await page.getByRole('button', { name: /Save Mater Hill/ }).click()
  // Let the service worker take control, then visit home and the stop once online (caches page + .data).
  await page.waitForFunction(async () => !!(await navigator.serviceWorker?.ready)?.active, null, {
    timeout: 15_000,
  })
  await page.reload()
  await page.goto('/')
  await page
    .getByRole('link', { name: /Mater Hill station, platform 1/ })
    .first()
    .click()
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await page.goto('/')
  await page.context().setOffline(true)
  await page
    .getByRole('link', { name: /Mater Hill station, platform 1/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/stop\/19051/)
  await expect(page.locator('[data-banner=offline]')).toBeVisible()
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await expect(page.locator('[data-status=live]')).toHaveCount(0)
  await page.context().setOffline(false)
})

test('alerts page shows detours first', async ({ page }, testInfo) => {
  await page.goto('/alerts')
  await expect(page.locator('[data-alert]')).toHaveCount(4)
  await expect(page.locator('[data-alert]').first()).toHaveAttribute('data-alert', 'detour')
  await page.screenshot({ path: testInfo.outputPath('alerts.png') })
})

test('rt banners: live times unavailable', async ({ page }) => {
  await page.goto('/stop/10802?rt=unavailable')
  await expect(page.locator('[data-banner=unavailable]')).toBeVisible()
})

test('dark mode from the saved preference', async ({ page }, testInfo) => {
  await page.goto('/about')
  await page.context().addCookies([{ name: 'bft_theme', value: 'dark', url: page.url() }])
  await page.addInitScript(() => localStorage.setItem('bft-theme', 'dark'))
  await page.goto('/stop/11168')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.screenshot({ path: testInfo.outputPath('dark.png') })
})

test('unknown stop and unknown page are 404 and noindex', async ({ page }) => {
  for (const path of ['/stop/nope', '/nowhere']) {
    const res = await page.goto(path)
    expect(res?.status()).toBe(404)
    await expect(page.locator('meta[name=robots]').first()).toHaveAttribute('content', 'noindex')
  }
})

test('sitemap index and robots', async ({ request }) => {
  const idx = await (await request.get('/sitemap.xml')).text()
  expect(idx).toContain('<sitemapindex')
  const stops = await (await request.get('/sitemaps/stops-1.xml')).text()
  expect(stops).toContain('/stop/')
  expect(await (await request.get('/robots.txt')).text()).toContain('Sitemap:')
})
