/**
 * The departure details sheet loads on demand (R15-S1 first-load offset): its chunk is precached by the service worker,
 * so it still opens offline, and the first tap online shows the sheet or its "Loading…" fallback at once, never
 * nothing.
 */
import { goOffline, waitForServiceWorker } from '@bft/ui/e2e/offline.ts'
import { expect, type Page, test } from '@playwright/test'

const PATH = '/'
const PAGES_CACHE = 'ferry-pages'

const rememberBulimbaRiverside = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
  })
const firstDeparture = (page: Page) =>
  page.locator('[data-board=outbound] [data-testid=departure] button').first()

test('the details sheet is off the first load, and opens offline from the precache', async ({
  page,
  context,
}) => {
  await rememberBulimbaRiverside(page)
  const chunks: string[] = []
  page.on('request', (r) => {
    if (/\/assets\/DetailsSheet-[^/]+\.js$/.test(new URL(r.url()).pathname)) chunks.push(r.url())
  })
  await page.goto(PATH)
  await waitForServiceWorker(page, PAGES_CACHE)
  expect(chunks, 'not on the first load').toEqual([])
  const precached = await page.evaluate(async () => {
    const pre = (await caches.keys()).find((n) => n.startsWith('workbox-precache'))
    return pre ? (await (await caches.open(pre)).keys()).map((r) => new URL(r.url).pathname) : []
  })
  expect(precached.some((p) => /\/assets\/DetailsSheet-[^/]+\.js$/.test(p))).toBe(true)

  await goOffline(context)
  await firstDeparture(page).click()
  const sheet = page.getByRole('dialog')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(/Departure from Bulimba/)).toBeVisible()
  expect(chunks.length, 'loaded on the tap').toBeGreaterThan(0)
})

test('the first tap online shows the sheet or its fallback at once, never nothing', async ({ page }) => {
  await rememberBulimbaRiverside(page)
  await page.goto(PATH)
  await expect(firstDeparture(page)).toBeVisible()
  // Every frame from the tap on: has the sheet (dialog) or the fallback (status) shown yet?
  await page.evaluate(() => {
    const w = window as unknown as { __frames: string[] }
    w.__frames = []
    const t0 = performance.now()
    const tick = () => {
      const shown = document.querySelector('dialog[open], [role=dialog]')
        ? 'sheet'
        : document.querySelector('[role=status]')?.textContent?.includes('Loading')
          ? 'fallback'
          : 'none'
      w.__frames.push(shown)
      if (shown !== 'sheet' && performance.now() - t0 < 5_000) requestAnimationFrame(tick)
    }
    document.addEventListener('click', () => requestAnimationFrame(tick), { once: true, capture: true })
  })
  await firstDeparture(page).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
  const frames = await page.evaluate(() => (window as unknown as { __frames: string[] }).__frames)
  // The frame painted with the tap's own render already shows one or the other; nothing blank after it.
  expect(frames.slice(1)).not.toContain('none')
  expect(frames.at(-1)).toBe('sheet')
})
