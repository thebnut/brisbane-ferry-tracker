/**
 * THE-118 PR 9, one map page per mode: /ferry/map (new, the board's map sheet retired), /train/map and /bus/map share
 * a full-bleed shell with the mode's pin shape (circle ferry, square train, diamond bus).
 *  - each page draws its pins in its shape, at street zoom and at city zoom; bus stops only from zoom 14, so at city
 *    zoom none are drawn (bounded) and the page says to zoom in;
 *  - a board's Map chip opens the page on that place (`?terminal=`, `?station=`, `?stop=`), selected and in view;
 *  - a trip's "Track on map" follows that trip's vehicle (selected, in view, its card says "your trip");
 *  - the old ferry map entry points (`?map=1`, `&trip=`) land on /ferry/map, and ferry home links to it;
 *  - without WebGL each page shows "Map unavailable on this device" and fetches no MapLibre;
 *  - positions are live claims: "Connecting…" until the page's own answer, LIVE only after a live one, and an answer
 *    that isn't live shows no positions and no LIVE;
 *  - no board or mode home loads a map chunk on its first load.
 * Nothing here depends on the time of day: vehicle positions are crafted per test (stamped with the real clock), rows
 * are picked by position, stops come from the static geo tiles, and no countdown or clock wording is asserted.
 */
import type { Vehicle } from '@bft/core/contract'
import { WEBGL_LAUNCH } from '@bft/ui/e2e/map-fonts.ts'
import { disableWebGL, expectMapUnavailable, watchMapFailures } from '@bft/ui/e2e/no-webgl.ts'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'

test.use({ serviceWorkers: 'block', launchOptions: WEBGL_LAUNCH })

/** Runs a describe block's tests in one project only (each size runs once). */
const onlyIn = (project: string) =>
  test.beforeEach(() =>
    test.skip(test.info().project.name !== project, `the ${project} project runs this size`),
  )

type Mode = 'ferry' | 'train' | 'bus'
const SHAPE: Record<Mode, string> = { ferry: 'circle', train: 'square', bus: 'diamond' }

/** Near each mode's focus place (Bulimba, Central, Cultural Centre). */
const NEAR: Record<Mode, { lat: number; lon: number }> = {
  ferry: { lat: -27.452, lon: 153.056 },
  train: { lat: -27.4655, lon: 153.0265 },
  bus: { lat: -27.4735, lon: 153.0205 },
}

/**
 * Answers the mode's vehicle polls with these positions (live and fresh unless `rtState` says otherwise), after
 * `hold` when given.
 */
async function serveVehicles(
  context: BrowserContext,
  mode: Mode,
  vehicles: Array<Omit<Vehicle, 'ts'>>,
  opts: { rtState?: string; hold?: Promise<unknown> } = {},
) {
  await context.route(`**/__fixtures/v1/${mode}/vehicles*`, async (route) => {
    try {
      await opts.hold
      const res = await route.fetch()
      const body = await res.json()
      const ts = Math.floor(Date.now() / 1000)
      await route.fulfill({
        response: res,
        json: {
          ...body,
          rtState: opts.rtState ?? 'live',
          rtSourceTimestamp: ts,
          generatedAt: Date.now(),
          vehicles: vehicles.map((v) => ({ ...v, ts })),
        },
      })
    } catch (error) {
      if (!/disposed|closed|Target page|Test ended/i.test(String(error))) throw error
    }
  })
}

/** Two vehicles near the mode's place: one on `trip` when given. */
const twoNear = (mode: Mode, opts: { trip?: string; route?: string } = {}) => {
  const { lat, lon } = NEAR[mode]
  const route = opts.route ?? { ferry: 'F1', train: 'BRCL', bus: '66' }[mode]
  return [
    {
      id: 'fx_a_Kurilpa',
      label: 'A1',
      tripKey: 'other@20200101',
      routeId: `${route}-1`,
      lat: lat + 0.002,
      lon,
    },
    {
      id: 'fx_b_Mudlark',
      label: 'B2',
      tripKey: opts.trip ?? 'mine@20200101',
      routeId: `${route}-1`,
      lat,
      lon: lon + 0.002,
    },
  ]
}

const map = (page: Page) => page.locator('[data-map-page] section[aria-label^="Map of"]')
const markers = (page: Page) => page.locator('[data-map-page] .bft-marker')
const vehicleMarkers = (page: Page) =>
  page.locator('[data-map-page] .bft-marker:is([data-tone=allstops],[data-tone=express])')

/** The map's zoom once it is idle with everything drawn (MapView's `data-map-idle`, e.g. "z15 bft-stops:12"). */
async function idle(page: Page): Promise<{ zoom: number; stops: number }> {
  await expect(map(page)).toHaveAttribute('data-map-idle', /^z\d+/, { timeout: 30_000 })
  const v = (await map(page).getAttribute('data-map-idle')) ?? ''
  return { zoom: Number(/^z(\d+)/.exec(v)?.[1]), stops: Number(/bft-stops:(\d+)/.exec(v)?.[1] ?? 0) }
}

/** Zoom out with the keyboard to city zoom (below `below`), then the idle state there. */
async function zoomOutTo(page: Page, below: number) {
  const canvas = page.locator('[data-map-page] canvas.maplibregl-canvas')
  await canvas.focus()
  await expect
    .poll(
      async () => {
        const v = (await map(page).getAttribute('data-map-idle')) ?? ''
        const z = Number(/^z(\d+)/.exec(v)?.[1] ?? 99)
        if (v && z >= below) await page.keyboard.press('Minus')
        return v ? z : 99
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBeLessThan(below)
  return idle(page)
}

/** Is the element's centre inside the map's box (in view)? */
async function inView(page: Page, selector: string) {
  const box = await map(page).boundingBox()
  const pin = await page.locator(selector).boundingBox()
  if (!box || !pin) return false
  const x = pin.x + pin.width / 2
  const y = pin.y + pin.height / 2
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height
}

/** The first row of a board, its trip page's URL and trip key. */
async function firstTrip(page: Page, board: string) {
  await page.goto(board)
  const row = page.locator('[data-board-column] [data-testid=departure] a').first()
  await expect(row).toBeVisible()
  const href = (await row.getAttribute('href')) as string
  return { href, key: decodeURIComponent(new URL(href, 'http://x').pathname.split('/').pop() as string) }
}

function shellTests() {
  for (const mode of ['ferry', 'train', 'bus'] as Mode[])
    test(`${mode}: the map fills the page below the header, legend in the mode's shape`, async ({ page }) => {
      await page.goto(`/${mode}/map`)
      const shell = page.locator(`[data-map-page=${mode}]`)
      await expect(shell.locator('canvas.maplibregl-canvas')).toBeVisible({ timeout: 30_000 })
      await expect(shell.locator(`[data-map-legend=${SHAPE[mode]}]`)).toBeVisible()
      await expect(shell.getByRole('heading', { level: 1 })).toHaveCount(1)
      // Full-bleed: as wide as the window, down to the bottom bar (phones) or the bottom, and the page doesn't scroll.
      const box = (await shell.boundingBox()) as { x: number; y: number; width: number; height: number }
      const vp = page.viewportSize() as { width: number; height: number }
      expect(box.x).toBe(0)
      expect(Math.round(box.width)).toBe(vp.width)
      const bar = page.locator('nav[aria-label="Modes"][data-bft-dock]')
      const bottom = (await bar.isVisible()) ? ((await bar.boundingBox())?.y ?? vp.height) : vp.height
      expect(Math.abs(box.y + box.height - bottom)).toBeLessThanOrEqual(8)
      const scroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)
      expect(scroll).toBeLessThanOrEqual(8)
    })
}

function pinTests() {
  test('ferry: circles for terminals and ferries at street and city zoom', async ({ page, context }) => {
    await serveVehicles(context, 'ferry', twoNear('ferry'))
    await page.goto('/ferry/map?terminal=bulimba')
    await page.getByRole('button', { name: 'All ferries' }).click()
    await expect(vehicleMarkers(page)).toHaveCount(2)
    const street = await idle(page)
    const count = await markers(page).count()
    expect(count).toBeGreaterThan(10)
    await expect(markers(page).and(page.locator(':not([data-shape=circle])'))).toHaveCount(0)
    const city = await zoomOutTo(page, street.zoom - 2)
    expect(city.zoom).toBeLessThan(street.zoom)
    await expect(markers(page)).toHaveCount(count)
    await expect(vehicleMarkers(page).first()).toHaveAttribute('data-shape', 'circle')
  })

  test('train: squares for stations and trains at street and city zoom', async ({ page, context }) => {
    await serveVehicles(context, 'train', twoNear('train'))
    await page.goto('/train/map?station=central')
    await expect(vehicleMarkers(page)).toHaveCount(2)
    const street = await idle(page)
    const count = await markers(page).count()
    expect(count).toBeGreaterThan(50)
    await expect(markers(page).and(page.locator(':not([data-shape=square])'))).toHaveCount(0)
    const city = await zoomOutTo(page, street.zoom - 2)
    expect(city.zoom).toBeLessThan(street.zoom)
    await expect(markers(page)).toHaveCount(count)
  })

  test('bus: diamonds at street zoom; at city zoom no stops are drawn (bounded) and it says to zoom in', async ({
    page,
    context,
  }) => {
    await serveVehicles(context, 'bus', twoNear('bus'))
    await page.goto('/bus/map?stop=10802&route=66&trip=mine@20200101')
    await expect(vehicleMarkers(page)).toHaveCount(1)
    await expect(markers(page).and(page.locator(':not([data-shape=diamond])'))).toHaveCount(0)
    // Street zoom: the stops layer has the stops in view, a bounded number of them.
    await expect.poll(async () => (await idle(page)).stops, { timeout: 30_000 }).toBeGreaterThan(0)
    const street = await idle(page)
    expect(street.zoom).toBeGreaterThanOrEqual(14)
    expect(street.stops).toBeLessThan(2_000)
    await expect(page.getByText('Zoom in to see bus stops')).toHaveCount(0)
    // City zoom: none drawn, and a handful of DOM markers at most (the stop, the route's buses).
    const city = await zoomOutTo(page, 14)
    expect(city.zoom).toBeLessThan(14)
    await expect.poll(async () => (await idle(page)).stops, { timeout: 30_000 }).toBe(0)
    expect(await markers(page).count()).toBeLessThanOrEqual(5)
    await expect(page.getByText('Zoom in to see bus stops')).toBeVisible()
  })
}

function chipTests() {
  const BOARDS = [
    {
      mode: 'ferry',
      board: '/ferry/terminal/bulimba',
      url: '/ferry/map?terminal=bulimba',
      pin: '[aria-label="Bulimba terminal"]',
    },
    {
      mode: 'train',
      board: '/train/station/central',
      url: '/train/map?station=central',
      pin: '[aria-label="Central station"]',
    },
    { mode: 'bus', board: '/bus/stop/10802', url: '/bus/map?stop=10802', pin: '[data-shape=diamond]' },
  ] as const
  for (const b of BOARDS)
    test(`${b.mode}: the board's Map chip opens the map on that place`, async ({ page }) => {
      await page.goto(b.board)
      await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
      await page.locator('[data-filter-row]').getByRole('link', { name: 'Map' }).click()
      await expect(page).toHaveURL(b.url)
      const pin = `[data-map-page] .bft-marker[data-tone=selected]${b.pin}`
      await expect(page.locator(pin)).toHaveCount(1, { timeout: 30_000 })
      await idle(page)
      expect(await inView(page, pin)).toBe(true)
    })
}

function trackTests() {
  const MODES = [
    { mode: 'ferry', board: '/ferry/terminal/bulimba', url: /\/ferry\/map\?terminal=bulimba&trip=/ },
    { mode: 'train', board: '/train/station/central', url: /\/train\/map\?station=central&trip=/ },
    { mode: 'bus', board: '/bus/stop/10802', url: /\/bus\/map\?route=[^&]+&trip=[^&]+&stop=10802/ },
  ] as const
  for (const m of MODES)
    test(`${m.mode}: "Track on map" follows that trip's vehicle`, async ({ page, context }) => {
      const { href, key } = await firstTrip(page, m.board)
      // The bus map asks for the trip's route: any route answers with these buses.
      await serveVehicles(context, m.mode, twoNear(m.mode, { trip: key }))
      await page.goto(href)
      await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
      await page.getByRole('link', { name: 'Track on map' }).first().click()
      await expect(page).toHaveURL(m.url)
      expect(new URL(page.url()).searchParams.get('trip')).toBe(key)
      const pin = '[data-map-page] .bft-marker[data-tone=selected][aria-label$="your trip"]'
      await expect(page.locator(pin)).toHaveCount(1, { timeout: 30_000 })
      await expect(page.locator(pin)).toHaveAttribute('data-shape', SHAPE[m.mode])
      await expect(page.locator('[data-map-card]')).toContainText('your trip')
      await idle(page)
      expect(await inView(page, pin)).toBe(true)
    })
}

function entryTests() {
  test('ferry: the old map links land on /ferry/map, and ferry home links to it', async ({ page }) => {
    await page.goto('/ferry/terminal/bulimba?map=1')
    await expect(page).toHaveURL(/\/ferry\/map\?terminal=bulimba$/)
    await page.goto('/ferry/terminal/bulimba?to=riverside&map=1&trip=abc%4020200101')
    await expect(page).toHaveURL(/\/ferry\/map\?terminal=bulimba&trip=abc%4020200101$/)
    await expect(page.locator('[data-map-page=ferry]')).toBeVisible()
    await page.goto('/ferry')
    await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
    await page.getByRole('link', { name: 'Map', exact: true }).click()
    await expect(page).toHaveURL(/\/ferry\/map$/)
    await expect(page.getByRole('heading', { name: 'Live ferry map' })).toBeAttached()
  })

  test('map pages are noindex', async ({ request }) => {
    for (const path of ['/ferry/map', '/train/map'])
      expect(await (await request.get(path)).text()).toContain('<meta name="robots" content="noindex"/>')
  })
}

function liveTests() {
  const PAGES = [
    { mode: 'ferry', url: '/ferry/map' },
    { mode: 'train', url: '/train/map' },
    { mode: 'bus', url: '/bus/map?route=66&trip=mine@20200101' },
  ] as const
  for (const p of PAGES) {
    test(`${p.mode}: Connecting… until the positions' own answer, then LIVE`, async ({ page, context }) => {
      let release = () => {}
      const hold = new Promise<void>((r) => {
        release = r
      })
      await serveVehicles(context, p.mode, twoNear(p.mode), { hold })
      await page.goto(p.url)
      await expect(page.locator('html[data-hydrated]')).toHaveCount(1)
      await expect(page.locator('header [data-connection]').first()).toHaveText('Connecting…')
      await expect(page.locator('header [data-connection="live"]')).toHaveCount(0)
      await expect(vehicleMarkers(page)).toHaveCount(0)
      release()
      await expect(page.locator('header [data-connection="live"]').first()).toHaveText('LIVE')
      await expect(vehicleMarkers(page).first()).toBeAttached({ timeout: 30_000 })
    })

    test(`${p.mode}: an answer that isn't live shows no positions and no LIVE`, async ({ page, context }) => {
      await serveVehicles(context, p.mode, twoNear(p.mode), { rtState: 'stale' })
      await page.goto(p.url)
      await expect(page.getByText('Live positions are unavailable right now.')).toBeVisible()
      await expect(page.locator('header [data-connection="live"]')).toHaveCount(0)
      await expect(vehicleMarkers(page)).toHaveCount(0)
      await expect(page.locator('[data-map-page] .bft-marker[aria-label$="your trip"]')).toHaveCount(0)
    })
  }
}

function noWebGLTests() {
  for (const url of ['/ferry/map?terminal=bulimba', '/train/map', '/bus/map'])
    test(`${url} without WebGL: "Map unavailable", no MapLibre, the page still works`, async ({ page }) => {
      await disableWebGL(page)
      const seen = watchMapFailures(page)
      await page.goto(url)
      await expectMapUnavailable(page)
      await expect(page.locator('[data-map-page] [role=status] a').first()).toBeVisible()
      expect(seen.errors).toEqual([])
      expect(seen.mapChunks).toEqual([])
    })
}

/** Phone and desktop alike, at 390 (touch) and 1280; the shell at 1440 too. */
function suite(shellOnly = false) {
  shellTests()
  if (shellOnly) return
  pinTests()
  chipTests()
  trackTests()
  entryTests()
  liveTests()
  noWebGLTests()
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
  suite(true)
})

test('no board or mode home loads a map chunk on its first load', async ({ request }) => {
  test.skip(test.info().project.name !== 'desktop', 'once')
  for (const path of [
    '/',
    '/ferry',
    '/train',
    '/bus',
    '/ferry/terminal/bulimba',
    '/train/station/central',
    '/bus/stop/10802',
  ]) {
    const html = await (await request.get(path)).text()
    const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g)].map((m) => m[1] as string)
    expect(urls.length, path).toBeGreaterThan(0)
    expect(
      urls.filter((u) => /\/assets\/(map|maplibre|MapView|SafeMap)\b[^/]*\.js$/i.test(u)),
      path,
    ).toEqual([])
  }
})
