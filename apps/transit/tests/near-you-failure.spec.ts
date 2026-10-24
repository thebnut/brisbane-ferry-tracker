/**
 * Codex release review r2 (P2): the Ferry, Train and Bus homes' Near you rows (location allowed) whose departures
 * requests keep failing say "Departures unavailable" with a Try again beside each board link, through every poll and
 * retry in flight: never "No more departures today", never "Getting departures…" and never LIVE. Try again asks at
 * once; departures are otherwise asked again on the poll (backing off while they fail), never in a tight loop; and
 * once they answer each row shows its next departure without a reload.
 */
import { allowLocation } from '@bft/ui/e2e/locate-me.ts'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

// page.route only sees requests the service worker doesn't answer (smoke round 39).
test.use({ serviceWorkers: 'block' })

const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

/** South Brisbane, by the Cultural Centre: ferry terminals, train stations and bus stops all near. */
const HERE = { latitude: -27.4732, longitude: 153.0195 }
const MODES = ['ferry', 'train', 'bus'] as const
type Mode = (typeof MODES)[number]
const STAND_IN: Record<Mode, string> = { ferry: '317584', train: 'central', bus: '10802' }

/**
 * Fails every Near you departures request (503, after 1.5 s) until `recover()`, then passes them to pinUpcoming (a
 * departure due in 10 minutes). Notes each request's time by its stop.
 */
async function serve(context: BrowserContext, mode: Mode) {
  const glob = `**/__fixtures/v1/${mode}/stops/*/departures*`
  await pinUpcoming(context, glob)
  const asked = new Map<string, number[]>()
  let failing = true
  // Registered last, so it sees each request first.
  await context.route(glob, async (route) => {
    try {
      const stop = new URL(route.request().url()).pathname.split('/').at(-2) ?? ''
      asked.set(stop, [...(asked.get(stop) ?? []), Date.now()])
      if (!failing) {
        // A stop with no recorded timetable (404) answers with one that has (Cultural Centre, platform 1).
        const url = route.request().url()
        const own = await route.fetch()
        return await route.fallback(
          own.status() === 404 ? { url: url.replace(/\/stops\/[^/]+\//, `/stops/${STAND_IN[mode]}/`) } : {},
        )
      }
      await new Promise((done) => setTimeout(done, 1_500))
      await route.fulfill({ status: 503, json: { error: 'unavailable' } })
    } catch (error) {
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })
  /** Each stop's polls since `from`: requests more than 5 s after the one before (a poll and its one retry). */
  const polls = (from: number) =>
    [...asked.values()].map((at) =>
      at.filter((t, i) => t >= from && (i === 0 || t - (at[i - 1] ?? 0) > 5_000)),
    )
  return {
    asked,
    polls,
    recover: () => {
      failing = false
    },
  }
}

/** Notes, every 100 ms in the page, any moment a Near you row isn't "Departures unavailable", or LIVE shows. */
async function watchForDrops(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __drops: string[] }
    w.__drops = []
    setInterval(() => {
      const rows = [...document.querySelectorAll('[data-home-section=near] [data-near]')]
      if (rows.length !== 3) w.__drops.push(`${rows.length} rows`)
      for (const r of rows) {
        const text = r.textContent ?? ''
        if (!text.includes('Departures unavailable')) w.__drops.push(`message missing: ${text}`)
        if (/No more departures today|Getting departures/.test(text)) w.__drops.push(text)
      }
      if (document.querySelector('header [data-connection="live"]')) w.__drops.push('LIVE')
    }, 100)
  })
  return () => page.evaluate(() => (window as unknown as { __drops: string[] }).__drops)
}

function suite() {
  for (const mode of MODES)
    test(`${mode}: Near you departures failing stay "Departures unavailable" and recover`, async ({
      page,
      context,
    }) => {
      test.setTimeout(240_000)
      const calls = await serve(context, mode)
      await allowLocation(context, HERE)
      await page.goto(`/${mode}`)
      const near = page.locator('[data-home-section=near]')
      const rows = near.locator('[data-near]')
      await expect(rows).toHaveCount(3, { timeout: 15_000 })
      await expect(rows.filter({ hasText: 'Departures unavailable' })).toHaveCount(3, { timeout: 30_000 })
      await expect(near).not.toContainText('No more departures today')
      // Each row: still a link to its board, with its own Try again beside it (not inside), 44 px or more.
      await expect(rows.locator('a')).toHaveCount(3)
      const retry = near.getByRole('button', { name: /^Try again: / })
      await expect(retry).toHaveCount(3)
      await expect(rows.locator('a button')).toHaveCount(0)
      const box = await retry.first().boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44)
      const drops = await watchForDrops(page)
      const watched = Date.now()
      // Two more polls for every row (backing off while they fail), and it said so throughout.
      await expect
        .poll(() => Math.min(...calls.polls(watched).map((p) => p.length)), {
          timeout: 120_000,
          intervals: [1_000],
        })
        .toBeGreaterThanOrEqual(2)
      // Let the last poll's requests (and their retries) settle, still watched.
      await page.waitForTimeout(4_000)
      expect(await drops()).toEqual([])
      // Never a tight loop: polls at least 12 s apart, each its request and at most one retry.
      for (const [, at] of calls.asked) {
        const polls = at.filter((t, i) => i === 0 || t - (at[i - 1] ?? 0) > 5_000)
        expect(at.length).toBeLessThanOrEqual(polls.length * 2)
        for (let i = 1; i < polls.length; i++)
          expect((polls[i] ?? 0) - (polls[i - 1] ?? 0)).toBeGreaterThanOrEqual(12_000)
      }
      // Try again asks for that row at once, and the message stays while it does.
      const before = [...calls.asked.values()].flat().length
      const clicked = Date.now()
      await retry.first().click()
      await expect
        .poll(() => [...calls.asked.values()].flat().filter((t) => t >= clicked).length, { timeout: 2_000 })
        .toBeGreaterThanOrEqual(1)
      await page.waitForTimeout(2_000)
      expect(await drops()).toEqual([])
      expect([...calls.asked.values()].flat().length - before).toBeLessThanOrEqual(2)
      // Departures answer again: each row's next departure on its next poll, with no reload.
      calls.recover()
      await expect(near.getByText('Departures unavailable')).toHaveCount(0, { timeout: 100_000 })
      await expect(retry).toHaveCount(0)
      // Each row its pinned departure: none says why it has none.
      await expect(
        rows.filter({ hasText: /Departures unavailable|No more departures today|Getting departures/ }),
      ).toHaveCount(0)
      await expect(rows.locator('a')).toHaveCount(3)
    })
}

test.describe('390×844 touch', () => {
  onlyIn('phone')
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  suite()
})

test.describe('1280×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1280, height: 900 } })
  suite()
})

test.describe('1440×900', () => {
  onlyIn('desktop')
  test.use({ viewport: { width: 1440, height: 900 } })
  suite()
})
