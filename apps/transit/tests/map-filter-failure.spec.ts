/**
 * R39-P2-2: a map page on a place whose departures request keeps failing (/ferry/map?terminal=, /train/map?station=,
 * /bus/map?stop=) keeps saying it can't tell which vehicles serve the place through every vehicle refresh and every
 * departures retry, with no vehicle count, no LIVE and no "Connecting…" at any point. Departures are asked again on
 * the poll (15 s, backing off while they fail), never in a tight loop, and once they answer the filtered view comes
 * back without a reload.
 */
import { WEBGL_LAUNCH } from '@bft/ui/e2e/map-fonts.ts'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

// page.route only sees requests the service worker doesn't answer: with it in control, the page's departures polls
// reached the network unrouted (smoke round 39 saw them "recover" after the first refresh).
test.use({ serviceWorkers: 'block', launchOptions: WEBGL_LAUNCH })

const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

const PAGES = [
  {
    mode: 'ferry',
    url: '/ferry/map?terminal=bulimba',
    departures: '**/__fixtures/v1/ferry/stops/317584/departures*',
    message: "Can't tell which ferries serve Bulimba right now.",
    one: '1 ferry with GPS',
    near: { lat: -27.452, lon: 153.056, routeId: 'F1-4055' },
  },
  {
    mode: 'train',
    url: '/train/map?station=central',
    departures: '**/__fixtures/v1/train/stops/central/departures*',
    message: "Can't tell which trains stop at Central right now.",
    one: '1 with live positions',
    near: { lat: -27.4655, lon: 153.0265, routeId: 'BRCL' },
  },
  {
    mode: 'bus',
    url: '/bus/map?stop=10802',
    departures: '**/__fixtures/v1/bus/stops/10802/departures*',
    message: /Can't tell which buses are heading to .+ right now\./,
    one: '1 with live positions',
    near: { lat: -27.4735, lon: 153.0205, routeId: '66-1' },
  },
] as const
type MapPage = (typeof PAGES)[number]

const ignoreClosed = (error: unknown) => {
  if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
}

/**
 * Fails the place's departures (503, after 1.5 s) until `recover()`, then passes them through, keeping the first trip it answers
 * with. Vehicle polls get one live vehicle, on that trip once there is one.
 */
async function serve(context: BrowserContext, p: MapPage) {
  const departures: number[] = []
  const vehicles: number[] = []
  let failing = true
  let trip: string | null = null
  await context.route(p.departures, async (route) => {
    try {
      departures.push(Date.now())
      // A slow failure, as a struggling API gives: the page is watched while each retry is in flight too.
      if (failing) {
        await new Promise((done) => setTimeout(done, 1_500))
        return await route.fulfill({ status: 503, json: { error: 'unavailable' } })
      }
      const res = await route.fetch()
      const body = await res.json()
      trip ??= body.departures?.[0]?.tripInstance ?? null
      await route.fulfill({ response: res, json: body })
    } catch (error) {
      ignoreClosed(error)
    }
  })
  await context.route(`**/__fixtures/v1/${p.mode}/vehicles*`, async (route) => {
    try {
      vehicles.push(Date.now())
      const res = await route.fetch()
      const body = await res.json()
      const ts = Math.floor(Date.now() / 1000)
      const { lat, lon, routeId } = p.near
      await route.fulfill({
        response: res,
        json: {
          ...body,
          rtState: 'live',
          rtSourceTimestamp: ts,
          generatedAt: Date.now(),
          vehicles: [{ id: `${p.mode}-1`, label: 'One', tripKey: trip ?? 'not-here', routeId, lat, lon, ts }],
        },
      })
    } catch (error) {
      ignoreClosed(error)
    }
  })
  return {
    departures,
    vehicles,
    recover: () => {
      failing = false
    },
  }
}

/** Notes, every 100 ms in the page, any moment the message is missing or a count, LIVE or "Connecting…" shows. */
async function watchForDrops(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __drops: string[] }
    w.__drops = []
    setInterval(() => {
      const status = document.querySelector('[data-map-page]')?.textContent ?? ''
      if (!/Can't tell which (ferries|trains|buses)/.test(status)) w.__drops.push('message missing')
      if (document.querySelector('[data-map-count]')?.textContent?.trim()) w.__drops.push('count shown')
      if (document.querySelector('header [data-connection="live"]')) w.__drops.push('LIVE')
      if (document.querySelector('header')?.textContent?.includes('Connecting…'))
        w.__drops.push('Connecting…')
    }, 100)
  })
  return () => page.evaluate(() => (window as unknown as { __drops: string[] }).__drops)
}

function suite() {
  for (const p of PAGES)
    test(`${p.mode}: failed departures stay "Can't tell" through refreshes and recover`, async ({
      page,
      context,
    }) => {
      test.setTimeout(150_000)
      const calls = await serve(context, p)
      await page.goto(p.url)
      await expect(page.getByText(p.message)).toBeVisible({ timeout: 30_000 })
      const drops = await watchForDrops(page)
      const vehiclesBefore = calls.vehicles.length
      const departuresBefore = calls.departures.length
      // Two vehicle refreshes (15 s each) and a departures retry later, it still says so, and said so throughout.
      await expect
        .poll(() => calls.vehicles.length - vehiclesBefore, { timeout: 45_000, intervals: [1_000] })
        .toBeGreaterThanOrEqual(2)
      await expect
        .poll(() => calls.departures.length - departuresBefore, { timeout: 30_000, intervals: [1_000] })
        .toBeGreaterThanOrEqual(1)
      await expect(page.getByText(p.message)).toBeVisible()
      expect(await drops()).toEqual([])
      // Never a tight loop: each poll's request (and its one retry a second later), at least 12 s from the last.
      const at = [...calls.departures]
      const polls = at.filter((t, i) => i === 0 || t - (at[i - 1] ?? 0) > 5_000)
      expect(at.length).toBeLessThanOrEqual(polls.length * 2)
      for (let i = 1; i < polls.length; i++)
        expect((polls[i] ?? 0) - (polls[i - 1] ?? 0)).toBeGreaterThanOrEqual(12_000)
      // Departures answer again: the place's one vehicle (on the next vehicle poll), counted and LIVE, with no reload.
      calls.recover()
      await expect(page.getByText(p.message)).toHaveCount(0, { timeout: 60_000 })
      await expect(page.locator('[data-map-count]')).toHaveText(p.one, { timeout: 30_000 })
      await expect(page.locator('header [data-connection="live"]').first()).toHaveText('LIVE', {
        timeout: 30_000,
      })
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
