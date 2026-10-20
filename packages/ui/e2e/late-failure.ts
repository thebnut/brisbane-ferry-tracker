/**
 * A late /v1 failure must not undo a reconnect (staging R6-B1, 20 Oct: LIVE took 17 s to come back). Back online, a
 * board's first request fails while another live call reaches the network just after: that answer cancelled the
 * probe, and onReconnect's 1 s throttle dropped the reconnect it caused, so the board stayed "Offline · scheduled"
 * until its own 15 s poll. Now the second reconnect runs at the end of the window. The outage lasts longer than
 * LIVE_REFRESH_MAX_AGE_MS, so LIVE needs the board's own fresh answer.
 */
import { type BrowserContext, expect, type Page, type Route, test } from '@playwright/test'
import { LIVE_REFRESH_MAX_AGE_MS, RECONNECT_PROBE_MS } from '../src/connectivity.ts'
import { goOffline, visibleLiveClaims, waitForServiceWorker } from './offline.ts'

/** Time allowed from a request to its answer and the page seeing it (fixture server, parallel run). */
const ANSWER_MARGIN_MS = 2_000
/** Live API calls, the fixture copies included. */
const LIVE = /\/v1\//

export function lateFailureSuite({
  path,
  departures,
  pagesCache,
  pin,
  prepare,
  label = '',
}: {
  /** A board page. */
  path: string
  /** Matches the boards' polled departures requests (pathname). */
  departures: RegExp
  pagesCache: string
  /** Routes the departures so a row is due (and live while online) at any hour: the apps' tests/upcoming.ts. */
  pin: (context: BrowserContext) => Promise<unknown>
  /** Runs before the first load (saved items and the like). */
  prepare?: (page: Page) => Promise<unknown>
  /** Names a variant. */
  label?: string
}) {
  test(`${path}${label ? ` (${label})` : ''}: a board's reconnect request failing while another call answers doesn't leave it offline until its next poll`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000)
    await prepare?.(page)
    await pin(context)
    await page.goto(path)
    await waitForServiceWorker(page, pagesCache)
    await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
    const goOnline = await goOffline(context)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
    // Past LIVE_REFRESH_MAX_AGE_MS even by a clock that ticks only every 15 s (the transit home's useNow).
    await page.waitForTimeout(LIVE_REFRESH_MAX_AGE_MS + 20_000)

    // Back online: one board's requests made in the first 500 ms fail 300 ms in (every one, so a second request for
    // it at the reconnect can't cover for the first); every other live call answers 600 ms in, after them.
    let failed: string | null = null
    let back = Number.POSITIVE_INFINITY
    const late = async (route: Route) => {
      const url = new URL(route.request().url())
      if (
        departures.test(url.pathname) &&
        (failed ?? url.pathname) === url.pathname &&
        Date.now() >= back &&
        Date.now() - back < 500
      ) {
        failed = url.pathname
        await new Promise((r) => setTimeout(r, 300))
        return route.abort('internetdisconnected')
      }
      await new Promise((r) => setTimeout(r, 600))
      return route.fallback()
    }
    await context.route((url) => LIVE.test(url.pathname), late)
    // The board that failed asks again at the end of onReconnect's 1 s window (or, with no other call to cancel the
    // probe, at the 2.5 s probe), and the network answers it: not at its own 15 s poll. Its own answer, since on a page
    // with several boards the others' LIVE claims show anyway.
    const bound = RECONNECT_PROBE_MS + ANSWER_MARGIN_MS
    const again = page.waitForResponse(
      (r) => {
        const url = new URL(r.url())
        return url.pathname === failed && r.ok() && !r.headers()['x-bft-cache'] && Date.now() - back >= 500
      },
      { timeout: bound + 500 },
    )
    again.catch(() => {})
    back = Date.now()
    await goOnline()
    await again
    console.log(`${path}: the failed board answered ${Date.now() - back} ms after coming back online`)
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: bound })
    await expect.poll(() => visibleLiveClaims(page), { timeout: bound, intervals: [100] }).not.toEqual([])
    console.log(`${path}: LIVE ${Date.now() - back} ms after coming back online (failed first: ${failed})`)
    expect(failed).not.toBeNull()
    await context.unroute((url) => LIVE.test(url.pathname), late)
  })
}
