/**
 * The R9 suite every app runs against a server where demo mode is allowed but not forced (ALLOW_FIXTURES=1,
 * FIXTURES=0, as on staging; see each app's `demo-allowed` Playwright project). There the first load runs the
 * one-off clean-up of demo data stored before R7-B1 (demo-cleanup.ts), which used to delete every runtime cache: the
 * page copies this first visit and the service worker's install had just saved went with it, so an offline load
 * could give the "page isn't saved" page. The clean-up now removes only what the device held when the page started.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { bodyFont, goOffline, waitForServiceWorker } from './offline.ts'

const MARKER = 'bft-demo-cleanup'

/** The one-off clean-up has finished on this device. */
const cleanedUp = (page: Page) =>
  page.waitForFunction((key) => localStorage.getItem(key) === 'r7', MARKER, { timeout: 30_000 })

/** Paths saved in a cache (pathname + search). Uses the real Cache Storage listing when the test holds the page's. */
const savedPaths = (page: Page, cacheName: string) =>
  page.evaluate(async (name) => {
    const w = window as { __cacheNames?: () => Promise<string[]> }
    if (!(await (w.__cacheNames?.() ?? caches.keys())).includes(name)) return []
    return (await (await caches.open(name)).keys()).map((r) => {
      const u = new URL(r.url)
      return u.pathname + u.search
    })
  }, cacheName)

/** The service worker controls the page and has saved `paths` in its page cache. */
const pagesSaved = async (page: Page, cacheName: string, paths: string[]) => {
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 30_000 })
    .toBe(true)
  await expect
    .poll(() => savedPaths(page, cacheName), { timeout: 30_000 })
    .toEqual(expect.arrayContaining(paths))
}

/** Offline, each path opens as the styled app from its saved copy: not the service worker's "page isn't saved" page. */
async function opensOffline(context: BrowserContext, paths: string[]) {
  await goOffline(context)
  for (const path of paths) {
    const page = await context.newPage()
    await page.goto(path)
    await expect(page.locator('[data-offline-page]'), path).toHaveCount(0)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible({ timeout: 10_000 })
    expect(await bodyFont(page)).toContain('Inter')
    await page.close()
  }
}

export function demoCleanupSuite({
  path,
  pagesCache,
  installPages = [],
  runs = 6,
}: {
  /** The first page opened on a fresh device. */
  path: string
  pagesCache: string
  /** Pages the service worker saves at install (transit: the home). */
  installPages?: string[]
  /** Fresh-device repeats: the race lost 2 of 6 runs on staging. */
  runs?: number
}) {
  // What must open offline after the first visit: the page itself, and every install-time page.
  const mustOpen = [...new Set([path, ...installPages])]

  test.describe('R9: the one-off demo clean-up keeps what this visit saved (demo mode allowed, as on staging)', () => {
    test.slow()

    for (let run = 1; run <= runs; run++)
      test(`fresh device, first visit ${path}, then offline: every saved page opens (run ${run} of ${runs})`, async ({
        page,
        context,
      }) => {
        await page.goto(path)
        await waitForServiceWorker(page, pagesCache)
        await cleanedUp(page)
        // Give a late clean-up every chance to remove what was saved before checking.
        await page.waitForTimeout(500)
        expect(await savedPaths(page, pagesCache)).toEqual(expect.arrayContaining(mustOpen))
        await opensOffline(context, mustOpen)
      })

    test(`the clean-up finishing last (forced) still leaves this visit's and the install's copies`, async ({
      page,
      context,
    }) => {
      // The clean-up as slow as it can be: every Cache Storage listing the page asks for once its document has
      // parsed (the clean-up's own, which decides what to delete) answers only after the service worker has
      // installed, saved its pages and this page's copy. Holding the clean-up's chunk instead would delay `load`,
      // and with it the service worker's registration.
      await context.addInitScript(() => {
        const real = CacheStorage.prototype.keys
        let release = () => {}
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        const w = window as { __releaseCacheNames?: () => void; __cacheNames?: () => Promise<string[]> }
        w.__releaseCacheNames = release
        w.__cacheNames = () => real.call(caches)
        let parsed = false
        document.addEventListener('DOMContentLoaded', () => {
          parsed = true
        })
        CacheStorage.prototype.keys = function (this: CacheStorage) {
          return parsed ? held.then(() => real.call(this)) : real.call(this)
        }
      })
      await page.goto(path)
      await pagesSaved(page, pagesCache, mustOpen)
      await page.evaluate(() => (window as { __releaseCacheNames?: () => void }).__releaseCacheNames?.())
      await cleanedUp(page)
      await page.waitForTimeout(500)
      await pagesSaved(page, pagesCache, mustOpen)
      await opensOffline(context, mustOpen)
    })

    test('a device with copies and caches from before R7-B1: those go, and the saved pages come back', async ({
      page,
      context,
    }) => {
      await page.goto(path)
      await waitForServiceWorker(page, pagesCache)
      await cleanedUp(page)
      // As on a device that last used demo mode before R7-B1: the clean-up hasn't run, and old copies are there.
      await page.evaluate(async (key) => {
        localStorage.removeItem(key)
        localStorage.setItem('bft-train-offline:old:', JSON.stringify({ day: '20261001', rows: [] }))
        await (await caches.open('bft-old-demo')).put('/old', new Response('demo'))
      }, MARKER)
      await page.reload()
      await cleanedUp(page)
      await expect
        .poll(() => page.evaluate(() => caches.keys()), { timeout: 15_000 })
        .not.toContain('bft-old-demo')
      expect(await page.evaluate(() => localStorage.getItem('bft-train-offline:old:'))).toBeNull()
      // The page cache was there when the page started, so it went too: the service worker saves its pages again.
      await expect
        .poll(() => savedPaths(page, pagesCache), { timeout: 15_000 })
        .toEqual(expect.arrayContaining(mustOpen))
      await opensOffline(context, mustOpen)
    })
  })
}
