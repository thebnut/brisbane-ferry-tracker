/**
 * R27-RT1: a cold API isolate answers the page's own render with scheduled rows (`unavailable`) once its realtime wait
 * runs out, and the header said OFFLINE until the board's first poll 15 s later, while the board's next request (to a
 * now warm isolate) would have been live. The board asks again as soon as it mounts.
 */
import { expect, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

// page.route only sees requests the service worker doesn't answer.
test.use({ serviceWorkers: 'block' })

test('a board the page rendered without live times asks again at once', async ({
  page,
  context,
  request,
}) => {
  // The server render is the cold answer: ?rt=unavailable for the loader.
  const html = await (await request.get('/stop/10802?rt=unavailable')).text()
  // Rendered from the cold answer: "Connecting…" until the board's own answer, with no banner (R32-RT1).
  expect(html).toContain('data-connection="connecting"')
  expect(html).not.toContain('data-banner="unavailable"')

  await pinUpcoming(context)
  // The board's own requests reach a warm isolate: live (registered last, so it runs before pinUpcoming).
  const asked: number[] = []
  const t0 = Date.now()
  await context.route('**/__fixtures/v1/bus/stops/10802/departures*', (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('limit') === '20') asked.push(Date.now() - t0)
    url.searchParams.delete('rt')
    return route.fallback({ url: url.toString() })
  })
  await page.goto('/stop/10802?rt=unavailable')
  const header = page.locator('header')
  // Well before the first 15 s poll.
  await expect(header.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 5_000 })
  await expect(header.getByText('OFFLINE', { exact: true })).toHaveCount(0)
  await expect(page.locator('[data-banner=unavailable]')).toHaveCount(0)
  expect(asked.length).toBeGreaterThan(0)
})
