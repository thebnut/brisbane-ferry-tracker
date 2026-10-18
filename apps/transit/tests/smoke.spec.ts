import { gzipSync } from 'node:zlib'
import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const watchErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    // Map tiles can fail offline. (Empty geohash cells are empty tiles, not 404s, since smoke test X2.)
    if (m.type() === 'error' && !/openfreemap|tiles|Failed to load resource/i.test(m.text()))
      errors.push(m.text())
  })
  return errors
}

const CBD = '/nearby?lat=-27.4717&lon=153.0206'

test('Saved home: transit lockup, Ask box, Mode Tabs in the X-Home order', async ({ page, isMobile }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'BrisbaneTransit Departure Boards, home' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Ask' })).toBeVisible()
  await expect(page.getByText('Nothing saved yet')).toBeVisible()
  const tabs = page.getByRole('navigation', { name: 'Modes' }).filter({ visible: true })
  const labels = (await tabs.getByRole('link').allInnerTexts()).map((t) => t.trim())
  expect(labels.slice(0, 5)).toEqual(
    isMobile ? ['Ferry', 'Train', 'Bus', 'Nearby', 'Saved'] : ['Saved', 'Ferry', 'Train', 'Bus', 'Nearby'],
  )
  expect(errors).toEqual([])
})

test('each mode tab shows its standalone app with that app’s own lockup', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  const tabs = page.getByRole('navigation', { name: 'Modes' }).filter({ visible: true })
  for (const [tab, lockup, path] of [
    ['Bus', 'BrisbaneBus Departure Boards, home', '/bus'],
    ['Train', 'BrisbaneTrain Departure Boards, home', '/train'],
    ['Ferry', 'BrisbaneFerry Departure Boards, home', '/ferry'],
  ] as const) {
    await tabs.getByRole('link', { name: tab }).click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('link', { name: lockup })).toBeVisible()
    await expect(tabs.getByRole('link', { name: tab })).toHaveAttribute('aria-current', 'page')
  }
  expect(errors).toEqual([])
})

test('bus stop page: server-rendered rows, links stay inside the Bus tab, canonical is the standalone app', async ({
  request,
}) => {
  const res = await request.get('/bus/stop/10802')
  expect(res.status()).toBe(200)
  const html = await res.text()
  expect(html.match(/data-testid="departure"/g)?.length ?? 0).toBeGreaterThanOrEqual(10)
  expect(html).toContain('rel="canonical" href="https://bft-bus.brisbanetransit.workers.dev/stop/10802"')
  expect(html).toContain('href="/bus/route/')
  expect(html).not.toMatch(/href="\/route\//)
  expect(html).toContain('aria-label="Bus sections"')
})

test('train board inside the Train tab opens a service and comes back', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/train/station/roma-street?to=indooroopilly')
  await expect(page.getByRole('link', { name: 'BrisbaneTrain Departure Boards, home' })).toBeVisible()
  const first = page.locator('a[href^="/train/trip/"]').first()
  await first.click()
  await expect(page).toHaveURL(/\/train\/trip\//)
  await expect(page.getByRole('link', { name: /Departures|Roma Street/ }).first()).toBeVisible()
  expect(errors).toEqual([])
})

test('Around you: all three modes grouped with pin shapes, sorted in < 100 ms', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto(CBD)
  const timing = page.locator('[data-nearby-ms]')
  await expect(timing).toBeVisible()
  const ms = Number(await timing.getAttribute('data-nearby-ms'))
  test.info().annotations.push({ type: 'nearby-ms', description: String(ms) })
  expect(ms).toBeLessThan(100)
  for (const m of ['Ferry', 'Train', 'Bus'])
    await expect(page.getByRole('heading', { name: m, exact: true })).toBeVisible()
  await expect(page.locator('main [data-pin="ferry"]').first()).toBeVisible()
  await expect(page.locator('main [data-pin="train"]').first()).toBeVisible()
  await expect(page.locator('main [data-pin="bus"]').first()).toBeVisible()
  // Next departures load for the stops.
  await expect(page.locator('main [data-stop] >> text=/in \\d+ mins?|Departing/').first()).toBeVisible()
  // Mode chip filter.
  await page.getByRole('button', { name: /^Train/ }).click()
  await expect(page.getByRole('heading', { name: 'Bus', exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Around you without location: explains first, then "Use a stop" works', async ({ page }) => {
  await page.goto('/nearby')
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible()
  await page.getByRole('button', { name: 'Use a stop' }).click()
  await page.getByRole('searchbox', { name: /Stop, station or terminal/ }).fill('Central')
  await page
    .getByRole('button', { name: /Central station/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: /Around Central station/ })).toBeVisible()
  await expect(page.locator('[data-nearby-ms]')).toBeVisible()
})

test('Around you with location permission granted locates straight away', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL,
    permissions: ['geolocation'],
    geolocation: { latitude: -27.4717, longitude: 153.0206 },
  })
  const page = await context.newPage()
  await page.goto('/nearby')
  await expect(page.locator('[data-nearby-ms]')).toBeVisible()
  await context.close()
})

test('merged alerts filter by mode chips', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByRole('heading', { name: 'Service alerts' })).toBeVisible()
  const cards = page.locator('article[data-mode]')
  const all = await cards.count()
  expect(all).toBeGreaterThan(1)
  await page.getByRole('button', { name: /^Train/ }).click()
  const train = await cards.count()
  expect(train).toBeLessThan(all)
  for (const m of await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-mode'))))
    expect(['train', 'all']).toContain(m)
})

test('Ask box answers with shared departure cards and explains an AI limit', async ({ page }) => {
  await page.goto('/?fixtures=1')
  const ask = page.getByRole('textbox', { name: 'Ask' })
  await ask.fill('next train from Bowen Hills to the airport')
  await ask.press('Enter')
  await expect(page.getByText(/From Bowen Hills station/)).toBeVisible()
  await expect(page.locator('[data-highlighted]').first()).toContainText('7:58 pm')
  await ask.fill('next bus from nowhere #reason:budget_exhausted')
  await ask.press('Enter')
  await expect(page.locator('[data-ask-notice]')).toContainText("month's budget")
})

test('Saved mixes every mode and works offline as "Offline · scheduled"', async ({ page, context }) => {
  // Saved cards fetch after hydration, so every card's first service is pinned 10 minutes out (any hour).
  await pinUpcoming(context)
  await page.addInitScript(() => {
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    )
    localStorage.setItem(
      'bft-train-favourites',
      JSON.stringify([{ from: 'roma-street', to: 'indooroopilly' }]),
    )
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })
  await page.goto('/')
  await expect(page.getByText('3 saved · all modes')).toBeVisible()
  const cards = page.locator('main a').filter({ hasText: /→|platform 1/ })
  for (const name of [
    /Ferry.*Bulimba → Riverside/,
    /Train.*Roma Street → Indooroopilly/,
    /Bus.*Cultural Centre station, platform 1/,
  ])
    await expect(page.getByRole('link', { name })).toBeVisible()
  await expect(cards.getByText('LIVE').first()).toBeVisible()
  await expect(page.getByText(/in \d+ mins?/).first()).toBeVisible()
  await context.setOffline(true)
  await page.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(page.getByText(/You're offline|Offline/).first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Cultural Centre station, platform 1/ })).toBeVisible()
  // Timetable only: no LIVE badge, but still departure times.
  await expect(cards.getByText('LIVE')).toHaveCount(0)
  await expect(cards.getByText(/\d:\d\d (am|pm)/).first()).toBeVisible()
  await context.setOffline(false)
})

/**
 * Budgets: the transit pages ≤ 150 KB gz. A mode page is the standalone app's own page (measured standalone, 18 Oct:
 * ferry home 139.8, train home 149.2, bus home 143.6, bus stop 144.5 KB) plus the Mode Tabs shell, held to
 * standalone + 10 KB.
 */
const BUDGET_KB: Record<string, number> = {
  '/': 150,
  '/nearby': 150,
  '/alerts': 150,
  '/ferry': 139.8 + 10,
  '/train': 149.2 + 10,
  '/bus': 143.6 + 10,
  '/bus/stop/10802': 144.5 + 10,
}

test('first-load JS within budget on every top-level page; MapLibre is never on it', async ({ request }) => {
  // First load = the scripts the server HTML itself references (entry, modulepreloads, inline); chunks a page imports
  // lazily after hydration (maps, the ferry stop selector, the Ask answer) are not on it.
  for (const [path, kb] of Object.entries(BUDGET_KB)) {
    const html = await (await request.get(path)).text()
    const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1] as string)
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1])
      .join('')
    let bytes = gzipSync(inline).length
    for (const u of new Set(urls)) bytes += gzipSync(await (await request.get(u)).body()).length
    test
      .info()
      .annotations.push({ type: `first-load ${path}`, description: `${(bytes / 1024).toFixed(1)} KB gz` })
    expect(bytes, path).toBeLessThan(kb * 1024)
    expect(
      urls.some((u) => /maplibre|MapView/i.test(u)),
      path,
    ).toBe(false)
  }
})
