/**
 * GA4 end to end (@bft/ui/analytics-config, analytics-run.ts), against a second local server with GA switched on
 * (GA_MEASUREMENT_ID set), as production and staging are. The default servers leave it unset, so the rest of the
 * suite never loads gtag.js. No hit reaches Google: gtag.js is answered with a stub that records nothing (the events
 * are read from window.dataLayer, which the bootstrap's gtag fills) and any other Google request fails the test. One
 * test loads the real gtag.js to check the CSP lets its hits out, and answers each hit itself with a 204.
 */
import { devices, expect, type Page, test } from '@playwright/test'
import { gaPageTitle, type SiteMode } from '../src/analytics-config.ts'
import { onboardingAnswered } from './onboarding.ts'

/** Specs that run only against the GA server. */
export const GA_SPECS = '**/*.ga.spec.ts'
/**
 * The real property, so the real-gtag.js test sees where this property's hits really go. No hit reaches it: every
 * collect request is answered here (204), and the other tests stub gtag.js itself.
 */
export const GA_TEST_ID = 'G-MEG3CX0SFC'

export function gaServer({
  port,
  gaPort,
  readyPath,
  vars = [],
  reuseExistingServer,
}: {
  /** The default server's port: its `pnpm build` must finish before this one starts. */
  port: number
  gaPort: number
  readyPath: string
  vars?: string[]
  reuseExistingServer: boolean
}) {
  const extra = vars.map((v) => ` --var ${v}`).join('')
  return {
    command: `until curl -sf http://localhost:${port}${readyPath} >/dev/null; do sleep 1; done; wrangler dev --port ${gaPort} --inspector-port ${gaPort + 10_000} --var FIXTURES:1 --var ALLOW_FIXTURES:1 --var GA_MEASUREMENT_ID:${GA_TEST_ID}${extra}`,
    url: `http://localhost:${gaPort}${readyPath}`,
    timeout: 240_000,
    reuseExistingServer,
  }
}

export const gaProject = (gaPort: number) => ({
  name: 'ga',
  testMatch: GA_SPECS,
  // The config-wide testIgnore leaves these specs out of the other projects.
  testIgnore: [],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://localhost:${gaPort}`,
    storageState: onboardingAnswered(`http://localhost:${gaPort}`),
  },
})

type Event = { name: string; params: Record<string, unknown> }

/** Stubs gtag.js, fails on any other Google request, and collects CSP violations and page errors. */
export async function gaPage(page: Page): Promise<{ violations: string[]; google: string[] }> {
  const violations: string[] = []
  const google: string[] = []
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text())
  })
  await page.route('https://www.googletagmanager.com/gtag/js*', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: 'window.__gtagStub = true' }),
  )
  await page.route(
    /google-analytics\.com|analytics\.google\.com|googletagmanager\.com\/(?!gtag\/js)/,
    (route) => {
      google.push(route.request().url())
      return route.abort()
    },
  )
  await page.addInitScript(() =>
    document.addEventListener('securitypolicyviolation', (e) =>
      console.error(`Refused to load ${e.blockedURI} (${e.violatedDirective})`),
    ),
  )
  return { violations, google }
}

/** The events gtag was given, from the bootstrap's dataLayer (gtag("event", name, params)). */
export async function gaEvents(page: Page, name?: string): Promise<Event[]> {
  const all = await page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((a) => [...a])
      .filter((a) => a[0] === 'event')
      .map((a) => ({ name: a[1] as string, params: a[2] as Record<string, unknown> })),
  )
  return name ? all.filter((e) => e.name === name) : all
}

/** The whole GA flow on one site: page views, engaged_visit, save_stop and no CSP violation. */
export function gaSuite({
  siteMode,
  boardPath,
  navLink,
  navPath,
  saveMode,
  stopId,
}: {
  siteMode: string
  /** A stop board with departures (fixtures). */
  boardPath: string
  /** A client-side link on that board's page, and where it goes. */
  navLink: string
  navPath: string
  saveMode: string
  stopId: string
}) {
  for (const [label, use] of [
    ['phone 390 (touch)', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
    ['desktop 1280', { viewport: { width: 1280, height: 900 } }],
  ] as const) {
    test.describe(`GA4 on ${siteMode}: ${label}`, () => {
      test.use(use)
      test.setTimeout(60_000)

      test('page_view on load and per client navigation, engaged_visit once per session, no CSP violation', async ({
        page,
      }) => {
        const { violations, google } = await gaPage(page)
        await page.clock.install()
        await page.goto(boardPath)
        await expect(page.locator('[data-ga-board]').first()).toBeVisible()
        // /ga.js loads once the page has loaded and gone idle; its page_view settles after 100 ms.
        await page.clock.runFor(2_000)
        await expect.poll(() => gaEvents(page, 'page_view')).toHaveLength(1)
        const [first] = await gaEvents(page, 'page_view')
        expect(first?.params).toMatchObject({
          site_mode: siteMode,
          page_path: boardPath,
          page_title: gaPageTitle(boardPath, siteMode as SiteMode),
        })
        expect(String(first?.params.page_location)).toMatch(new RegExp(`${boardPath}$`))
        expect(await page.evaluate(() => (window as unknown as { __gtagStub?: boolean }).__gtagStub)).toBe(
          true,
        )

        // 10 s visible with the board on screen, no interaction: one engaged_visit.
        expect(await gaEvents(page, 'engaged_visit')).toHaveLength(0)
        await page.clock.runFor(10_000)
        await expect.poll(() => gaEvents(page, 'engaged_visit')).toHaveLength(1)
        const origin = new URL(page.url()).origin
        expect((await gaEvents(page, 'engaged_visit'))[0]?.params).toEqual({
          site_mode: siteMode,
          page_location: `${origin}${boardPath}`,
          // The path-based title (e.g. "bus stop 10802"), never the board's own, which names the stop.
          page_title: gaPageTitle(boardPath, siteMode as SiteMode),
          value: 1,
          currency: 'AUD',
        })

        // A client navigation: one more page_view, no second engaged_visit.
        // The one on screen: phones and desktops each hide the other layout's links.
        await page.locator(`a[href="${navLink}"]:visible`).first().click()
        await expect(page).toHaveURL(new RegExp(`${navPath}$`))
        await page.clock.runFor(1_000)
        await expect.poll(() => gaEvents(page, 'page_view')).toHaveLength(2)
        expect((await gaEvents(page, 'page_view'))[1]?.params).toMatchObject({
          site_mode: siteMode,
          page_path: navPath,
        })

        // Same session after a reload: a fresh page_view, never a second engaged_visit.
        await page.reload()
        await page.clock.runFor(15_000)
        await expect.poll(() => gaEvents(page, 'page_view')).toHaveLength(1)
        expect(await gaEvents(page, 'engaged_visit')).toHaveLength(0)
        expect(new Set((await gaEvents(page)).map((e) => e.params.site_mode))).toEqual(new Set([siteMode]))

        expect(violations).toEqual([])
        expect(google).toEqual([])
      })

      test('the real gtag.js: the CSP lets its GA4 hits out (answered here with 204, never sent to Google)', async ({
        page,
      }) => {
        const refused: string[] = []
        page.on('console', (m) => {
          if (/Content Security Policy|Refused to/i.test(m.text())) refused.push(m.text())
        })
        await page.addInitScript(() =>
          document.addEventListener('securitypolicyviolation', (e) =>
            console.error(`Refused to load ${e.blockedURI} (${e.violatedDirective})`),
          ),
        )
        // Routes registered later win. Any other Google request (Google signals and Ads beacons, which the CSP refuses
        // anyway) is never sent.
        await page.route(/google\.com|google\.com\.au|doubleclick\.net/, (route) => route.abort())
        const hits: string[] = []
        await page.route(
          /^https:\/\/([\w-]+\.)*(google-analytics\.com|analytics\.google\.com)\//,
          (route) => {
            // GA4 sends a batch's events in the body, one per line.
            hits.push(`${route.request().url()}\n${route.request().postData() ?? ''}`)
            return route.fulfill({ status: 204 })
          },
        )
        let real = true
        await page.route(/^https:\/\/www\.googletagmanager\.com\//, async (route) => {
          try {
            await route.fulfill({ response: await route.fetch() })
          } catch {
            real = false
            await route.abort()
          }
        })
        await page.goto(boardPath)
        await expect(page.locator('[data-ga-board]').first()).toBeVisible()
        await expect
          .poll(() => (real ? hits.filter((u) => u.includes('/g/collect')).length : -1), { timeout: 20_000 })
          .not.toBe(0)
        test.skip(!real, 'gtag.js could not be downloaded (no network)')
        await expect.poll(() => hits.some((h) => /(^|[?&\n])en=page_view(&|$|\n)/.test(h))).toBe(true)
        // Every hit's title (dt, in the URL or a batched event's line) is the path-based one (gaPageTitle), never the
        // page's own title, which names the stop: gtag's own events too.
        const pageTitle = await page.title()
        const titles = hits.flatMap((h) =>
          h
            .split('\n')
            .flatMap((l) =>
              [...l.matchAll(/(?:^|[?&])dt=([^&]*)/g)].map((m) => decodeURIComponent(m[1] ?? '')),
            ),
        )
        expect(titles.length).toBeGreaterThan(0)
        for (const t of titles) {
          expect(t).toMatch(/^(ferry|train|bus|transit) [a-z][a-z-]*( [A-Za-z0-9._-]+)?$/)
          expect(t).not.toBe(pageTitle)
        }
        // After a client navigation gtag's own events (scroll, user_engagement) carry the new page's URL and title:
        // they come from gtag("set"), which /ga.js updates per route, and nothing in the config outranks it. Our own
        // events (page_view, engaged_visit, save_stop) don't count here.
        const OWN = ['page_view', 'engaged_visit', 'save_stop']
        const auto = () =>
          hits.flatMap((h) => {
            const [url = '', body = ''] = h.split(/\n(.*)/s)
            const shared = new URL(url).searchParams
            return body
              .split('\n')
              .concat(shared.toString())
              .map((l) => new URLSearchParams(l))
              .filter((p) => p.get('en') && !OWN.includes(p.get('en') as string))
              .map((p) => ({
                en: p.get('en'),
                dt: p.get('dt') ?? shared.get('dt'),
                dl: p.get('dl') ?? shared.get('dl'),
              }))
          })
        const before = auto().length
        await page.locator(`a[href="${navLink}"]:visible`).first().click()
        await page.waitForURL((u) => u.pathname === navPath)
        await expect
          .poll(() => hits.some((h) => h.includes('en=page_view') && h.includes(encodeURIComponent(navPath))))
          .toBe(true)
        // gtag's scroll fires at 90% depth on a page taller than the window; user_engagement when the page is left,
        // which also flushes the batch. Its scroll check needs a moment before the page goes.
        await page.mouse.wheel(0, 20_000)
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(2_000)
        const scrolled = await page.evaluate(
          () => scrollY > 0 && (scrollY + innerHeight) / document.documentElement.scrollHeight >= 0.9,
        )
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
          document.dispatchEvent(new Event('visibilitychange'))
          window.dispatchEvent(new Event('pagehide'))
        })
        const expected = scrolled ? ['scroll', 'user_engagement'] : ['user_engagement']
        await expect
          .poll(
            () =>
              expected.every((en) =>
                auto()
                  .slice(before)
                  .some((e) => e.en === en),
              ),
            { timeout: 15_000 },
          )
          .toBe(true)
        for (const e of auto().slice(before)) {
          expect(e.dt, `${e.en} after the route change`).toBe(gaPageTitle(navPath, siteMode as SiteMode))
          expect(new URL(e.dl ?? '').pathname, `${e.en} after the route change`).toBe(navPath)
        }
        // The blocked URL (the message quotes the policy too, which names these hosts): the Ads and Google signals
        // beacons (www.google.com, doubleclick) are refused on purpose; GA4's own collection never is.
        const blocked = refused.map((m) => /(?:to|image|load) '?(https:\/\/[^'\s]+)/.exec(m)?.[1] ?? m)
        expect(
          blocked.filter((u) =>
            /^https:\/\/([\w-]+\.)*(google-analytics\.com|analytics\.google\.com)\//.test(u),
          ),
        ).toEqual([])
      })

      test('the CSP lists gtag.js and the collection origins, keeps the nonce, and the bootstrap carries it', async ({
        request,
      }) => {
        const res = await request.get(boardPath)
        const csp = (res.headers()['content-security-policy'] ?? '').split('; ')
        const d = (name: string) => csp.find((x) => x.startsWith(`${name} `)) ?? ''
        const nonce = /'nonce-([^']+)'/.exec(d('script-src'))?.[1]
        expect(nonce).toBeTruthy()
        expect(d('script-src')).toContain('https://www.googletagmanager.com')
        expect(d('script-src')).not.toMatch(/unsafe-inline|unsafe-eval/)
        // The bare analytics.google.com is where this property's hits go (the wildcard doesn't match it).
        for (const o of [
          'https://*.google-analytics.com',
          'https://analytics.google.com',
          'https://*.analytics.google.com',
          'https://*.googletagmanager.com',
        ])
          expect(d('connect-src').split(' ')).toContain(o)
        for (const o of ['https://*.google-analytics.com', 'https://*.googletagmanager.com'])
          expect(d('img-src')).toContain(o)
        const html = await res.text()
        expect(html).toContain(`<script nonce="${nonce}">(function(){window.dataLayer`)
        expect(html).toContain(`"site_mode":"${siteMode}"`)
      })

      test('save_stop after starring a stop, with its id only; none for the unsave; no position or text sent', async ({
        page,
      }) => {
        const { violations, google } = await gaPage(page)
        // A position and some text in the address (as Nearby's map links carry): never in what GA gets.
        await page.goto(`${boardPath}?lat=-27.47171&lon=153.02061&q=my%20street`)
        const origin = new URL(page.url()).origin
        const star = page.getByRole('button', { name: /to My Transit$/ }).first()
        await expect(star).toHaveAttribute('aria-pressed', 'false')
        await star.click()
        await expect(star).toHaveAttribute('aria-pressed', 'true')
        expect(await gaEvents(page, 'save_stop')).toEqual([
          {
            name: 'save_stop',
            params: {
              site_mode: siteMode,
              page_location: `${origin}${boardPath}`,
              page_title: gaPageTitle(boardPath, siteMode as SiteMode),
              mode: saveMode,
              stop_id: stopId,
              value: 3,
              currency: 'AUD',
            },
          },
        ])
        await star.click()
        await expect(star).toHaveAttribute('aria-pressed', 'false')
        expect(await gaEvents(page, 'save_stop')).toHaveLength(1)
        const sent = await page.evaluate(() =>
          JSON.stringify(
            ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? []).map((a) => [...a]),
          ),
        )
        expect(sent).not.toMatch(/lat=|lon=|153\.02|my%20street|my street/)
        expect(violations).toEqual([])
        expect(google).toEqual([])
      })
    })
  }
}
