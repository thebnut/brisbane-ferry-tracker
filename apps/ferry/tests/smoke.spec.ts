import { expect, type Page, test } from '@playwright/test'

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

test('home renders both boards with countdown chips', async ({ page, isMobile }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await rememberBulimbaRiverside(page)
  await page.goto('/')
  const outbound = page.locator('[data-board=outbound]')
  await expect(outbound.getByTestId('departure')).toHaveCount(5)
  await expect(outbound.locator('[data-tone]').first()).toBeVisible()
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

test('opens the details sheet with the stopping pattern', async ({ page }) => {
  await rememberBulimbaRiverside(page)
  await page.goto('/')
  await page.locator('[data-board=outbound] [data-testid=departure] button').first().click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/Departure from Bulimba/)).toBeVisible()
  await expect(sheet.getByRole('list', { name: 'Stopping pattern' })).toBeVisible()
  await expect(sheet.getByRole('list', { name: 'Stopping pattern' })).toContainText('Riverside')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('first visit shows the stop selector; changing stops updates the boards', async ({ page }) => {
  await page.goto('/')
  const sheet = page.getByRole('dialog', { name: 'Select ferry stops' })
  await expect(sheet).toBeVisible()
  await sheet.getByRole('combobox', { name: 'From' }).fill('hawth')
  await sheet.getByRole('option', { name: 'Hawthorne' }).click()
  await sheet.getByRole('checkbox', { name: 'Remember selection' }).check()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toBeHidden()
  await expect(page.locator('[data-board=outbound]')).toHaveAttribute('aria-label', 'Hawthorne to Riverside')
  await expect(page.locator('[data-board=outbound]').getByTestId('departure').first()).toBeVisible()
  // Saved: the next visit renders Hawthorne in the server HTML (cookie) and skips the selector.
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
  expect(html).toMatch(/in \d+ mins?|Departing/)
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
  await expect(page.locator('[data-board=outbound] [data-badge=live]')).toHaveCount(0)
  await context.setOffline(false)
  await expect(page.getByText('Offline · scheduled')).toBeHidden()
})

test('live data unavailable shows its banner', async ({ page }) => {
  await rememberBulimbaRiverside(page)
  await page.goto('/?rt=unavailable')
  await expect(page.getByText('Live times unavailable')).toBeVisible()
})

test('privacy and terms are prerendered', async ({ request }) => {
  for (const path of ['/privacy', '/terms']) {
    const res = await request.get(path)
    expect(res.status()).toBe(200)
    expect(await res.text()).toContain('Brisbane Ferry')
  }
})
