import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming, refreshBoards } from './upcoming.ts'

const rememberBulimbaRiverside = async (page: Page) => {
  await page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })
}

test('home renders both boards with countdown chips', async ({ page, context, isMobile }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await rememberBulimbaRiverside(page)
  // A chip and a LIVE row at any hour.
  await pinUpcoming(context)
  await page.goto('/')
  const outbound = page.locator('[data-board=outbound]')
  await expect(outbound.getByTestId('departure')).toHaveCount(5)
  await refreshBoards(page)
  await expect(outbound.locator('[data-countdown]').first()).toBeVisible()
  const inbound = page.locator('[data-board=inbound]')
  if (isMobile) {
    // Phones show one board with origin/destination dropdowns and swap.
    await expect(inbound).toBeHidden()
    await expect(page.getByRole('button', { name: 'Swap direction' }).first()).toBeVisible()
  } else {
    await expect(inbound.getByTestId('departure')).toHaveCount(5)
  }
  await expect(page.getByText('LIVE', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/updated \d+ s ago/)).toBeVisible()
  // Fixture data is always labelled as such.
  await expect(page.locator('[data-banner=demo]')).toContainText('Demo data')
  await page.screenshot({ path: testInfo.outputPath('home.png') })
  // Hydration must match the server HTML (no recoverable-error re-render).
  expect(errors).toEqual([])
})

test('more departures expands to 13', async ({ page }) => {
  await rememberBulimbaRiverside(page)
  await page.goto('/')
  const outbound = page.locator('[data-board=outbound]')
  await outbound.getByRole('button', { name: /More departures/ }).click()
  await expect(outbound.getByTestId('departure')).toHaveCount(13)
})

test('a departure opens its trip page, from Bulimba to Riverside, and goes back (THE-118 PR 6)', async ({
  page,
}) => {
  await rememberBulimbaRiverside(page)
  await page.goto('/')
  await page.locator('[data-board=outbound] [data-testid=departure] a').first().click()
  await expect(page).toHaveURL(/\/trip\/[^?]+\?from=bulimba&to=riverside$/)
  const stops = page.getByRole('list', { name: 'Stops on your trip' })
  await expect(stops.locator('[data-mine=board]')).toContainText('Bulimba')
  await expect(stops.locator('[data-mine=alight]')).toContainText('Riverside')
  // Back: the trip page's "‹ Bulimba", or beside the board on desktop (THE-118 PR 7) its ✕.
  await page
    .getByRole('link', { name: 'Bulimba', exact: true })
    .or(page.getByRole('button', { name: 'Close trip details' }))
    .click()
  await expect(page).toHaveURL('/')
})

test('the stop selector (Settings): changing stops updates the boards', async ({ page }) => {
  await page.goto('/')
  // The selector no longer opens by itself (P4: the first visit gets the onboarding prompt): Settings opens it.
  await page.getByRole('button', { name: 'Settings' }).click()
  const sheet = page.getByRole('dialog', { name: 'Select ferry stops' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'From' }).fill('hawth')
  await sheet.getByRole('option', { name: 'Hawthorne' }).click()
  await sheet.getByRole('checkbox', { name: 'Remember selection' }).check()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('[data-board=outbound]')).toHaveAttribute('aria-label', 'Hawthorne to Riverside')
  await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
  // Saved: the next visit renders Hawthorne in the server HTML (cookie), with no selector or prompt.
  await page.reload()
  await expect(page.locator('[data-board=outbound]')).toHaveAttribute('aria-label', 'Hawthorne to Riverside')
  await expect(page.getByRole('dialog', { name: 'Select ferry stops' })).toBeHidden()
})

test('terminal page has departure rows, canonical and JSON-LD in the raw HTML', async ({ request }) => {
  const res = await request.get('/terminal/bulimba')
  expect(res.status()).toBe(200)
  const html = await res.text()
  expect(html).toContain('<link rel="canonical" href="https://www.brisbaneferry.com/terminal/bulimba"/>')
  expect(html).toContain('<title>Next ferry from Bulimba - live CityCat times | Brisbane Ferry</title>')
  expect(html).toContain('"@type":"BoatTerminal"')
  expect((html.match(/data-testid="departure"/g) ?? []).length).toBeGreaterThanOrEqual(5)
  expect((html.match(/data-testid="timetable-row"/g) ?? []).length).toBeGreaterThan(5)
  // A countdown only for a departure due within the hour (the board's rule); late at night the fixture timetable can
  // have nothing due on Bulimba ⇄ Riverside for over an hour, so require it only then (time-of-day independent).
  const due = async (from: string, to: string) => {
    const r = await request.get(`/__fixtures/v1/ferry/stops/${from}/departures?to=${to}&limit=13`)
    const deps: Array<{ status: string; schedDep: number; estDep?: number | null }> = (await r.json())
      .departures
    return deps.some(
      (d) =>
        d.status !== 'cancelled' &&
        d.status !== 'skipped' &&
        Math.trunc(((d.estDep ?? d.schedDep) * 1000 - Date.now()) / 60000) <= 59,
    )
  }
  if ((await due('317584', '317590')) || (await due('317590', '317584')))
    // THE-118 PR 4: the shared row's countdown (BigCountdown): "N min", or "Now" when due.
    expect(html).toMatch(/data-countdown="-?\d+"><span[^>]*>(?:\d+ min|Now)<\/span>/)
})

test('unknown terminal and unknown paths are 404 with noindex', async ({ request }) => {
  for (const path of ['/terminal/atlantis', '/nope']) {
    const res = await request.get(path)
    expect(res.status()).toBe(404)
    expect(await res.text()).toContain('noindex')
  }
})

test('sitemap keeps the legacy URLs', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text()
  expect(xml).toContain('<loc>https://www.brisbaneferry.com/terminal/howard-smith-wharves</loc>')
  expect((xml.match(/<loc>/g) ?? []).length).toBe(25)
})

test('offline shows the "Offline · scheduled" banner', async ({ page, context }) => {
  await rememberBulimbaRiverside(page)
  await page.goto('/')
  await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
  await context.setOffline(true)
  await expect(page.getByText('Offline · scheduled')).toBeVisible()
  await expect(page.getByText('OFFLINE', { exact: true })).toBeVisible()
  await expect(page.locator('[data-board=outbound] [data-dot=live]')).toHaveCount(0)
  await context.setOffline(false)
  await expect(page.getByText('Offline · scheduled')).toBeHidden()
})

test('first visit is cached for an offline reload (service worker)', async ({ page }) => {
  // Playwright's Chromium does not serve navigations from the service worker under offline emulation or request
  // routing, so this checks the pieces; the offline reload itself was verified in desktop Chrome with the server
  // stopped (see the PR).
  await rememberBulimbaRiverside(page)
  await page.goto('/')
  await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
  const cachedHtml = () =>
    page.evaluate(async () => {
      if (!navigator.serviceWorker.controller) return ''
      const res = await (await caches.open('ferry-pages')).match(location.href)
      return res ? await res.text() : ''
    })
  await expect
    .poll(async () => ((await cachedHtml()).match(/data-testid="departure"/g) ?? []).length)
    .toBeGreaterThanOrEqual(5)
  const precached = await page.evaluate(async () => {
    const names = await caches.keys()
    const pre = names.find((n) => n.startsWith('workbox-precache'))
    return pre ? (await (await caches.open(pre)).keys()).map((r) => new URL(r.url).pathname) : []
  })
  expect(precached.some((p) => /ferry-lockup-360-.*\.webp$/.test(p))).toBe(true)
  expect(precached.some((p) => /\/assets\/entry\.client-.*\.js$/.test(p))).toBe(true)
})

test('live data unavailable shows its banner', async ({ page }) => {
  await rememberBulimbaRiverside(page)
  await page.goto('/?rt=unavailable')
  await expect(page.getByText('Live times unavailable')).toBeVisible()
})

test('privacy and terms are served (server-rendered with the CSP nonce)', async ({ request }) => {
  for (const path of ['/privacy', '/terms']) {
    const res = await request.get(path)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('Brisbane Ferry')
  }
})
