/**
 * Device clock skew (smoke round 15, R15-S1) and the useNow false LIVE, for every app's board pages. Ages are measured
 * server time against server time and device time against device time (@bft/ui connectivity, sourceAgeS), so:
 *  - a fresh page on a device whose clock is minutes off shows no OFFLINE, "Offline · scheduled" or "You are
 *    offline", and shows LIVE at once, without waiting for a 15 s poll (Dev saw OFFLINE for 15–20 s at +5 min,
 *    and at +2 min on the train board);
 *  - with the clock minutes slow, data that really is over a minute old (the API answering errors) is never LIVE;
 *  - a render between two useNow ticks (a reconnect) judges age as of that render: data over a minute old is never
 *    LIVE, even for an instant.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { visibleLiveClaims } from './offline.ts'

const OFFLINE_TEXT = /\bOFFLINE\b|Offline · scheduled|You are offline/
const MIN = 60_000
const SKEWS_MIN = [2, 5, 30, -2, -5, -30]
/** Live API calls (and the fixture copies). */
const LIVE_API = /^(?:\/__fixtures)?\/v1\//

/**
 * The device clock `offsetMs` off the real one, from the first script on (as Dev's smoke script did). The offset can
 * move later (advanceDeviceClock): device time passes without the test waiting for it, and timers stay real.
 */
const skewClock = (page: Page, offsetMs: number) =>
  page.addInitScript((off) => {
    const w = window as unknown as { __skew: number }
    w.__skew = off
    const D = Date
    class Skewed extends D {
      constructor(...a: ConstructorParameters<DateConstructor> | []) {
        super(...((a.length ? a : [D.now() + w.__skew]) as [number]))
      }
      static now() {
        return D.now() + w.__skew
      }
    }
    window.Date = Skewed as DateConstructor
  }, offsetMs)

/** `ms` of device time pass at once (the monotonic clock doesn't move: an upper bound on age only grows). */
const advanceDeviceClock = (page: Page, ms: number) =>
  page.evaluate((d) => {
    ;(window as unknown as { __skew: number }).__skew += d
  }, ms)

/** Records, from the first paint on, whether offline text or a LIVE claim showed (and when, in ms since navigation). */
const recordStates = (page: Page, noPill: boolean) =>
  page.addInitScript(
    ([offline, noPill]) => {
      const w = window as unknown as { __states: { offline: string[]; liveAt: number | null } }
      w.__states = { offline: [], liveAt: null }
      const re = new RegExp(String(offline))
      const tick = () => {
        const text = document.body?.innerText ?? ''
        // Not the bare pill on a page whose header says OFFLINE until its boards have answered.
        const m = re.exec(noPill ? text.replace(/\bOFFLINE\b/g, '') : text)
        if (m) w.__states.offline.push(`${Math.round(performance.now())} ms: ${m[0]}`)
        if (
          w.__states.liveAt == null &&
          [...document.querySelectorAll<HTMLElement>('[data-live-claim], [data-badge=live], span')].some(
            (el) =>
              (el.matches('[data-live-claim], [data-badge=live]') ||
                (el.childElementCount === 0 && el.textContent?.trim() === 'LIVE')) &&
              el.checkVisibility(),
          )
        )
          w.__states.liveAt = Math.round(performance.now())
        if (performance.now() < 8_000) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    [OFFLINE_TEXT.source, noPill] as const,
  )

/** Every live API call answers 503 (the API is failing, the network is fine) until the returned function lifts it. */
async function apiErrors(context: BrowserContext): Promise<() => Promise<void>> {
  const matches = (url: URL) => LIVE_API.test(url.pathname)
  const handler = (route: import('@playwright/test').Route) =>
    route.fulfill({ status: 503, json: { error: 'upstream_unavailable' } })
  await context.route(matches, handler)
  return () => context.unroute(matches, handler)
}

export function clockSkewSuite({
  path,
  label = path,
  prepare,
  pin,
  pendingSaysOffline = false,
}: {
  /** A page with live boards (its header shows LIVE while they are live). */
  path: string
  label?: string
  /** Runs before the first load (saved items and the like). */
  prepare?: (page: Page) => Promise<unknown>
  /** Routes the departures so a row is due and live at any hour (the apps' tests/upcoming.ts). */
  pin?: (context: BrowserContext) => Promise<unknown>
  /**
   * The page's header pill says OFFLINE until its boards have answered, whatever the clock (the transit home: a
   * card still waiting is never LIVE, R7-T1): only the offline banners' texts count there.
   */
  pendingSaysOffline?: boolean
}) {
  test.describe(`clock skew (R15-S1): ${label}`, () => {
    for (const min of SKEWS_MIN) {
      test(`a fresh page with the device clock ${min > 0 ? '+' : ''}${min} min is never offline, and LIVE before the first poll`, async ({
        page,
        context,
      }) => {
        await prepare?.(page)
        await pin?.(context)
        await skewClock(page, min * MIN)
        await recordStates(page, pendingSaysOffline)
        await page.goto(path)
        // The first poll is 15 s after mount: LIVE well before it, from the page's own data or its first answer.
        await page.waitForTimeout(4_000)
        const states = await page.evaluate(
          () => (window as unknown as { __states: { offline: string[]; liveAt: number | null } }).__states,
        )
        expect(states.offline).toEqual([])
        expect(states.liveAt, 'LIVE within 4 s').not.toBeNull()
        await expect.poll(() => visibleLiveClaims(page)).not.toEqual([])
      })
    }

    /** After `ms` more device time with the API failing, the browser says it is online (a reconnect): boards render. */
    const reconnectAfter = async (page: Page, context: BrowserContext, ms: number) => {
      await apiErrors(context)
      await advanceDeviceClock(page, ms)
      const failed = page.waitForResponse(
        (r) => LIVE_API.test(new URL(r.url()).pathname) && r.status() === 503,
      )
      await page.evaluate(() => window.dispatchEvent(new Event('online')))
      await failed
    }

    test('with the device clock 5 min slow, data over a minute old is never LIVE', async ({
      page,
      context,
    }) => {
      await prepare?.(page)
      await pin?.(context)
      await skewClock(page, -5 * MIN)
      await page.goto(path)
      await expect.poll(() => visibleLiveClaims(page), { timeout: 15_000 }).not.toEqual([])
      // The API fails from now on, and 62 s pass: what the boards have is over a minute old. By a slow device clock
      // against the server's generatedAt it was still 4 minutes "in the future".
      await reconnectAfter(page, context, 62_000)
      await expect.poll(() => visibleLiveClaims(page), { timeout: 2_000 }).toEqual([])
    })

    test('a render between two clock ticks (a reconnect) never shows LIVE on data over a minute old', async ({
      page,
      context,
    }) => {
      await prepare?.(page)
      await pin?.(context)
      await skewClock(page, 0)
      await page.goto(path)
      await expect.poll(() => visibleLiveClaims(page), { timeout: 15_000 }).not.toEqual([])
      // 62 s pass between two useNow ticks (every 15 s, 5 s on ferry): the reconnect's render judges the data as of
      // now, not as of the last tick.
      await reconnectAfter(page, context, 62_000)
      await page.waitForTimeout(300)
      expect(await visibleLiveClaims(page)).toEqual([])
    })
  })
}
