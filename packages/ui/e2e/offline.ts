/**
 * Playwright helpers for the apps' offline tests (R3-F1, R3-X9). Chromium's offline emulation alone doesn't reach
 * the service worker's own fetches reliably, so "offline" here is both: the context is offline and every request
 * (the service worker's included, `context.route` sees them) fails as disconnected.
 */
import type { BrowserContext, Page } from '@playwright/test'

/** Wait until the service worker controls the page and has saved it in its page cache. */
export async function waitForServiceWorker(page: Page, pagesCache: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  for (;;) {
    const ready = await page.evaluate(async (name) => {
      if (!navigator.serviceWorker?.controller) return false
      if (!(await caches.keys()).includes(name)) return false
      return (await (await caches.open(name)).keys()).some((r) => r.url === location.href)
    }, pagesCache)
    if (ready) return
    if (Date.now() > deadline)
      throw new Error(`service worker not ready with ${pagesCache} after ${timeout} ms`)
    await page.waitForTimeout(250)
  }
}

/** Take the whole context offline. Returns a function that brings it back online. */
export async function goOffline(context: BrowserContext): Promise<() => Promise<void>> {
  let offline = true
  const handler = (route: import('@playwright/test').Route) =>
    offline ? route.abort('internetdisconnected') : route.fallback()
  await context.route('**/*', handler)
  await context.setOffline(true)
  return async () => {
    offline = false
    await context.setOffline(false)
    await context.unroute('**/*', handler)
  }
}

/** LIVE and GPS claims a person can see (badges, pills, a bare "LIVE" label). */
export const visibleLiveClaims = (page: Page) =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        '[data-live-claim], [data-badge=live], [data-badge=gps], span',
      ),
    ]
      .filter(
        (el) =>
          el.matches('[data-live-claim], [data-badge=live], [data-badge=gps]') ||
          (el.childElementCount === 0 && el.textContent?.trim() === 'LIVE'),
      )
      .filter((el) => el.checkVisibility())
      .map((el) => el.outerHTML.slice(0, 100)),
  )

/** The body's font comes from the app stylesheet (the browser default is a serif): the page is styled. */
export const bodyFont = (page: Page) => page.evaluate(() => getComputedStyle(document.body).fontFamily)
