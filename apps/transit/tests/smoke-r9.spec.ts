/**
 * Regression test for Dev's smoke test round 9 (19 Oct 2026).
 * T1: the home's "Last updated" is the time of the newest network answer among its saved cards, not the clock: held
 * offline for over a minute it stays at the last answer's time (with the offline banner and OFFLINE, never LIVE), and
 * it moves on once the network answers again.
 */
import { goOffline, visibleLiveClaims, waitForServiceWorker } from '@bft/ui/e2e/offline.ts'
import { expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const saveAcrossModes = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem('brisbane-ferry-remember-selection', 'true')
    localStorage.setItem(
      'brisbane-ferry-selected-stops',
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
    localStorage.setItem('bft-train-favourites', JSON.stringify([{ from: 'central', to: null }]))
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    )
  })

/** As @bft/ui formatClock: "7:38 pm" in Brisbane time. */
const clock = (ms: number) =>
  new Intl.DateTimeFormat('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Australia/Brisbane',
  })
    .format(ms)
    .replace(/\s/g, ' ')

const DEPARTURES = /\/v1\/(ferry|train|bus)\/stops\/[^/]+\/departures/

test.describe('R9-T1: the home’s "Last updated" is the last network answer', () => {
  test('set by a live answer, frozen offline for over a minute (OFFLINE, never LIVE), moves on once back', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000)
    await pinUpcoming(context)
    await saveAcrossModes(page)
    // The newest departures answer that reached the network (not one the service worker served from its cache).
    let newest = 0
    page.on('response', async (res) => {
      if (!DEPARTURES.test(res.url()) || res.status() !== 200 || res.headers()['x-bft-cache']) return
      try {
        const body: { generatedAt?: number } = await res.json()
        if (body.generatedAt && body.generatedAt > newest) newest = body.generatedAt
      } catch {
        // A response still in flight when the page goes offline.
      }
    })
    const updated = page.getByText(/^Last updated \d/)

    await page.goto('/')
    await waitForServiceWorker(page, 'transit-pages')
    await expect(page.getByText('3 saved · all modes')).toBeVisible()
    await expect(page.getByText('LIVE', { exact: true }).first()).toBeVisible()
    await expect.poll(() => newest).toBeGreaterThan(0)
    await expect(updated).toHaveText(`Last updated ${clock(newest)}`)
    const before = await updated.textContent()
    const lastAnswer = newest

    const goOnline = await goOffline(context)
    await page.evaluate(() => window.dispatchEvent(new Event('offline')))
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible()
    await expect(page.getByText('OFFLINE', { exact: true })).toBeVisible()
    // Over a minute offline (the wall clock moves on a minute or more): the time stays, never LIVE.
    const until = Date.now() + 65_000
    while (Date.now() < until) {
      expect(await visibleLiveClaims(page)).toEqual([])
      await expect(updated).toHaveText(before as string)
      await page.waitForTimeout(5_000)
    }
    expect(newest).toBe(lastAnswer)
    await expect(page.locator('[data-banner=offline]').first()).toBeVisible()

    await goOnline()
    await expect(page.locator('[data-banner=offline]')).toHaveCount(0, { timeout: 30_000 })
    await expect.poll(() => newest).toBeGreaterThan(lastAnswer + 60_000)
    await expect(updated).not.toHaveText(before as string)
    await expect(updated).toHaveText(`Last updated ${clock(newest)}`)
  })
})
