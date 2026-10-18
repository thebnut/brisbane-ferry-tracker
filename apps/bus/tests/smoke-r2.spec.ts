/**
 * Regression tests for Dev's smoke test round 2 (18 Oct 2026): B6 (offline board emptied by an old service-worker
 * copy, stale "Updated" time) and T7 (a page rendered from the cache claims LIVE before freshness is known).
 *
 * Time-of-day independent: the departures responses are routed so the board has buses due (or none, where that is
 * the point), whatever the hour. `context.route` also covers the service worker's own requests.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

const STOP = '10802'
const DEPARTURES = `**/__fixtures/v1/bus/stops/${STOP}/departures*`

interface Body {
  generatedAt: number
  departures: Array<{ schedDep: number; estDep: number | null }>
}

/** Every row moved by the same amount so the first leaves `nextInS` from now; null: no departures at all. */
const routeDepartures = (context: BrowserContext, nextInS: number | null) =>
  context.route(DEPARTURES, async (route) => {
    const res = await route.fetch()
    const body: Body = await res.json()
    const first = body.departures[0]
    if (nextInS == null) body.departures = []
    else if (first) {
      const shift = Math.floor(Date.now() / 1000) + nextInS - first.schedDep
      for (const d of body.departures) {
        d.schedDep += shift
        if (d.estDep != null) d.estDep += shift
      }
    }
    await route.fulfill({ response: res, json: body })
  })

const serviceWorkerReady = (page: Page) =>
  page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 })

const refresh = (page: Page) => page.getByRole('button', { name: 'Refresh' }).click()
const updated = (page: Page) => page.getByText(/^Updated /).first()

/**
 * Turn the service worker's cached copy of this stop's departures into one from 94 minutes ago (Dev saw "Updated
 * 9:06 pm" at 10:40 pm), every bus long gone.
 */
const ageCachedCopy = (page: Page) =>
  page.evaluate(async (stop) => {
    const cache = await caches.open('bus-data')
    let aged = 0
    for (const req of await cache.keys()) {
      if (!req.url.includes(`/v1/bus/stops/${stop}/departures`)) continue
      const body:
        | { generatedAt: number; departures: Array<{ schedDep: number; estDep: number | null }> }
        | undefined = await (await cache.match(req))?.json()
      if (!body) continue
      body.generatedAt -= 94 * 60_000
      for (const d of body.departures) {
        d.schedDep -= 3 * 3600
        if (d.estDep != null) d.estDep -= 3 * 3600
      }
      await cache.put(
        req,
        new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }),
      )
      aged++
    }
    return aged
  }, STOP)

test('offline: an old service-worker copy never empties the board or its Updated time (R2-B6)', async ({
  page,
  context,
}) => {
  await page.goto(`/stop/${STOP}`)
  await serviceWorkerReady(page)
  await routeDepartures(context, 600)
  await refresh(page)
  await expect(page.getByTestId('departure').first()).toBeVisible()
  const before = await updated(page).innerText()
  // Offline first, so no later network answer replaces the copy aged below. (A route handler would still answer the
  // service worker while offline: Playwright fetches routed requests itself.)
  await page.waitForTimeout(1_000)
  await context.unroute(DEPARTURES)
  await context.setOffline(true)
  expect(await ageCachedCopy(page)).toBeGreaterThan(0)
  await refresh(page)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 5_000 })
  // Let the refresh settle on the service worker's (old) answer.
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  await page.waitForTimeout(1_000)
  await expect(page.getByTestId('departure').first()).toBeVisible()
  await expect(page.getByText('No buses due')).toHaveCount(0)
  await expect(page.locator('[data-status=live]')).toHaveCount(0)
  // The time of the data shown (the board's own), not the cached copy's 94-minute-old time.
  await expect(updated(page)).toHaveText(before)
  await context.setOffline(false)
})

test('offline with no usable timetable says so, never "no departures in the next day" (R2-B6)', async ({
  page,
  context,
}) => {
  await page.goto(`/stop/${STOP}`)
  await serviceWorkerReady(page)
  // No departures in any copy on hand (this stop is not saved, so there is no longer copy).
  await routeDepartures(context, null)
  await refresh(page)
  await expect(page.getByText('No buses due')).toBeVisible()
  await page.waitForTimeout(1_000)
  await context.unroute(DEPARTURES)
  await context.setOffline(true)
  await refresh(page)
  await expect(page.locator('[data-banner=offline]')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Offline: no saved timetable for this stop')).toBeVisible()
  await expect(page.getByText(/no departures from this stop in the next day/)).toHaveCount(0)
  await context.setOffline(false)
})

/** Records every frame in which a LIVE or GPS claim is visible, from the first paint on. */
const recordLiveClaims = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = []
    const w = window as unknown as { __liveSeen: string[]; __guardAtFirstFrame?: boolean }
    w.__liveSeen = seen
    const tick = () => {
      w.__guardAtFirstFrame ??= document.documentElement.hasAttribute('data-live-unconfirmed')
      for (const el of document.querySelectorAll<HTMLElement>('span')) {
        const claim = el.dataset.badge === 'live' || el.dataset.badge === 'gps' || el.textContent === 'LIVE'
        if (claim && el.checkVisibility())
          seen.push(`${Math.round(performance.now())} ms: ${el.outerHTML.slice(0, 80)}`)
      }
      if (performance.now() < 10_000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
const liveSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __liveSeen: string[] }).__liveSeen)

test('a page reloaded offline never shows LIVE, not even before hydration (R2-T7)', async ({
  page,
  context,
}) => {
  // The server HTML does claim LIVE (the guard has something to hide).
  const html = await (await page.request.get(`/stop/${STOP}`)).text()
  expect(html).toContain('data-live-claim')
  await recordLiveClaims(page)
  // An offline reload served from the service worker's cache: the device is offline from the first script on.
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true })
  })
  await context.route('**/v1/**', (route) => route.abort('internetdisconnected'))
  await page.goto(`/stop/${STOP}`)
  await expect(page.locator('[data-banner=offline]')).toBeVisible()
  await page.waitForTimeout(1_500)
  expect(await liveSeen(page)).toEqual([])
})

test('HTML rendered minutes ago shows no LIVE until a live call reaches the network (R2-T7)', async ({
  page,
}) => {
  await recordLiveClaims(page)
  // The device clock says the HTML is five minutes old, as for a page the service worker kept.
  await page.addInitScript(() => {
    const now = Date.now
    Date.now = () => now() + 5 * 60_000
  })
  await page.goto(`/stop/${STOP}`)
  await page.waitForTimeout(1_500)
  expect(
    await page.evaluate(() => (window as unknown as { __guardAtFirstFrame?: boolean }).__guardAtFirstFrame),
  ).toBe(true)
  expect(await liveSeen(page)).toEqual([])
  // A live call that reaches the network confirms freshness; the app's own state decides from then on.
  await refresh(page)
  await expect(page.locator('html')).not.toHaveAttribute('data-live-unconfirmed', '')
})

// Stop 2810 (Oxford St at Bulimba Ferry) has "Fortitude Valley, Wickham St"; these are the longest in the fixture.
const LONG_HEADSIGNS = [
  'Fortitude Valley, Wickham St',
  'Carindale Heights, Cribb Rd E',
  'Fairfield Rd - Yeerongpilly station',
  'Coorparoo, Old Cleveland Rd',
]

for (const width of [360, 400]) {
  test.describe(`phone width ${width} px (B2)`, () => {
    test.use({ viewport: { width, height: 800 } })

    test('long destinations wrap, never cut with an ellipsis', async ({ page, context }, testInfo) => {
      await context.route(DEPARTURES, async (route) => {
        const res = await route.fetch()
        const body: { departures: Array<{ headsign: string }> } = await res.json()
        body.departures.forEach((d, i) => {
          d.headsign = LONG_HEADSIGNS[i % LONG_HEADSIGNS.length] as string
        })
        await route.fulfill({ response: res, json: body })
      })
      await page.goto(`/stop/${STOP}`)
      await refresh(page)
      await expect(page.getByTestId('destination').first()).toHaveText(LONG_HEADSIGNS[0] as string)
      await page.screenshot({ path: testInfo.outputPath(`long-destinations-${width}.png`) })
      const checks = await page.getByTestId('destination').evaluateAll((els) =>
        els.map((el) => {
          const style = getComputedStyle(el)
          const ctx = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D
          ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
          const widest = Math.max(...(el.textContent ?? '').split(/\s+/).map((w) => ctx.measureText(w).width))
          return {
            text: el.textContent,
            clipped: el.scrollHeight > el.clientHeight + 1,
            lines: Math.round(el.clientHeight / Number.parseFloat(style.lineHeight)),
            wordFits: widest <= el.clientWidth + 1,
          }
        }),
      )
      expect(checks.length).toBeGreaterThan(0)
      for (const c of checks) {
        expect(c.clipped, `${c.text} is cut`).toBe(false)
        // Two lines; a narrow phone may take a third beside a wide countdown rather than cut the name.
        expect(c.lines, `${c.text} lines`).toBeLessThanOrEqual(
          width > 420 || c.text === LONG_HEADSIGNS[0] ? 2 : 3,
        )
        expect(c.wordFits, `${c.text}: a word is split`).toBe(true)
      }
    })
  })
}
