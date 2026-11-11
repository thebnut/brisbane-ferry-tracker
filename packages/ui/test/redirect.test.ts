// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isExcludedPath,
  type RedirectEnv,
  type RedirectMode,
  seoFilePath,
  transitOrigin,
  transitPath,
  transitRedirect,
} from '../src/redirect.ts'

const BASE = 'https://bft-transit.brisbanetransit.workers.dev'
const ON: RedirectEnv = { REDIRECT_TO_TRANSIT: '1', TRANSIT_SITE_URL: BASE }
const PERMANENT: RedirectEnv = { ...ON, REDIRECT_STATUS: '301' }
const MODES: RedirectMode[] = ['ferry', 'train', 'bus']
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const nav = (path: string, init: RequestInit = {}) =>
  new Request(`https://mode.test${path}`, {
    ...init,
    headers: { 'sec-fetch-mode': 'navigate', ...init.headers },
  })

const locationOf = (mode: RedirectMode, path: string, env: RedirectEnv = ON) =>
  transitRedirect(nav(path), mode, env)?.headers.get('location') ?? null

describe('transitPath (P6 mapping)', () => {
  it.each([
    ['ferry', '/', '/ferry/'],
    ['ferry', '/terminal/bulimba', '/ferry/terminal/bulimba'],
    ['ferry', '/privacy', '/ferry/privacy'],
    ['ferry', '/map', '/ferry/map'],
    ['ferry', '/terms', '/ferry/terms'],
    ['ferry', '/feedback', '/feedback'],
    ['train', '/', '/train/'],
    ['train', '/stations', '/train/stations'],
    ['train', '/station/central', '/train/station/central'],
    ['train', '/trip/abc-123', '/train/trip/abc-123'],
    ['train', '/map', '/train/map'],
    ['train', '/alerts', '/train/alerts'],
    ['train', '/feedback', '/feedback'],
    ['bus', '/', '/bus/'],
    ['bus', '/nearby', '/bus/nearby'],
    ['bus', '/stop/10802', '/bus/stop/10802'],
    ['bus', '/trip/t1', '/bus/trip/t1'],
    ['bus', '/route/66', '/bus/route/66'],
    ['bus', '/map', '/bus/map'],
    ['bus', '/alerts', '/bus/alerts'],
    ['bus', '/about', '/bus/about'],
    ['bus', '/feedback', '/feedback'],
  ] as const)('%s %s → %s', (mode, path, want) => {
    expect(transitPath(mode, path)).toBe(want)
  })

  it('a trailing slash is the same page', () => {
    expect(transitPath('train', '/stations/')).toBe('/train/stations')
    expect(transitPath('bus', '/stop/10802/')).toBe('/bus/stop/10802')
  })

  it("another mode's page or an unknown path goes to the mode's transit home (its /<mode>/ canonical), path dropped", () => {
    expect(transitPath('ferry', '/stations')).toBe('/ferry/')
    expect(transitPath('train', '/terminal/bulimba')).toBe('/train/')
    expect(transitPath('bus', '/stop/1/extra')).toBe('/bus/')
    expect(transitPath('bus', '/nope')).toBe('/bus/')
  })

  it('a path that already carries the mode prefix keeps a single one (never /ferry/ferry/…)', () => {
    expect(transitPath('ferry', '/ferry/terminal/south-bank')).toBe('/ferry/terminal/south-bank')
    expect(transitPath('ferry', '/ferry/terminal/south-bank/')).toBe('/ferry/terminal/south-bank')
    expect(transitPath('ferry', '/ferry/map')).toBe('/ferry/map')
    expect(transitPath('train', '/train/station/central')).toBe('/train/station/central')
    expect(transitPath('train', '/train/stations')).toBe('/train/stations')
    expect(transitPath('bus', '/bus/stop/10802')).toBe('/bus/stop/10802')
    expect(transitPath('bus', '/bus/route/66')).toBe('/bus/route/66')
    for (const mode of MODES) {
      expect(transitPath(mode, `/${mode}`)).toBe(`/${mode}/`)
      expect(transitPath(mode, `/${mode}/`)).toBe(`/${mode}/`)
      expect(transitPath(mode, `/${mode}/feedback`)).toBe('/feedback')
      // Only one prefix is taken off, so a doubled old URL can't be laundered into a page: it goes home.
      expect(transitPath(mode, `/${mode}/${mode}/nope`)).toBe(`/${mode}/`)
    }
    // Another mode's prefix is not this mode's: an unknown path, so the home.
    expect(transitPath('train', '/ferry/terminal/bulimba')).toBe('/train/')
    expect(transitPath('ferry', '/ferryx/terminal/bulimba')).toBe('/ferry/')
  })

  it('every result is a single-prefixed transit path, so redirecting it again changes nothing (no loop)', () => {
    for (const mode of MODES)
      for (const path of [
        '/',
        '/nope',
        `/${mode}`,
        `/${mode}/`,
        '/terminal/bulimba',
        '/station/central',
        '/stop/1',
        `/${mode}/map`,
      ]) {
        const once = transitPath(mode, path)
        expect(once).not.toBeNull()
        expect(once?.startsWith(`/${mode}/${mode}`), `${mode} ${path} → ${once}`).toBe(false)
        if (once !== '/feedback') expect(transitPath(mode, once ?? '')).toBe(once)
      }
  })

  it('a bus stop number with leading zeros goes straight to the unpadded stop page (one hop)', () => {
    expect(transitPath('bus', '/stop/000001')).toBe('/bus/stop/1')
    expect(transitPath('bus', '/stop/010813')).toBe('/bus/stop/10813')
    expect(transitPath('bus', '/bus/stop/010813/')).toBe('/bus/stop/10813')
    expect(transitPath('bus', '/stop/000000')).toBe('/bus/stop/0')
    // Only what the bus app's canonicalStopId unpads (2–6 digits with a leading zero).
    expect(transitPath('bus', '/stop/0')).toBe('/bus/stop/0')
    expect(transitPath('bus', '/stop/0000001')).toBe('/bus/stop/0000001')
    expect(transitPath('bus', '/stop/10813')).toBe('/bus/stop/10813')
    expect(transitPath('bus', '/stop/0abc')).toBe('/bus/stop/0abc')
  })

  it('keeps encoded segments as they are', () => {
    expect(transitPath('train', '/station/roma%20street')).toBe('/train/station/roma%20street')
  })
})

describe('excluded paths are never redirected', () => {
  const excluded = [
    '/v1/ferry/departures',
    '/v1/train/trips/x/ws',
    '/v1',
    '/api/gtfs-proxy',
    '/api/feedback',
    '/api',
    '/data/bus/stops.json',
    '/data/train/stations.json',
    '/sitemap.xml',
    '/sitemaps/pages.xml',
    '/sitemaps/stops-1.xml',
    '/robots.txt',
    '/sw.js',
    '/manifest.webmanifest',
    '/assets/index-abc123.js',
    '/assets/app.css',
    '/icon-192.png',
    '/icon-512.png',
    '/apple-touch-icon.png',
    '/favicon.ico',
    '/favicon.svg',
    '/og-image.jpg',
    '/__fixtures/v1/ferry/departures',
    '/__manifest',
    '/__trip-ws-stats/x',
    '/stations.data',
    '/_root.data',
  ]
  it.each(excluded)('%s', (path) => {
    expect(isExcludedPath(path)).toBe(true)
    for (const mode of MODES) {
      expect(transitPath(mode, path)).toBeNull()
      // robots.txt, llms.txt and the sitemaps go to transit's own (below), never to a page.
      if (!seoFilePath(path)) expect(transitRedirect(nav(path), mode, ON)).toBeNull()
    }
  })
})

describe("the SEO files go to transit's own (one hop, like the legacy ferry hosts)", () => {
  it.each([
    ['/robots.txt', '/robots.txt'],
    ['/llms.txt', '/llms.txt'],
    ['/sitemap.xml', '/sitemap.xml'],
    ['/sitemaps/pages.xml', '/sitemap.xml'],
    ['/sitemaps/routes.xml', '/sitemap.xml'],
    ['/sitemaps/stops-3.xml', '/sitemap.xml'],
  ] as const)('%s → %s', (path, want) => {
    for (const mode of MODES) {
      // Crawlers fetch robots.txt and sitemaps without Fetch Metadata, and a browser's fetch() is redirected too.
      for (const req of [
        new Request(`https://mode.test${path}`),
        nav(path),
        nav(path, { headers: { 'sec-fetch-mode': 'cors' } }),
        new Request(`https://mode.test${path}`, { method: 'HEAD' }),
      ]) {
        const res = transitRedirect(req, mode, PERMANENT)
        expect(res?.status).toBe(301)
        expect(res?.headers.get('location')).toBe(`${BASE}${want}`)
      }
    }
  })

  it('never a handoff page, even for a browser with favourites', () => {
    const req = nav('/robots.txt', { headers: { 'user-agent': CHROME, accept: 'text/html' } })
    const res = transitRedirect(req, 'bus', PERMANENT, 'nonce')
    expect(res?.status).toBe(301)
    expect(res?.headers.get('location')).toBe(`${BASE}/robots.txt`)
  })

  it('only GET and HEAD, only while the pages move', () => {
    expect(
      transitRedirect(new Request('https://mode.test/robots.txt', { method: 'POST' }), 'bus', PERMANENT),
    ).toBeNull()
    expect(
      transitRedirect(new Request('https://mode.test/robots.txt'), 'bus', {
        ...PERMANENT,
        REDIRECT_TO_TRANSIT: '0',
      }),
    ).toBeNull()
  })

  it('other files stay local: APIs, data, the PWA files and assets', () => {
    for (const path of [
      '/sw.js',
      '/manifest.webmanifest',
      '/data/bus/stops.json',
      '/v1/x',
      '/api/feedback',
      '/sitemaps/x/y.xml',
      '/robots.txt.bak',
    ])
      expect(seoFilePath(path)).toBeNull()
  })
})

describe('transitRedirect', () => {
  it('is off unless REDIRECT_TO_TRANSIT is "1"', () => {
    for (const flag of [undefined, '', '0', 'true', '01']) {
      expect(transitRedirect(nav('/'), 'bus', { ...ON, REDIRECT_TO_TRANSIT: flag })).toBeNull()
    }
  })

  it('302 by default, no-store; 301 only when REDIRECT_STATUS is "301"', () => {
    const r302 = transitRedirect(nav('/stations'), 'train', ON)
    expect(r302?.status).toBe(302)
    expect(r302?.headers.get('cache-control')).toBe('no-store')
    expect(transitRedirect(nav('/'), 'train', { ...ON, REDIRECT_STATUS: '302' })?.status).toBe(302)
    expect(transitRedirect(nav('/'), 'train', { ...ON, REDIRECT_STATUS: '308' })?.status).toBe(302)
    expect(transitRedirect(nav('/'), 'train', { ...ON, REDIRECT_STATUS: '301' })?.status).toBe(301)
  })

  it('keeps the query string', () => {
    expect(locationOf('bus', '/stop/10900?route=333')).toBe(`${BASE}/bus/stop/10900?route=333`)
    expect(locationOf('bus', '/route/333?pick=1')).toBe(`${BASE}/bus/route/333?pick=1`)
    expect(locationOf('ferry', '/?fixtures=1')).toBe(`${BASE}/ferry/?fixtures=1`)
    expect(locationOf('ferry', '/ferry/terminal/south-bank?x=1')).toBe(
      `${BASE}/ferry/terminal/south-bank?x=1`,
    )
    expect(locationOf('train', '/train?y=2')).toBe(`${BASE}/train/?y=2`)
    expect(locationOf('train', '/feedback?x=1')).toBe(`${BASE}/feedback?x=1`)
  })

  it('HEAD is redirected; other methods and OPTIONS preflights are not', () => {
    expect(transitRedirect(nav('/', { method: 'HEAD' }), 'ferry', ON)?.status).toBe(302)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
      expect(transitRedirect(nav('/feedback', { method }), 'ferry', ON)).toBeNull()
    }
    const preflight = new Request('https://mode.test/feedback', {
      method: 'OPTIONS',
      headers: { origin: 'https://elsewhere.test', 'access-control-request-method': 'POST' },
    })
    expect(transitRedirect(preflight, 'ferry', ON)).toBeNull()
  })

  it('only page navigations: fetch(), no-cors and other subresource requests are served as before', () => {
    for (const mode of ['cors', 'no-cors', 'same-origin', 'websocket']) {
      expect(transitRedirect(nav('/', { headers: { 'sec-fetch-mode': mode } }), 'bus', ON)).toBeNull()
    }
    // Clients without Fetch Metadata (curl, bots, old browsers) are page navigations.
    expect(transitRedirect(new Request('https://mode.test/alerts'), 'bus', ON)?.status).toBe(302)
  })

  it('never redirects a WebSocket or other upgrade, on any path', () => {
    for (const path of ['/', '/stations', '/v1/train/trips/x/ws']) {
      const req = nav(path, { headers: { upgrade: 'websocket', connection: 'Upgrade' } })
      expect(transitRedirect(req, 'train', ON)).toBeNull()
    }
  })

  it('no redirect without a valid http(s) TRANSIT_SITE_URL', () => {
    for (const base of [
      undefined,
      '',
      'not a url',
      'javascript:alert(1)',
      'ftp://x.test',
      'data:text/html,x',
    ]) {
      expect(transitRedirect(nav('/'), 'bus', { ...ON, TRANSIT_SITE_URL: base })).toBeNull()
    }
  })

  it('uses only the configured origin (a path or query in the base is ignored)', () => {
    expect(transitOrigin(`${BASE}/some/path?x=1#y`)).toBe(BASE)
    expect(locationOf('bus', '/nearby', { ...ON, TRANSIT_SITE_URL: `${BASE}/some/path` })).toBe(
      `${BASE}/bus/nearby`,
    )
  })

  describe('open redirect: the Location is always on the transit origin', () => {
    const hostile = [
      '//evil.test',
      '//evil.test/stations',
      '/\\evil.test',
      '/%2F%2Fevil.test',
      '/%5Cevil.test',
      '/station/%2F%2Fevil.test',
      '/station/..%2F..%2Fevil.test',
      '/stop/@evil.test',
      '/route/https:%2F%2Fevil.test',
      '/..//evil.test',
      '/./../../evil.test',
      '/trip/x?next=https://evil.test',
      '/feedback#https://evil.test',
      '/%09/evil.test',
      '/%00',
    ]
    it.each(hostile)('%s', (path) => {
      for (const mode of MODES) {
        const res = transitRedirect(nav(path), mode, ON)
        if (!res) continue
        const location = res.headers.get('location') ?? ''
        const u = new URL(location)
        expect(u.origin).toBe(BASE)
        expect(u.pathname.startsWith('//')).toBe(false)
        expect(
          ['/feedback', `/${mode}`].some((p) => u.pathname === p || u.pathname.startsWith(`${p}/`)),
        ).toBe(true)
      }
    })
  })
})
