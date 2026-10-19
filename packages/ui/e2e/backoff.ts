/**
 * The offline-backoff suite every app runs (smoke round 9: offline or under lie-fi the boards retried with no backoff,
 * bus ~80 failed requests in 50 s, transit / with saved stops 40 /v1 calls a minute). Under lie-fi (every /v1 call
 * fails, navigator.onLine stays true) a minute costs each board at most 10 calls and polling never stops; LIVE returns
 * within seconds of the first answer that gets through, and at once on the browser's `online` event. Offline
 * (navigator.onLine false) the boards don't poll at all, and they ask again at once with the `online` event. Times
 * are taken from each answer, so the fixture server's own latency under a parallel run doesn't count.
 */
import { type BrowserContext, expect, type Page, type Request, test } from '@playwright/test'
import { goOffline, visibleLiveClaims, waitForServiceWorker } from './offline.ts'

/** Live API calls, the fixture copies included. */
const LIVE = /\/v1\//

/** The page's own live calls (one per attempt; the service worker's fetches for them are not counted again). */
function countCalls(page: Page) {
  const calls: Array<{ at: number; url: string }> = []
  const onRequest = (r: Request) => {
    const url = new URL(r.url())
    if (LIVE.test(url.pathname)) calls.push({ at: Date.now(), url: url.pathname + url.search })
  }
  page.on('request', onRequest)
  return {
    /** Calls per URL since `from`. */
    since(from: number) {
      const per = new Map<string, number>()
      for (const c of calls) if (c.at >= from) per.set(c.url, (per.get(c.url) ?? 0) + 1)
      return per
    },
    stop: () => page.off('request', onRequest),
  }
}

/** Lie-fi as the lead measured it on staging: every /v1 call fails (the service worker's too), navigator.onLine true. */
async function lieFi(context: BrowserContext): Promise<() => Promise<void>> {
  const handler = (route: import('@playwright/test').Route) => route.abort('internetdisconnected')
  const matches = (url: URL) => LIVE.test(url.pathname)
  await context.route(matches, handler)
  return () => context.unroute(matches, handler)
}

export function backoffSuite({
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
  const open = async (page: Page, context: BrowserContext) => {
    await prepare?.(page)
    await pin(context)
    await page.goto(path)
    await waitForServiceWorker(page, pagesCache)
    await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
  }
  const boardsOf = (per: Map<string, number>) =>
    [...per.keys()].filter((u) => departures.test(u.split('?')[0] ?? u))
  // A network answer for a board (not the service worker's cached copy of one).
  const answered = (page: Page) =>
    page.waitForResponse(
      (r) => departures.test(new URL(r.url()).pathname) && r.ok() && !r.headers()['x-bft-cache'],
      { timeout: 75_000 },
    )

  test.describe(`offline backoff (smoke round 9)${label ? ` (${label})` : ''}`, () => {
    test(`${path}: a minute of lie-fi costs each board at most 10 /v1 calls, polling never stops, and LIVE returns within seconds of the first answer`, async ({
      page,
      context,
    }) => {
      test.setTimeout(240_000)
      await open(page, context)
      const calls = countCalls(page)
      const restore = await lieFi(context)
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
      const from = Date.now()
      await page.waitForTimeout(60_000)
      const per = calls.since(from)
      const boards = boardsOf(per)
      console.log(`${path}: /v1 calls in 60 s of lie-fi`, Object.fromEntries(per))
      expect(boards.length).toBeGreaterThan(0)
      // Bounded for every live URL (boards, alerts, vehicles), and still trying: each board asked at least twice.
      for (const [url, n] of per) expect(n, url).toBeLessThanOrEqual(10)
      for (const url of boards) expect(per.get(url), url).toBeGreaterThanOrEqual(2)

      // The network is back with no event: the next attempt comes at the backed-off time, then LIVE within seconds.
      const back = Date.now()
      const first = answered(page)
      await restore()
      await first
      const answeredAt = Date.now()
      console.log(`${path}: first answer ${answeredAt - back} ms after the network returned`)
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 5_000 })
      await expect.poll(() => visibleLiveClaims(page), { timeout: 5_000, intervals: [100] }).not.toEqual([])
      console.log(`${path}: LIVE ${Date.now() - answeredAt} ms after the first answer`)
      calls.stop()
    })

    test(`${path}: after lie-fi, the browser's online event brings LIVE back within seconds`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000)
      await open(page, context)
      const restore = await lieFi(context)
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
      // Long enough for the waits to have grown past the time allowed below.
      await page.waitForTimeout(25_000)
      await restore()
      const back = Date.now()
      // An attempt at once, and LIVE within seconds of its answer (the fixture server's own time not counted).
      const asked = page.waitForRequest((r) => departures.test(new URL(r.url()).pathname), { timeout: 2_000 })
      const first = answered(page)
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await asked
      await first
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 5_000 })
      await expect.poll(() => visibleLiveClaims(page), { timeout: 5_000, intervals: [100] }).not.toEqual([])
      console.log(`${path}: LIVE ${Date.now() - back} ms after the online event`)
    })

    test(`${path}: offline (navigator.onLine false) the boards don't poll, and back online LIVE returns at once`, async ({
      page,
      context,
    }) => {
      test.setTimeout(120_000)
      await open(page, context)
      const calls = countCalls(page)
      const goOnline = await goOffline(context)
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
      const from = Date.now()
      await page.waitForTimeout(35_000)
      const per = calls.since(from)
      console.log(`${path}: /v1 calls in 35 s offline`, Object.fromEntries(per))
      // None at all, not even a poll timed before the browser said it was offline (Codex r1).
      expect(Object.fromEntries(per)).toEqual({})

      const back = Date.now()
      const asked = page.waitForRequest((r) => departures.test(new URL(r.url()).pathname), { timeout: 2_000 })
      const first = answered(page)
      await goOnline()
      await asked
      await first
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 5_000 })
      await expect.poll(() => visibleLiveClaims(page), { timeout: 5_000, intervals: [100] }).not.toEqual([])
      console.log(`${path}: LIVE ${Date.now() - back} ms after coming back online`)
      calls.stop()
    })
  })
}
