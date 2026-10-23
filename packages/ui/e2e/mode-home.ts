/**
 * THE-118 PR 8: the mode homes (/ferry, /train, /bus in BrisbaneTransit, and each standalone site's /) share one
 * skeleton: the title and the mode's search, Saved (My Transit cards; the ferry home's first saved trip is the big
 * headline), Near you (only once location is granted, never asked for on load), Popular chips and the SEO copy closed
 * under About. Run at 390×844 touch, 1280×900 and 1440×900.
 *
 * Saved items are seeded in each app's own store (and cookie, for the server render). Rows are pinned (the apps'
 * tests/upcoming.ts) so a departure is due and live at any hour; tests that need pinned times seed the store without
 * the cookie, so the cards' own (pinned) requests fill them rather than the unpinned server render.
 */
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { allowLocation } from './locate-me.ts'
import { visibleLiveClaims } from './offline.ts'
import { seedConnectingSuite } from './seed-connecting.ts'

/** South Brisbane, by the Cultural Centre: ferry terminals, train stations and bus stops all near. */
const HERE = { latitude: -27.4732, longitude: 153.0195 }

export interface SavedSeed {
  /** localStorage key → JSON value of the saved list (the app's own store). */
  key: string
  list: unknown[]
  /** The SSR cookie for the first few, as the app writes it. */
  cookie: { name: string; value: (list: unknown[]) => string }
  /** Each item's board, relative to the home's base. */
  hrefs: string[]
}

export interface HomeSpec {
  mode: 'ferry' | 'train' | 'bus'
  /** The home's path ('/ferry' or '/'); board links are under `base`. */
  path: string
  base: string
  title: string
  /** The search field's name. */
  search: string | RegExp
  popular: { title: string; first: { name: string; href: string } }
  near: string
  saved: SavedSeed
  /** Pins the departures (tests/upcoming.ts). */
  pin: (context: BrowserContext) => Promise<unknown>
  /** Train: "All N stations" opens the full list there. */
  allStations?: { href: string; heading: string }
}

const section = (page: Page, id: string) => page.locator(`[data-home-section=${id}]`)

interface Row {
  status: string
  schedDep: number
  estDep: number | null
  schedArrTo: number | null
  estArrTo: number | null
}

/** The fixture API's departures requests for a mode (the apps' tests/upcoming.ts). */
const departuresGlob = (mode: HomeSpec['mode']) => `**/__fixtures/v1/${mode}/stops/*/departures*`

/**
 * R36-L1: a fresh live answer (rtState 'live', as the fixture API's) whose rows are all timetabled, the next one 10
 * minutes from now: the 6:17am Bulimba → Riverside ferry before any service runs. Registered after `pin`, so it wins
 * for the requests `only` matches (every one by default); the rest fall back to `pin`.
 */
async function timetabled(
  context: BrowserContext,
  mode: HomeSpec['mode'],
  only: (url: string) => boolean = () => true,
) {
  await context.route(departuresGlob(mode), async (route) => {
    if (!only(route.request().url())) return route.fallback()
    try {
      const u = new URL(route.request().url())
      u.searchParams.delete('rt')
      const res = await route.fetch({ url: u.toString() })
      const body: { rtState: string; departures?: Row[] } = await res.json()
      const shift =
        Math.floor(Date.now() / 1000) + 600 - Math.min(...(body.departures ?? []).map((d) => d.schedDep))
      body.rtState = 'live'
      for (const d of body.departures ?? []) {
        d.status = 'scheduled'
        d.schedDep += shift
        d.estDep = null
        if (d.schedArrTo != null) d.schedArrTo += shift
        d.estArrTo = null
      }
      await route.fulfill({ response: res, json: body })
    } catch (error) {
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })
}

/** The header claims nothing: no LIVE, no OFFLINE, no "Connecting…" (#159, R36-L1). */
async function expectNoClaim(page: Page) {
  const header = page.locator('header')
  await expect(header.locator('[data-connection=connecting]')).toHaveCount(0)
  await expect(header.locator('[data-live-claim]')).toHaveCount(0)
  await expect(header.getByText('OFFLINE', { exact: true })).toHaveCount(0)
  expect(await visibleLiveClaims(page)).toEqual([])
}

/** A saved item's departures request (its stop in the URL). */
const savedId = (item: unknown) => {
  const x = item as { from?: string; id?: string }
  return encodeURIComponent(x.from ?? x.id ?? '')
}

async function seed(page: Page, spec: HomeSpec, n: number, cookie: boolean) {
  const list = spec.saved.list.slice(0, n)
  await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key as string, value as string)
      } catch {}
    },
    [spec.saved.key, JSON.stringify(list)],
  )
  if (cookie)
    await page.context().addCookies([
      {
        name: spec.saved.cookie.name,
        value: spec.saved.cookie.value(list),
        url: test.info().project.use.baseURL as string,
      },
    ])
}

/** Counts navigator.geolocation calls (window.__geoCalls), so a test can check location isn't asked for on load. */
const countGeolocation = (page: Page) =>
  page.addInitScript(() => {
    const w = window as Window & { __geoCalls?: number }
    w.__geoCalls = 0
    const geo = navigator.geolocation
    if (!geo) return
    const get = geo.getCurrentPosition.bind(geo)
    geo.getCurrentPosition = (...args: Parameters<Geolocation['getCurrentPosition']>) => {
      w.__geoCalls = (w.__geoCalls ?? 0) + 1
      return get(...args)
    }
  })
const geoCalls = (page: Page) => page.evaluate(() => (window as Window & { __geoCalls?: number }).__geoCalls)

function suite(spec: HomeSpec) {
  const href = (i: number) => `${spec.base}${spec.saved.hrefs[i]}`

  test('nothing saved: the skeleton in order, one line under Saved, no LIVE pill', async ({ page }) => {
    await countGeolocation(page)
    await page.goto(spec.path)
    await expect(page.getByRole('heading', { level: 1, name: spec.title, exact: true })).toBeVisible()
    const search = page
      .getByRole('combobox', { name: spec.search })
      .or(page.getByRole('textbox', { name: spec.search }))
      .or(page.getByRole('searchbox', { name: spec.search }))
    await expect(search.filter({ visible: true }).first()).toBeVisible()
    await expect(page.locator('[data-home-section]')).toHaveCount(3)
    expect(
      await page
        .locator('[data-home-section]')
        .evaluateAll((s) => s.map((x) => x.id || x.dataset.homeSection)),
    ).toEqual(['saved', 'near', 'popular'])
    await expect(section(page, 'saved')).toContainText('Tap ☆ on any board to save it.')
    await expect(section(page, 'saved').locator('a')).toHaveCount(0)
    // The About copy is closed, after the sections.
    const about = page.locator('details[data-about]')
    await expect(about).toBeVisible()
    expect(await about.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false)
    // No live rows: the header claims nothing, and location was never asked for.
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)
    expect(await visibleLiveClaims(page)).toEqual([])
    await expect(page.locator('header [data-live-claim]')).toHaveCount(0)
    expect(await geoCalls(page)).toBe(0)
  })

  test('Near you, location not allowed: one row, and a tap says location is off', async ({ page }) => {
    await countGeolocation(page)
    await page.goto(spec.path)
    const near = section(page, 'near')
    const button = near.getByRole('button', { name: 'Use my location' })
    await expect(button).toBeVisible()
    await expect(near.locator('[data-near]')).toHaveCount(0)
    expect(await geoCalls(page)).toBe(0)
    await button.click()
    await expect(near).toContainText('Location is off')
    await expect(near.locator('[data-near]')).toHaveCount(0)
  })

  test('Near you, location allowed: the three nearest places with their next departure', async ({
    page,
    context,
  }) => {
    await spec.pin(context)
    await allowLocation(context, HERE)
    await page.goto(spec.path)
    const near = section(page, 'near')
    await expect(near.locator('[data-near]')).toHaveCount(3, { timeout: 15_000 })
    await expect(near.getByRole('button', { name: 'Use my location' })).toHaveCount(0)
    const first = near.locator('[data-near] a').first()
    await expect(first).toHaveAttribute('href', new RegExp(`^${spec.base}/`))
    await expect(first).toContainText('min walk')
    // A pinned departure in 10 minutes: its countdown and walking cue.
    await expect(
      near
        .locator('[data-near]')
        .getByText(/\d+ min(s)?\b|Now/)
        .first(),
    ).toBeVisible({
      timeout: 15_000,
    })
  })

  test('Popular: places as chips that open their boards', async ({ page }) => {
    await page.goto(spec.path)
    const popular = section(page, 'popular')
    await expect(popular.getByRole('heading', { name: spec.popular.title })).toBeVisible()
    const chip = popular.getByRole('link', { name: spec.popular.first.name, exact: true })
    await expect(chip).toHaveAttribute('href', `${spec.base}${spec.popular.first.href}`)
    const box = await chip.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })

  test('one saved: its card opens its board', async ({ page, context }) => {
    await spec.pin(context)
    await seed(page, spec, 1, false)
    await page.goto(spec.path)
    const saved = section(page, 'saved')
    await expect(saved.locator('a')).toHaveCount(1)
    await expect(saved.locator('a')).toHaveAttribute('href', href(0))
    await expect(saved).not.toContainText('Tap ☆')
    // Its next departure (pinned 10 minutes away), and LIVE in the header once every live row is live.
    await expect(saved.locator('[data-saved-time]')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('header [data-live-claim]').first()).toBeVisible({ timeout: 15_000 })
  })

  test('R36-L1: one saved, every row timetabled: the header claims nothing, never LIVE', async ({
    page,
    context,
  }) => {
    await spec.pin(context)
    await timetabled(context, spec.mode)
    await seed(page, spec, 1, false)
    await page.goto(spec.path)
    const saved = section(page, 'saved')
    await expect(saved.locator('[data-saved-time]')).toBeVisible({ timeout: 15_000 })
    // Its next departure is on the card, timetabled; nothing on the page is LIVE, and nothing has failed.
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1_000)
    await expectNoClaim(page)
  })

  test('R36-L1: two saved, one with a live row: LIVE', async ({ page, context }) => {
    await spec.pin(context)
    const second = `/stops/${savedId(spec.saved.list[1])}/departures`
    await timetabled(context, spec.mode, (url) => !url.includes(second))
    await seed(page, spec, 2, false)
    await page.goto(spec.path)
    await expect(section(page, 'saved').locator('a')).toHaveCount(2)
    await expect(page.locator('header [data-live-claim]').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('header').getByText('OFFLINE', { exact: true })).toHaveCount(0)
  })

  if (spec.mode !== 'train')
    test('the last saved item taken out (another tab): the header claims nothing again (Codex r1)', async ({
      page,
      context,
    }) => {
      await spec.pin(context)
      await seed(page, spec, 1, true)
      await page.goto(spec.path)
      // LIVE over a live row only (R36-L1): the server render isn't pinned, so at some hours LIVE waits for the card's
      // own (pinned) answer at its first poll (15 s).
      await expect(page.locator('header [data-live-claim]').first()).toBeVisible({ timeout: 30_000 })
      // Another tab unsaves it: this page hears the storage event.
      await page.evaluate((key) => {
        localStorage.setItem(key, '[]')
        dispatchEvent(new StorageEvent('storage', { key }))
      }, spec.saved.key)
      await expect(section(page, 'saved')).toContainText('Tap ☆ on any board to save it.')
      await expect(page.locator('header [data-live-claim]')).toHaveCount(0)
      await expect(page.locator('header [data-connection]')).toHaveCount(0)
    })

  test('several saved: one card each, in the saved order', async ({ page, context }) => {
    await spec.pin(context)
    await seed(page, spec, 3, false)
    await page.goto(spec.path)
    const links = section(page, 'saved').locator('a')
    await expect(links).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(links.nth(i)).toHaveAttribute('href', href(i))
  })

  test('saved, in the server HTML: the first cards from the cookie', async ({ page, context }) => {
    await seed(page, spec, 3, true)
    const html = await (await context.request.get(spec.path)).text()
    for (let i = 0; i < (spec.mode === 'ferry' ? 1 : 3); i++) expect(html).toContain(`href="${href(i)}"`)
    if (spec.mode === 'ferry') expect(html).toContain('data-headline=""')
  })

  if (spec.mode === 'ferry')
    test('the first saved trip is the headline: next departure with a big countdown', async ({
      page,
      context,
    }) => {
      await spec.pin(context)
      await seed(page, spec, 2, false)
      await page.goto(spec.path)
      const headline = page.locator('[data-headline]')
      await expect(headline).toHaveCount(1)
      await expect(headline.locator('a')).toHaveAttribute('href', href(0))
      await expect(headline).toContainText('Next departure', { timeout: 15_000 })
      await expect(headline.locator('[data-countdown]')).toHaveText(/^\d+ min|Now/)
      // The rest are My Transit cards after it.
      await expect(section(page, 'saved').locator('a')).toHaveCount(2)
    })

  if (spec.allStations) {
    const all = spec.allStations
    test('"All stations" opens the full list', async ({ page }) => {
      await page.goto(spec.path)
      const link = section(page, 'popular').getByRole('link', { name: /^All \d+ stations$/ })
      await expect(link).toHaveAttribute('href', `${spec.base}${all.href}`)
      await link.click()
      await expect(page).toHaveURL(new RegExp(`${spec.base}${all.href}$`))
      await expect(page.getByRole('heading', { name: all.heading })).toBeVisible()
    })
  }
}

const SIZES = [
  ['390×844 touch', 'phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ['1280×900', 'desktop', { viewport: { width: 1280, height: 900 } }],
  ['1440×900', 'desktop', { viewport: { width: 1440, height: 900 } }],
] as const

/** The suite for each home, at each size (each size in one project only, so it runs once). */
export function modeHomeSuite(homes: HomeSpec[]) {
  for (const [size, project, use] of SIZES)
    test.describe(size, () => {
      test.beforeEach(() =>
        test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
      )
      test.use(use)
      for (const home of homes) test.describe(`${home.mode} home`, () => suite(home))
    })
}

/**
 * R32-RT1 for ferry home's headline: its stale seed says "Connecting…" until its own answer (seed-connecting.ts). Then
 * R36-L1: an answer of its own that is live but all timetabled claims nothing (no LIVE, no OFFLINE).
 */
export function headlineConnecting(spec: HomeSpec, departures: string) {
  for (const [size, project, use] of SIZES)
    test.describe(size, () => {
      test.beforeEach(() =>
        test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
      )
      test.use(use)
      test.describe('ferry home headline', () =>
        seedConnectingSuite({
          path: spec.path,
          departures,
          pin: spec.pin,
          cookie: {
            name: spec.saved.cookie.name,
            value: spec.saved.cookie.value(spec.saved.list.slice(0, 1)),
          },
          prepare: (page) => seed(page, spec, 1, false),
        }))
      test.describe('ferry home headline, R36-L1', () => {
        test.use({ serviceWorkers: 'block' })
        test('a stale seed: Connecting… until a timetabled answer of its own, then no claim', async ({
          page,
          context,
        }) => {
          await context.addCookies([
            {
              name: spec.saved.cookie.name,
              value: spec.saved.cookie.value(spec.saved.list.slice(0, 1)),
              url: test.info().project.use.baseURL as string,
            },
          ])
          await seed(page, spec, 1, false)
          let release = () => {}
          const released = new Promise<void>((r) => (release = r))
          let asked = 0
          await timetabled(context, spec.mode)
          // Registered last, so it holds the request before `timetabled` answers it.
          await context.route(departures, async (route) => {
            asked++
            await released
            return route.fallback().catch(() => {})
          })
          await page.goto(`${spec.path}${spec.path.includes('?') ? '&' : '?'}rt=stale`)
          await expect.poll(() => asked).toBeGreaterThan(0)
          await expect(page.locator('header [data-connection=connecting]').first()).toBeVisible()
          await expect(page.locator('header [data-live-claim]')).toHaveCount(0)
          release()
          await expect(page.locator('[data-headline] [data-countdown]')).toBeVisible({ timeout: 10_000 })
          await expectNoClaim(page)
        })
      })
    })
}

/** Each mode's saved store as the apps write it (ferry favourites.ts, train and bus storage.ts). */
export const SAVED: Record<HomeSpec['mode'], SavedSeed> = {
  ferry: {
    key: 'bft-ferry-favourites',
    list: [
      { from: '317584', to: '317590' },
      { from: '317590', to: null },
      { from: '317588', to: null },
    ],
    cookie: {
      name: 'bft_pair',
      value: (l) => {
        const f = l[0] as { from: string; to: string | null }
        return `fav.${f.from}.${f.to ?? ''}`
      },
    },
    hrefs: ['/terminal/bulimba?to=riverside', '/terminal/riverside', '/terminal/new-farm-park'],
  },
  train: {
    key: 'bft-train-favourites',
    list: [
      { from: 'central', to: 'bowen-hills' },
      { from: 'roma-street', to: null },
      { from: 'fortitude-valley', to: null },
    ],
    cookie: {
      name: 'bft_fav',
      value: (l) =>
        encodeURIComponent(
          (l as Array<{ from: string; to: string | null }>).map((f) => `${f.from}.${f.to ?? ''}`).join(','),
        ),
    },
    hrefs: ['/station/central?to=bowen-hills', '/station/roma-street', '/station/fortitude-valley'],
  },
  bus: {
    key: 'bft-bus-saved',
    list: [
      { id: '10802', name: 'Cultural Centre station, platform 1' },
      { id: '10780', name: 'King George Square, 2a' },
      { id: '19051', name: 'Mater Hill station, platform 1' },
    ],
    cookie: { name: 'bft_bus_saved', value: (l) => (l as Array<{ id: string }>).map((s) => s.id).join('.') },
    hrefs: ['/stop/10802', '/stop/10780', '/stop/19051'],
  },
}
