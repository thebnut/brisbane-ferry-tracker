/**
 * The offline-backoff suite every app runs (smoke round 9: offline or under lie-fi the boards retried with no backoff,
 * bus ~80 failed requests in 50 s, transit / with saved stops 40 /v1 calls a minute). Under lie-fi (every /v1 call
 * fails, navigator.onLine stays true) a minute costs each board at most 10 calls and polling never stops; once an
 * answer gets through every board asks again, and LIVE returns within seconds of their answers; at once on the
 * browser's `online` event. Offline (navigator.onLine false) the boards don't poll at all, and they ask again at once
 * with the `online` event. Times are taken from each board's answer, so the fixture server's own latency under a
 * parallel run doesn't count.
 */
import {
  type BrowserContext,
  expect,
  type Page,
  type Request,
  type Response,
  type Route,
  test,
} from '@playwright/test'
import { BACKOFF_MAX_MS, LIVE_REQUEST_TIMEOUT_MS, RECONNECT_PROBE_MS } from '../src/connectivity.ts'
import { goOffline, visibleLiveClaims, waitForServiceWorker } from './offline.ts'

/** Time allowed from the probe's request to its answer and the page seeing it (fixture server, parallel run). */
const ANSWER_MARGIN_MS = 2_000

/**
 * The latest time (ms after an outage began) at which the probe must ask again after the network returns
 * `elapsedMs` into the outage, from the schedule's constants (probeWhileUnreachable): waits of RECONNECT_PROBE_MS
 * doubling up to BACKOFF_MAX_MS, each up to a fifth shorter. A probe due earlier may already have gone, early, while
 * the network was still out, so this is the first probe that can't have gone before `elapsedMs`; it goes no later
 * than its full-length time. A stuck or over-long backoff misses it.
 */
export function probeDueByMs(elapsedMs: number): number {
  let latest = 0
  let earliest = 0
  for (let n = 0; ; n++) {
    const wait = Math.min(BACKOFF_MAX_MS, RECONNECT_PROBE_MS * 2 ** n)
    latest += wait
    earliest += wait * 0.8
    if (earliest >= elapsedMs) return latest
  }
}

/**
 * After the first answer, by when every board on the page has its own network answer. That first answer makes every
 * board ask again at once (onReconnect); a request the fixture server is slow with is abandoned at
 * LIVE_REQUEST_TIMEOUT_MS, and the probe then asks again within RECONNECT_PROBE_MS, its answer within the margin.
 */
const EVERY_BOARD_MS = LIVE_REQUEST_TIMEOUT_MS + RECONNECT_PROBE_MS + ANSWER_MARGIN_MS

/**
 * After the last board's answer, by when the offline banner has gone: the banner stays while any board still shows an
 * offline copy (R6-B1), so it waits for the boards' answers, not the first one, and then goes as the page renders.
 * Also when a call cut off before the network returned reports its failure late: that no longer marks the connection
 * down (trackedFetch), so it no longer undoes the boards' answers (#121 allowed one board poll for it; late-failure.ts
 * covers the case).
 */
const BANNER_AFTER_ANSWERS_MS = ANSWER_MARGIN_MS

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
  boards,
  label = '',
}: {
  /** A board page. */
  path: string
  /** Matches the boards' polled departures requests (pathname). */
  departures: RegExp
  pagesCache: string
  /** Routes the departures so a row is due (and live while online) at any hour: the apps' tests/upcoming.ts. */
  pin: (context: BrowserContext) => Promise<unknown>
  /**
   * How many boards the page polls (distinct departures URLs): every one must answer after an outage, so a board that
   * stops asking can't drop out of the set the test waits for.
   */
  boards: number
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
  const answered = (page: Page, timeout = 10_000) =>
    page.waitForResponse(
      (r) => departures.test(new URL(r.url()).pathname) && r.ok() && !r.headers()['x-bft-cache'],
      { timeout },
    )

  /**
   * Each board's first network answer from now on (by pathname + search, as countCalls keys them), to a request made
   * by `madeBy`. The banner and LIVE are timed from the last board's answer: the
   * fixture server answers the boards one by one, slowly under a parallel run, and its latency doesn't count (timed
   * from the first answer, the banner wait was flaky).
   */
  const boardAnswers = async (page: Page, context: BrowserContext) => {
    /** When the page last made each board's request (one at a time per board: a refetch joins the one in flight). */
    const madeAt = new Map<string, number>()
    const at = new Map<string, number>()
    const state = { madeBy: Number.POSITIVE_INFINITY }
    // When the page made each board request: from a route (the newest runs first, before the outage's and the pinned
    // fixtures'), since Playwright reports a routed request only once its handlers are done, so after the fixture
    // server's time.
    const isBoard = (url: URL) => departures.test(url.pathname)
    const made = (route: Route) => {
      const url = new URL(route.request().url())
      madeAt.set(url.pathname + url.search, Date.now())
      return route.fallback()
    }
    await context.route(isBoard, made)
    const onResponse = (r: Response) => {
      const url = new URL(r.url())
      const key = url.pathname + url.search
      const madeTime = madeAt.get(key)
      if (
        departures.test(url.pathname) &&
        r.ok() &&
        !r.headers()['x-bft-cache'] &&
        madeTime !== undefined &&
        madeTime <= state.madeBy &&
        !at.has(key)
      )
        at.set(key, Date.now())
    }
    page.on('response', onResponse)
    return {
      at,
      state,
      /** The time of the first answer: an attempt made by `madeBy` that the network answered. */
      first: (timeout: number) =>
        expect
          .poll(() => at.size, { timeout, intervals: [50] })
          .toBeGreaterThan(0)
          .then(() => Date.now()),
      async stop() {
        await context.unroute(isBoard, made)
        page.off('response', onResponse)
      },
    }
  }
  /** Every board answers (by the schedule's bound after the first answer), then the banner goes and LIVE returns. */
  const backOnline = async (
    page: Page,
    answers: Awaited<ReturnType<typeof boardAnswers>>,
    firstAt: number,
    back: number,
  ) => {
    try {
      await expect
        .poll(() => answers.at.size, {
          timeout: Math.max(1, firstAt + EVERY_BOARD_MS - Date.now()),
          intervals: [50],
        })
        .toBe(boards)
    } finally {
      await answers.stop()
    }
    const times = [...answers.at.values()]
    const lastAt = Math.max(...times)
    console.log(
      `${path}: board answers (ms after the network returned)`,
      Object.fromEntries([...answers.at].map(([b, t]) => [b, t - back])),
    )
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0, {
      timeout: BANNER_AFTER_ANSWERS_MS,
    })
    await expect.poll(() => visibleLiveClaims(page), { timeout: 5_000, intervals: [100] }).not.toEqual([])
    return lastAt
  }

  test.describe(`offline backoff (smoke round 9)${label ? ` (${label})` : ''}`, () => {
    test(`${path}: a minute of lie-fi costs each board at most 10 /v1 calls, polling never stops, and LIVE returns within seconds of the boards' answers`, async ({
      page,
      context,
    }) => {
      test.setTimeout(240_000)
      await open(page, context)
      const calls = countCalls(page)
      const restore = await lieFi(context)
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 20_000 })
      // The outage began at or just before the banner (its first failed call).
      const from = Date.now()
      await page.waitForTimeout(60_000)
      const per = calls.since(from)
      const asking = boardsOf(per)
      console.log(`${path}: /v1 calls in 60 s of lie-fi`, Object.fromEntries(per))
      expect(asking.length, 'every board asked during the outage').toBe(boards)
      // Bounded for every live URL (boards, alerts, vehicles), and still trying: each board asked at least twice.
      for (const [url, n] of per) expect(n, url).toBeLessThanOrEqual(10)
      for (const url of asking) expect(per.get(url), url).toBeGreaterThanOrEqual(2)

      // The network is back with no event: the next attempt comes at the backed-off time (no later than the schedule
      // allows, plus a margin of up to 1 s for when the outage began before the banner), then LIVE within seconds.
      // Then every board's own answer (the banner waits for all of them), and the banner and LIVE within seconds of
      // the last one.
      const back = Date.now()
      const answers = await boardAnswers(page, context)
      const first = answered(page, probeDueByMs(back - from + 1_000) - (back - from) + ANSWER_MARGIN_MS)
      await restore()
      await first
      const answeredAt = Date.now()
      console.log(`${path}: first answer ${answeredAt - back} ms after the network returned`)
      const lastAt = await backOnline(page, answers, answeredAt, back)
      console.log(`${path}: LIVE ${Date.now() - lastAt} ms after the last board's answer`)
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
      // Every board's answer must be to an attempt made by then too.
      const answers = await boardAnswers(page, context)
      // An attempt at once, and LIVE within seconds of the boards' answers (the fixture server's own time not
      // counted). Watched from before the network returns: a backed-off probe can get through first (even while
      // restore() runs), and its reconnect refetch would then throttle the online event's. The attempts that count are
      // ones the network answered (not a probe still cut off), made no later than 2 s after the event.
      await restore()
      const back = Date.now()
      answers.state.madeBy = back + 2_000
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      const firstAt = await answers.first(10_000)
      await backOnline(page, answers, firstAt, back)
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

      // Every board asks at once (no later than 2 s after the event), and each answer counts from then.
      const back = Date.now()
      const answers = await boardAnswers(page, context)
      answers.state.madeBy = back + 2_000
      await goOnline()
      const firstAt = await answers.first(10_000)
      await backOnline(page, answers, firstAt, back)
      console.log(`${path}: LIVE ${Date.now() - back} ms after coming back online`)
      calls.stop()
    })
  })
}
