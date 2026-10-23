// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  isExcludedPath,
  type RedirectEnv,
  type RedirectMode,
  transitOrigin,
  transitPath,
  transitRedirect,
} from '../src/redirect.ts'

const BASE = 'https://bft-transit.brisbanetransit.workers.dev'
const ON: RedirectEnv = { REDIRECT_TO_TRANSIT: '1', TRANSIT_SITE_URL: BASE }
const MODES: RedirectMode[] = ['ferry', 'train', 'bus']

const nav = (path: string, init: RequestInit = {}) =>
  new Request(`https://mode.test${path}`, {
    ...init,
    headers: { 'sec-fetch-mode': 'navigate', ...init.headers },
  })

const locationOf = (mode: RedirectMode, path: string, env: RedirectEnv = ON) =>
  transitRedirect(nav(path), mode, env)?.headers.get('location') ?? null

describe('transitPath (P6 mapping)', () => {
  it.each([
    ['ferry', '/', '/ferry'],
    ['ferry', '/terminal/bulimba', '/ferry/terminal/bulimba'],
    ['ferry', '/privacy', '/ferry/privacy'],
    ['ferry', '/map', '/ferry/map'],
    ['ferry', '/terms', '/ferry/terms'],
    ['ferry', '/feedback', '/feedback'],
    ['train', '/', '/train'],
    ['train', '/stations', '/train/stations'],
    ['train', '/station/central', '/train/station/central'],
    ['train', '/trip/abc-123', '/train/trip/abc-123'],
    ['train', '/map', '/train/map'],
    ['train', '/alerts', '/train/alerts'],
    ['train', '/feedback', '/feedback'],
    ['bus', '/', '/bus'],
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

  it("another mode's page or an unknown path goes to the mode's transit home, path dropped", () => {
    expect(transitPath('ferry', '/stations')).toBe('/ferry')
    expect(transitPath('train', '/terminal/bulimba')).toBe('/train')
    expect(transitPath('bus', '/stop/1/extra')).toBe('/bus')
    expect(transitPath('bus', '/nope')).toBe('/bus')
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
      expect(transitRedirect(nav(path), mode, ON)).toBeNull()
    }
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
    expect(locationOf('ferry', '/?fixtures=1')).toBe(`${BASE}/ferry?fixtures=1`)
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
