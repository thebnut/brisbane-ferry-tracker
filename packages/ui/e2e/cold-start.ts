/**
 * The R8-F1 cold-start suite (Dev, smoke round 8, ferry staging): site data cleared, so no service worker and no
 * precache; an offline reload rendered the page from Chrome's HTTP cache; back online, reloads stayed OFFLINE with
 * "Offline · scheduled" for over a minute while the departures calls stayed pending (bft-api held them open for
 * minutes, and nothing on the page timed them out). The first-run stop selector was open throughout.
 *
 * Both variants run with service workers blocked (a cleared profile before the worker is back). The HTTP cache is
 * primed the way Chrome's works: every document and /assets file the first online load received is kept, and
 * replayed while offline; everything else fails as disconnected.
 */
import { type BrowserContext, expect, type Page, type Route, test } from '@playwright/test'
import { visibleLiveClaims } from './offline.ts'

/** Records what the page received, and replays documents and assets from it while `offline` is on. */
async function httpCache(context: BrowserContext, page: Page) {
  const kept = new Map<string, { status: number; headers: Record<string, string>; body: Buffer }>()
  page.on('response', async (res) => {
    const req = res.request()
    const path = new URL(req.url()).pathname
    if (req.resourceType() !== 'document' && !path.startsWith('/assets/')) return
    if (res.status() !== 200) return
    try {
      kept.set(req.url(), { status: 200, headers: res.headers(), body: await res.body() })
    } catch {
      // A response the page dropped (navigated away): nothing to keep.
    }
  })
  let offline = false
  const handler = async (route: Route) => {
    if (!offline) return route.fallback()
    const hit = kept.get(route.request().url())
    return hit ? route.fulfill(hit) : route.abort('internetdisconnected')
  }
  await context.route('**/*', handler)
  return {
    goOffline: async () => {
      offline = true
      await context.setOffline(true)
    },
    goOnline: async () => {
      offline = false
      await context.setOffline(false)
    },
    has: (url: string) => kept.has(url),
  }
}

/** The header's OFFLINE pill (chrome.tsx LivePill). */
const offlinePill = (page: Page) => page.getByText('OFFLINE', { exact: true })

export function coldStartSuite({
  path,
  departures,
  pin,
  firstRunDialog,
  prepare,
  recoverWithinMs = 5_000,
}: {
  /** Runs before the first load: keeps every load a first run (Dev's profile had just been cleared). */
  prepare?: (page: Page) => Promise<unknown>
  /** A board page, opened with no saved state (a cleared profile). */
  path: string
  /** Matches the board's polled departures requests (URL). */
  departures: RegExp
  /** Routes the departures so a row is due and live at any hour: the apps' tests/upcoming.ts. */
  pin: (context: BrowserContext) => Promise<unknown>
  /** The first-run dialog the page opens over the board, if any (its accessible name). */
  firstRunDialog?: string
  /** How soon after an answer the page must leave OFFLINE. */
  recoverWithinMs?: number
}) {
  test.describe('R8-F1: cold start from the HTTP cache, offline, then back online', () => {
    test.use({ serviceWorkers: 'block' })

    const dialogStays = async (page: Page) => {
      if (firstRunDialog) await expect(page.getByRole('dialog', { name: firstRunDialog })).toBeVisible()
    }

    test(`${path}: an offline reload is an offline board; back online it leaves OFFLINE within seconds`, async ({
      page,
      context,
    }) => {
      test.slow()
      await prepare?.(page)
      const cache = await httpCache(context, page)
      await pin(context)
      await page.goto(path)
      await dialogStays(page)
      expect(cache.has(page.url())).toBe(true)

      await cache.goOffline()
      await page.reload()
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 15_000 })
      await expect(offlinePill(page)).toBeVisible()
      await page.waitForTimeout(1_000)
      expect(await visibleLiveClaims(page)).toEqual([])

      await cache.goOnline()
      await page.reload()
      await dialogStays(page)
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: recoverWithinMs })
      await expect(offlinePill(page)).toHaveCount(0)
      await expect(page.getByText('Offline · scheduled')).toHaveCount(0)
      // The next poll (pinned) has a live row.
      await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
      // And it stays online: no departures call is left hanging into OFFLINE.
      await page.waitForTimeout(10_000)
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0)
      await dialogStays(page)
    })

    test(`${path}: departures calls that never answer time out, and the board recovers once the API answers`, async ({
      page,
      context,
    }) => {
      test.slow()
      await prepare?.(page)
      await pin(context)
      await page.goto(path)
      await dialogStays(page)

      // The API holds every departures call open (R8-F1: bft-api held some for minutes) and never answers them.
      let hanging = true
      const held: Route[] = []
      const failed: string[] = []
      page.on('requestfailed', (r) => {
        if (departures.test(r.url())) failed.push(r.url())
      })
      await context.route(departures, (route) => {
        if (hanging) held.push(route)
        else return route.fallback()
      })
      await page.reload()
      await dialogStays(page)
      await expect.poll(() => held.length, { timeout: 30_000 }).toBeGreaterThan(0)
      // Nothing answers, so the page says so...
      await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 15_000 })
      expect(await visibleLiveClaims(page)).toEqual([])
      // ...and gives the hung calls up (the browser abandons them) instead of waiting on them forever.
      await expect.poll(() => failed.length, { timeout: 15_000 }).toBeGreaterThan(0)

      // The API answers again; the held calls never will.
      hanging = false
      const answeredAt = Date.now()
      // Within one client timeout (a call started just before is still held) plus a probe, and a margin.
      await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 15_000 })
      expect(Date.now() - answeredAt).toBeLessThan(15_000)
      await expect(offlinePill(page)).toHaveCount(0)
      await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
      await dialogStays(page)
    })
  })
}
