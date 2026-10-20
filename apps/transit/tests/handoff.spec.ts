/**
 * P6b end to end: favourites saved on a mode host reach My Transit. Each mode host is emulated in the browser by
 * routing its origin through the mode Workers' own code (`transitRedirect` from @bft/ui/redirect, with the cookies the
 * browser holds for that host), so the real handoff page and script run on their own origin and storage, then land on
 * this transit build. The Workers' wiring (flag, CSP nonce, excluded paths) is unit-tested in each app.
 */
import { type RedirectMode, transitRedirect } from '@bft/ui/redirect'
import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { pinUpcoming } from './upcoming.ts'

const HOST: Record<RedirectMode, string> = {
  ferry: 'https://ferry.mode.test',
  train: 'https://train.mode.test',
  bus: 'https://bus.mode.test',
}
const SERVED = 'served by the mode host'

/** What each emulated mode host answered, in order: "handoff", a redirect status, or "served". */
async function emulateModeHost(
  context: BrowserContext,
  mode: RedirectMode,
  transit: string,
): Promise<string[]> {
  const answers: string[] = []
  await context.route(`${HOST[mode]}/**`, async (route) => {
    const req = route.request()
    const headers = new Headers(await req.allHeaders())
    const jar = await context.cookies(req.url())
    if (jar.length) headers.set('cookie', jar.map((c) => `${c.name}=${c.value}`).join('; '))
    const env = { REDIRECT_TO_TRANSIT: '1', REDIRECT_STATUS: '302', TRANSIT_SITE_URL: transit }
    const res = transitRedirect(
      new Request(req.url(), { method: req.method(), headers }),
      mode,
      env,
      'e2e-nonce',
    )
    if (!res) {
      answers.push('served')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: `<!doctype html><p id="served">${SERVED}</p>`,
      })
    }
    answers.push(res.status === 200 ? 'handoff' : String(res.status))
    await route.fulfill({
      status: res.status,
      headers: Object.fromEntries(res.headers),
      body: Buffer.from(await res.arrayBuffer()),
    })
  })
  return answers
}

/** Saves data in a mode host's own localStorage (via an excluded path it serves itself). */
async function seed(page: Page, mode: RedirectMode, items: Record<string, unknown>) {
  await page.goto(`${HOST[mode]}/__seed`)
  await expect(page.locator('#served')).toHaveText(SERVED)
  await page.evaluate((all) => {
    for (const [k, v] of Object.entries(all)) localStorage.setItem(k, JSON.stringify(v))
  }, items)
}

const watchErrors = (page: Page) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/openfreemap|tiles|Failed to load resource/i.test(m.text()))
      errors.push(m.text())
  })
  return errors
}
const importChunk = (page: Page) => {
  const loaded: string[] = []
  page.on('request', (r) => {
    if (/handoff-import/.test(r.url())) loaded.push(r.url())
  })
  return loaded
}

const CASES: {
  mode: RedirectMode
  items: Record<string, unknown>
  from: string
  to: string
  card: RegExp
  notice: string
}[] = [
  {
    mode: 'ferry',
    items: {
      'brisbane-ferry-selected-stops': {
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      },
      'brisbane-ferry-remember-selection': true,
    },
    from: '/',
    to: '/ferry',
    card: /Ferry.*Bulimba → Riverside/,
    notice: 'Your 1 stop moved to My Transit',
  },
  {
    mode: 'train',
    items: {
      'bft-train-favourites': [
        { from: 'roma-street', to: 'indooroopilly' },
        { from: 'central', to: null },
      ],
    },
    from: '/station/roma-street?to=indooroopilly',
    to: '/train/station/roma-street?to=indooroopilly',
    card: /Train.*Roma Street → Indooroopilly/,
    notice: 'Your 2 stops moved to My Transit',
  },
  {
    mode: 'bus',
    items: { 'bft-bus-saved': [{ id: '10802', name: 'Cultural Centre station, platform 1' }] },
    from: '/stop/10802',
    to: '/bus/stop/10802',
    card: /Bus.*Cultural Centre station, platform 1/,
    notice: 'Your 1 stop moved to My Transit',
  },
]

for (const c of CASES) {
  test(`${c.mode}: saved data on the mode host lands in My Transit, with the notice; then again without a second notice`, async ({
    page,
    context,
    baseURL,
  }) => {
    await pinUpcoming(context)
    const answers = await emulateModeHost(context, c.mode, baseURL ?? '')
    const errors = watchErrors(page)
    const loaded = importChunk(page)
    await seed(page, c.mode, c.items)
    await page.goto(`${HOST[c.mode]}${c.from}`)
    await expect(page).toHaveURL(`${baseURL}${c.to}`)
    expect(new URL(page.url()).hash).toBe('')
    await expect(page.locator('[data-handoff-notice]')).toHaveText(new RegExp(c.notice))
    expect(loaded.length).toBeGreaterThan(0)
    expect(answers).toEqual(['served', 'handoff'])

    await page.goto('/')
    await expect(page.getByRole('link', { name: c.card })).toBeVisible()
    await expect(page.locator('[data-handoff-notice]')).toHaveCount(0)

    // Second visit to the mode host: it still holds favourites, so it hands them over again (it can't know transit
    // stored them); transit's ledger finds nothing new: same page, no second notice, nothing duplicated.
    await page.goto(`${HOST[c.mode]}${c.from}`)
    await expect(page).toHaveURL(`${baseURL}${c.to}`)
    expect(answers).toEqual(['served', 'handoff', 'handoff'])
    await page.waitForTimeout(500)
    await expect(page.locator('[data-handoff-notice]')).toHaveCount(0)
    await page.goto('/')
    await expect(page.getByRole('link', { name: c.card })).toHaveCount(1)
    expect(errors).toEqual([])
  })
}

test('no saved data: the handoff page goes to the plain URL (no fragment, no notice) and sets the cookie, then plain 302s', async ({
  page,
  context,
  baseURL,
}) => {
  const answers = await emulateModeHost(context, 'bus', baseURL ?? '')
  const loaded = importChunk(page)
  await page.goto(`${HOST.bus}/route/333?pick=1`)
  await expect(page).toHaveURL(`${baseURL}/bus/route/333?pick=1`)
  await page.waitForTimeout(500)
  await expect(page.locator('[data-handoff-notice]')).toHaveCount(0)
  expect(loaded).toEqual([])
  await page.goto(`${HOST.bus}/nearby`)
  await expect(page).toHaveURL(`${baseURL}/bus/nearby`)
  expect(answers).toEqual(['handoff', '302'])
})

test('excluded paths are served by the mode host, not redirected', async ({ page, context, baseURL }) => {
  const answers = await emulateModeHost(context, 'train', baseURL ?? '')
  for (const path of [
    '/robots.txt',
    '/sitemap.xml',
    '/sw.js',
    '/manifest.webmanifest',
    '/v1/train/alerts',
    '/data/train/x.json',
  ]) {
    await page.goto(`${HOST.train}${path}`)
    await expect(page.locator('#served')).toHaveText(SERVED)
    expect(new URL(page.url()).origin).toBe(HOST.train)
  }
  expect(answers.every((a) => a === 'served')).toBe(true)
})

test('transit without a fragment never loads the import code', async ({ page }) => {
  const loaded = importChunk(page)
  for (const path of ['/', '/ferry', '/train', '/bus', '/bus/stop/10802', '/nearby', '/alerts']) {
    await page.goto(path)
    await expect(page.locator('main').first()).toBeVisible()
  }
  await page.waitForTimeout(500)
  expect(loaded).toEqual([])
})

test('a hostile fragment on transit is dropped: nothing saved, no notice, the page works', async ({
  page,
}) => {
  const errors = watchErrors(page)
  const evil = btoa(
    JSON.stringify({ v: 1, bus: [{ id: '1', name: '<img src=x onerror=alert(1)>' }], extra: 1 }),
  )
  await page.goto(`/#import=${evil.replace(/=+$/, '')}`)
  await expect(page.getByText('Nothing in My Transit yet')).toBeVisible()
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('')
  expect(await page.evaluate(() => localStorage.getItem('bft-bus-saved'))).toBeNull()
  await page.waitForTimeout(500)
  await expect(page.locator('[data-handoff-notice]')).toHaveCount(0)
  expect(errors).toEqual([])
})
