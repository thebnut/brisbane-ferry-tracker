/**
 * P-42a1bd5-N1 (Dev's release-22 prod check): /nearby showed a red OFFLINE header pill before any live answer: for
 * good without a location, and for about a second before LIVE with one. Now (nearbyLiveState): no stops listed, no
 * claim; before any answer, "Connecting…", and OFFLINE only once every stop has failed; then LIVE as before.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const DEPARTURES = '**/__fixtures/v1/*/stops/*/departures*'

/** Records, in the page, every header connection state that shows (a flash shorter than a poll included). */
async function watchHeader(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __seen: string[] }).__seen = seen
    new MutationObserver(() => {
      const s = document.querySelector('header [data-connection]')?.getAttribute('data-connection')
      if (s && seen.at(-1) !== s) seen.push(s)
    }).observe(document, { subtree: true, childList: true, attributes: true })
  })
  return () => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)
}

/** A stop the fixtures hold for each mode, live at any hour once pinned. */
const KNOWN: Record<string, string> = { bus: '10802', ferry: '317584', train: 'central' }

/**
 * Holds every departures request until the returned release(). With `allKnown`, a stop the fixtures don't hold (a 404)
 * is answered as a known stop of its mode, so every listed stop has a live answer.
 */
async function holdDepartures(context: BrowserContext, allKnown: boolean) {
  let open!: () => void
  const gate = new Promise<void>((r) => {
    open = r
  })
  await context.route(DEPARTURES, async (route) => {
    await gate
    if (allKnown && (await route.fetch()).status() === 404) {
      const url = route
        .request()
        .url()
        .replace(/\/(\w+)\/stops\/[^/]+\//, (_m, mode: string) => `/${mode}/stops/${KNOWN[mode]}/`)
      return route.fallback({ url })
    }
    return route.fallback()
  })
  return open
}

test('no location: the header claims nothing, and never says OFFLINE', async ({ page }) => {
  const seen = await watchHeader(page)
  await page.goto('/nearby')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.waitForTimeout(3_000)
  await expect(page.locator('header [data-connection]')).toHaveCount(0)
  expect(await seen()).toEqual([])
})

test.describe('location granted', () => {
  test.use({ geolocation: { latitude: -27.4717, longitude: 153.0206 }, permissions: ['geolocation'] })

  test('Connecting… while the stops’ first answers are on their way, then LIVE; never OFFLINE', async ({
    page,
    context,
  }) => {
    // One live departure due at every stop, at any hour (as the mode-home tests).
    await pinUpcoming(context)
    const release = await holdDepartures(context, true)
    const seen = await watchHeader(page)
    await page.goto('/nearby')
    await expect(page.locator('header [data-connection]').first()).toHaveText('Connecting…', {
      timeout: 10_000,
    })
    await page.waitForTimeout(1_000)
    await expect(page.locator('header [data-connection]').first()).toHaveText('Connecting…')
    release()
    await expect(page.locator('header [data-connection="live"]').first()).toHaveText('LIVE', {
      timeout: 15_000,
    })
    expect(await seen()).toEqual(['connecting', 'live'])
  })

  test('every stop failing: Connecting… until the failures are in, then OFFLINE; never OFFLINE before', async ({
    page,
    context,
  }) => {
    let fail!: () => void
    const gate = new Promise<void>((r) => {
      fail = r
    })
    await context.route(DEPARTURES, async (route) => {
      await gate
      return route.abort('failed')
    })
    const seen = await watchHeader(page)
    await page.goto('/nearby')
    await expect(page.locator('header [data-connection]').first()).toHaveText('Connecting…', {
      timeout: 10_000,
    })
    await page.waitForTimeout(1_000)
    expect(await seen()).toEqual(['connecting'])
    fail()
    await expect(page.locator('header [data-connection="offline"]').first()).toHaveText('OFFLINE', {
      timeout: 15_000,
    })
    expect(await seen()).toEqual(['connecting', 'offline'])
  })
})
