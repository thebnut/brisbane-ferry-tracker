/**
 * Client-navigation data from the service worker's cache (R15-S1, Codex r1): the copy says so in its body
 * (markCachedData rewrites `via`), so its live data is an offline copy, however new its `renderedAt` (another tab may
 * have stored it), and a network answer afterwards brings LIVE back.
 */
import { markCachedData, VIA_CACHE, VIA_NETWORK } from '@bft/ui/connectivity'
import { visibleLiveClaims, waitForServiceWorker } from '@bft/ui/e2e/offline.ts'
import { expect, type Page, test } from '@playwright/test'
import { UNSAFE_decodeViaTurboStream as decode } from 'react-router'
import { pinUpcoming } from './upcoming.ts'

const STOP = '/bus/stop/10802'

test('the service worker rewrites a stored copy of real loader data, and nothing else in it', async ({
  request,
}) => {
  const res = await request.get(`${STOP}.data`)
  expect(res.ok()).toBe(true)
  const network = await res.text()
  expect(network).toContain(`"${VIA_NETWORK}"`)
  const copy = await markCachedData.cachedResponseWillBeUsed({
    cachedResponse: new Response(network, { headers: res.headers() }),
  })
  const read = async (body: string) =>
    (await decode(new Response(body).body as ReadableStream<Uint8Array>, globalThis)).value as Record<
      string,
      { data?: { via?: string; departures?: { generatedAt: number } } }
    >
  const before = await read(network)
  const after = await read((await copy?.text()) ?? '')
  const route = Object.keys(before).find((k) => before[k]?.data?.departures) as string
  expect(before[route]?.data?.via).toBe(VIA_NETWORK)
  expect(after[route]?.data?.via).toBe(VIA_CACHE)
  expect({ ...after[route]?.data, via: VIA_NETWORK }).toEqual(before[route]?.data)
})

/** Every frame on `path` in which a LIVE claim shows, for 2.5 s from now (before the board's late /v1 answer). */
const recordLiveClaims = (page: Page, path: string) =>
  page.evaluate((path) => {
    const w = window as unknown as { __live: string[] }
    w.__live = []
    const t0 = performance.now()
    const tick = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[data-live-claim]'))
        if (location.pathname === path && el.checkVisibility())
          w.__live.push(`${Math.round(performance.now() - t0)} ms: ${el.textContent}`)
      if (performance.now() - t0 < 2_500) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, path)

const saveStop = (page: Page) =>
  page.addInitScript(() =>
    localStorage.setItem(
      'bft-bus-saved',
      JSON.stringify([{ id: '10802', name: 'Cultural Centre station, platform 1' }]),
    ),
  )

test('a client navigation answered from the cache shows the offline timetable, then LIVE once the network answers', async ({
  page,
  context,
}) => {
  test.slow()
  await saveStop(page)
  await pinUpcoming(context)
  await page.goto('/bus')
  await waitForServiceWorker(page, 'transit-pages')
  // Visit the stop by a client navigation: the service worker stores its loader data.
  await page.locator(`a[href="${STOP}"]:visible`).first().click()
  await expect(page).toHaveURL(new RegExp(`${STOP}$`))
  await expect.poll(() => visibleLiveClaims(page), { timeout: 15_000 }).not.toEqual([])
  await page.goBack()
  await expect(page).toHaveURL(/\/bus$/)

  // The stop's `.data` request fails, so the service worker answers it from its cache; the boards' own /v1 answers
  // come 3 s late. Until they do, the board on screen is that stored copy: never LIVE, whatever its age.
  await context.route(
    (url) => url.pathname.endsWith('.data'),
    (route) => route.abort('internetdisconnected'),
  )
  await context.route(
    (url) => /\/v1\//.test(url.pathname),
    async (route) => {
      await new Promise((r) => setTimeout(r, 3_000))
      await route.fallback()
    },
  )
  await recordLiveClaims(page, STOP)
  await page.locator(`a[href="${STOP}"]:visible`).first().click()
  await expect(page).toHaveURL(new RegExp(`${STOP}$`), { timeout: 15_000 })
  await expect(page.locator('[data-banner=offline]').first()).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __live: string[] }).__live)).toEqual([])
  // The board's own network answer replaces the copy.
  await expect.poll(() => visibleLiveClaims(page), { timeout: 20_000 }).not.toEqual([])
})
