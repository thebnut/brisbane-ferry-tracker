/**
 * The R6-B1 warm-offline hold suite every app runs: a board loaded online, then held offline for over a minute, must
 * stay an honest offline board the whole time (the offline banner, its timetable rows, no LIVE, no "Live times
 * delayed", never "no saved timetable" while it has rows), and LIVE must return once the network does. A watcher in
 * the page checks every frame and records each violation, so a flip that lasts a moment is caught too.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { goOffline, visibleLiveClaims, waitForServiceWorker } from './offline.ts'

/**
 * The in-page watcher (`stopWatching` returns what it saw). It can start from a page's first frame (an init script,
 * for a reload): LIVE, "Live times delayed" and the other wrong states count from then on, while the banner and rows
 * checks start once the app has rendered its offline banner (a cached page's HTML paints before the app judges it).
 */
function watcher(rows: string) {
  const seen = new Set<string>()
  const w = window as unknown as { __offlineViolations: string[]; __offlineWatch: boolean }
  w.__offlineViolations = []
  w.__offlineWatch = true
  let armed = false
  const note = (what: string) => {
    if (seen.has(what) || seen.size > 40) return
    seen.add(what)
    w.__offlineViolations.push(`${Math.round(performance.now())} ms: ${what}`)
  }
  const visible = (sel: string) =>
    [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.checkVisibility())
  const tick = () => {
    if (!w.__offlineWatch) return
    if (document.body) {
      const banner = visible('[data-banner=offline]').length > 0
      armed ||= banner
      if (armed && !banner) note('no offline banner')
      if (armed && visible(rows).length === 0) note('no rows')
      for (const el of visible('[data-banner=stale],[data-banner=unavailable],[data-banner=reloading]'))
        note(`banner ${el.dataset.banner}`)
      // A live row only counts once the app has rendered: before that a cached page's HTML paints as saved, with its
      // LIVE and GPS claims hidden by the live guard (R2-T7), which the first selector checks.
      for (const el of visible(
        armed
          ? '[data-live-claim],[data-badge=live],[data-badge=gps],[data-status=live]'
          : '[data-live-claim]',
      ))
        note(`live claim ${el.outerHTML.slice(0, 80)}`)
      for (const el of visible('span'))
        if (el.childElementCount === 0 && el.textContent?.trim() === 'LIVE') note('LIVE label')
      const text = document.body.innerText
      for (const bad of [
        'no saved timetable',
        'Live times delayed',
        'No buses due',
        'No trains',
        'No ferries',
      ])
        if (text.includes(bad)) note(`text "${bad}"`)
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

const stopWatching = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __offlineViolations: string[]; __offlineWatch: boolean }
    w.__offlineWatch = false
    return w.__offlineViolations
  })

/**
 * Offline as a page can see it on a flaky phone, or with DevTools' "Service Workers → Offline": the service worker's
 * requests fail (it answers from its cache, marked), requests it doesn't handle (alerts, the route manifest) still
 * reach the network, `navigator.onLine` stays true, and `online` fires as the connection flaps. Each of those can
 * clear the connection flag between a cached answer and the board's check (R6-B1). Returns "back online".
 */
async function partialOffline(context: BrowserContext, page: Page): Promise<() => Promise<void>> {
  const handler = (route: import('@playwright/test').Route) =>
    route.request().serviceWorker() ? route.abort('internetdisconnected') : route.fallback()
  await context.route('**/*', handler)
  await flap(page)
  return async () => {
    await page.evaluate(() => clearInterval((window as unknown as { __flap?: number }).__flap))
    await context.unroute('**/*', handler)
    // The connection is back: the browser says so once more (after onReconnect's 1 s refetch throttle).
    await page.waitForTimeout(1_100)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
  }
}

/** The browser keeps firing `online` as the connection flaps (again after a reload). */
const flap = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __flap?: number }
    w.__flap = window.setInterval(() => window.dispatchEvent(new Event('online')), 3)
  })

/**
 * Makes the page cache's copy of `path` look as if it was saved hours ago (Dev's profile kept /stop/10802 from the
 * night before: "Updated 10:51 pm" at 5 am): every epoch time in the HTML, its loader data included, moves back.
 */
const ageCachedPage = (page: Page, pagesCache: string, hours: number) =>
  page.evaluate(
    async ({ pagesCache, hours }) => {
      const cache = await caches.open(pagesCache)
      let aged = 0
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname !== location.pathname) continue
        const html = (await (await cache.match(req))?.text()) ?? ''
        const older = html
          .replace(/\b17\d{11}\b/g, (m) => String(Number(m) - hours * 3600_000))
          .replace(/\b17\d{8}\b/g, (m) => String(Number(m) - hours * 3600))
        await cache.put(req, new Response(older, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
        aged++
      }
      return aged
    },
    { pagesCache, hours },
  )

export function offlineHoldSuite({
  path,
  rows,
  pagesCache,
  departures,
  pin,
  prepare,
  holdMs = 65_000,
  label = '',
}: {
  /** Names a variant (e.g. "saved"). */
  label?: string
  /** A board page. */
  path: string
  /** Selector of a departure row. */
  rows: string
  pagesCache: string
  /** Matches the board's polled departures requests (pathname). */
  departures: RegExp
  /** Routes the departures so a row is due (and live while online) at any hour: the apps' tests/upcoming.ts. */
  pin: (context: BrowserContext) => Promise<unknown>
  /** Runs before the first load (saved items and the like). */
  prepare?: (page: Page) => Promise<unknown>
  holdMs?: number
}) {
  const kinds = [
    { name: 'offline', flaky: false, go: (context: BrowserContext) => goOffline(context) },
    {
      name: 'flaky (service worker cut off, the page still reaching the network)',
      flaky: true,
      go: partialOffline,
    },
  ] as const
  test.describe(`R6-B1: a board held offline stays an offline timetable board${label ? ` (${label})` : ''}`, () => {
    for (const kind of kinds)
      for (const reload of [false, true])
        test(`${path}: ${kind.name}${reload ? ", reloaded with last night's page copy," : ''} for over a minute, then LIVE returns`, async ({
          page,
          context,
        }) => {
          test.setTimeout(holdMs + 120_000)
          await prepare?.(page)
          await pin(context)
          await page.goto(path)
          await waitForServiceWorker(page, pagesCache)
          // A poll through the service worker, so its cache holds a pinned answer (a row due in 10 minutes).
          await page.waitForResponse((r) => departures.test(new URL(r.url()).pathname), { timeout: 20_000 })
          await page.waitForTimeout(1_000)
          await context.unrouteAll({ behavior: 'ignoreErrors' })
          await expect(page.locator(rows).first()).toBeVisible()
          expect(await visibleLiveClaims(page)).not.toEqual([])

          if (reload) expect(await ageCachedPage(page, pagesCache, 6)).toBeGreaterThan(0)
          const goOnline = await kind.go(context, page)
          if (reload) {
            // Dev's sequence: LIVE online, DevTools offline, reload (the service worker serves the old page copy),
            // watched from the reloaded page's first frame.
            await page.addInitScript(watcher, rows)
            await page.reload()
            if (kind.flaky) await flap(page)
            await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
          } else {
            await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
            await page.evaluate(watcher, rows)
          }
          await page.waitForTimeout(holdMs)
          expect(await stopWatching(page)).toEqual([])

          await goOnline()
          await pin(context)
          await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 10_000 })
          // The next pinned poll has a live row (the reconnect refetch may still be unpinned).
          await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
        })
  })
}
