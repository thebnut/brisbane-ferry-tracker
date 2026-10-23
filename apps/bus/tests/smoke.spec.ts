import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

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
  // Bus home (THE-118 PR 8): the title over the search.
  await expect(page.getByRole('heading', { level: 1, name: 'Bus' })).toBeVisible()
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
  await expect(page.getByRole('list', { name: 'Stops on your trip' })).toBeVisible()
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

test('Saved: saved stops render with their next buses', async ({ page, context, isMobile }, testInfo) => {
  await pinUpcoming(context)
  await page.goto('/about')
  await saveStops(page)
  const errors = watchErrors(page)
  await page.goto('/')
  // My Transit cards under Saved (THE-118 PR 8), at every width: each with its next bus.
  const saved = page.locator('[data-home-section=saved]')
  await expect(saved.locator('a')).toHaveCount(2)
  await expect(saved.locator('a[href="/stop/10802"]')).toContainText('Cultural Centre station, platform 1')
  await expect(saved.locator('[data-saved-time]').first()).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: !isMobile })
  expect(errors).toEqual([])
})

test('save and unsave a stop', async ({ page }) => {
  await page.goto('/stop/19051')
  const star = page.getByRole('button', { name: /^Save Mater Hill station, platform 1 to My Transit/ })
  await star.click()
  await expect(page.getByRole('button', { name: /^Saved Mater Hill/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.goto('/')
  await expect(page.getByText('Mater Hill station, platform 1').locator('visible=true').first()).toBeVisible()
})

test('route filter, and the Map chip opens the bus map on the stop', async ({ page }) => {
  await page.goto('/stop/10802')
  // The first route pill, not a fixed route: pills follow departure order, which depends on the time of day.
  const pill = page.getByRole('group', { name: 'Filter by route' }).getByRole('button').nth(1)
  const route = (await pill.textContent())?.trim() ?? ''
  await pill.click()
  const rows = page.getByTestId('departure')
  await expect(rows.first()).toBeVisible()
  for (const t of await rows.allTextContents()) expect(t).toMatch(new RegExp(`^Route ${route}(?![0-9])`))
  // The Map chip opens the bus map on this stop (THE-118 PR 9).
  await page.getByRole('group', { name: 'Filter by route' }).getByRole('link', { name: 'Map' }).click()
  await expect(page).toHaveURL(/\/map\?stop=10802$/)
  await expect(page.getByRole('region', { name: /Map of \d+ live buses/ })).toBeVisible()
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
  // "1 bus", "0 buses" or "3 buses" depending on the hour.
  await expect(page.getByRole('heading', { name: /\d+ bus(es)? on route M2/ })).toBeVisible()
  await expect(page.getByRole('region', { name: /Map of route stops/ })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('route.png') })
  // The map is client-only: no hydration mismatch from the server's MapLibre stub (Codex review).
  expect(errors).toEqual([])
})

test('route page server-renders its stop list from the route file; a missing route is the 404 page', async ({
  page,
  request,
}) => {
  // The stop list is in the server HTML (no client fetch needed): data/bus/routes/M2.json.
  const html = await (await request.get('/route/M2')).text()
  expect(html).toContain('Stops towards')
  await page.goto('/route/M2')
  await expect(page.getByRole('heading', { name: 'Route M2', exact: true })).toBeVisible()
  const stops = page.getByRole('region', { name: /Stops towards/ }).getByRole('listitem')
  expect(await stops.count()).toBeGreaterThan(5)
  await expect(stops.first().getByRole('link')).toHaveAttribute('href', /\/stop\//)
  for (const path of ['/route/9999', '/route/a%2Fb']) {
    const res = await page.goto(path)
    expect(res?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
    await expect(page.locator('meta[name=robots]').first()).toHaveAttribute('content', 'noindex')
  }
})

test('the routes sitemap lists route pages that render', async ({ request }) => {
  const xml = await (await request.get('/sitemaps/routes.xml')).text()
  const paths = [...xml.matchAll(/<loc>[^<]*?(\/route\/[^<]+)<\/loc>/g)].map((m) => m[1] as string)
  expect(paths).toContain('/route/M2')
  for (const p of [paths[0], paths.at(-1)]) expect((await request.get(p as string)).status()).toBe(200)
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

test('sitemap index; robots and X-Robots-Tag keep staging out (INDEXABLE unset)', async ({ request }) => {
  const idx = await (await request.get('/sitemap.xml')).text()
  expect(idx).toContain('<sitemapindex')
  const stops = await (await request.get('/sitemaps/stops-1.xml')).text()
  expect(stops).toContain('/stop/')
  const robots = await request.get('/robots.txt')
  expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n')
  expect(robots.headers()['x-robots-tag']).toBe('noindex')
})
