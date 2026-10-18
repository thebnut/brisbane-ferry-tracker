/**
 * Search speed on a mid-range Android profile: Pixel 7 viewport with 4× CPU throttling (Chrome DevTools Protocol).
 * Types realistic queries a key at a time against the full stop index (when `pnpm data` built it; otherwise the
 * fixture subset, which the test reports) and records each search's duration. Budget: p95 < 50 ms.
 */
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const QUERIES = [
  'cultural centre',
  'king george sq',
  'mater hill',
  'adelaide st 37',
  '10802',
  'gympie rd',
  'uq lakes',
  'buranda',
  'griffith uni',
  'roma street',
]

test('search p95 under 50 ms at 4× CPU throttle', async ({ page, browserName, isMobile }, testInfo) => {
  test.skip(browserName !== 'chromium' || !isMobile, 'CPU throttling via CDP: phone project only')
  test.setTimeout(120_000)
  await page.goto('/')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const field = page.locator('#stop-search')
  await field.click()
  await page.waitForFunction(() => window.__bftSearch?.ready === true, null, { timeout: 30_000 })
  const indexSize = await page.evaluate(async () => {
    const r = await fetch('/__fixtures/data/bus/stops.json')
    return ((await r.json()) as { stops: unknown[] }).stops.length
  })
  await page.evaluate(() => {
    if (window.__bftSearch) window.__bftSearch.times = []
  })
  for (const q of QUERIES) {
    await field.fill('')
    await field.pressSequentially(q, { delay: 60 })
    await expect(page.getByRole('list', { name: 'Matching stops' }).locator('visible=true')).toBeVisible()
  }
  const times = await page.evaluate(() => window.__bftSearch?.times ?? [])
  const sorted = [...times].sort((a, b) => a - b)
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  const result = {
    indexSize,
    searches: times.length,
    p50: pct(0.5),
    p95: pct(0.95),
    max: sorted.at(-1),
    cpuThrottle: 4,
  }
  writeFileSync(testInfo.outputPath('search-perf.json'), JSON.stringify(result, null, 1))
  console.log('search perf', JSON.stringify(result))
  expect(times.length).toBeGreaterThan(50)
  expect(result.p95).toBeLessThan(50)
})
