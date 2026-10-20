// @vitest-environment node
/** P6: page navigations redirect to BrisbaneTransit when REDIRECT_TO_TRANSIT is "1", through the Worker's fetch handler. */
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { unstable_readConfig } from 'wrangler'
import worker from '../workers/app.ts'

vi.mock('virtual:react-router/server-build', () => ({}))
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))
// SSR stands in for React Router: any HTML page.
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  createRequestHandler: () => async () =>
    new Response('<!doctype html><title>t</title>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }),
}))

const SITE = 'https://bft-train.brisbanetransit.workers.dev'
const TRANSIT = 'https://bft-transit.brisbanetransit.workers.dev'
const ON = { REDIRECT_TO_TRANSIT: '1', TRANSIT_SITE_URL: TRANSIT }
const envWith = (vars: Record<string, unknown> = {}) =>
  ({
    SITE_URL: SITE,
    API_BASE: 'http://x',
    ALLOW_FIXTURES: '1',
    FIXTURES: '0',
    BUILD_SHA: '1a2b3c4',
    API: { fetch: vi.fn(async () => Response.json({ ok: true })) },
    ASSETS: { fetch: vi.fn(async () => new Response('Not found', { status: 404 })) },
    ...vars,
  }) as unknown as Env
const get = (path: string, env: Env, init: RequestInit = {}) =>
  worker.fetch(new Request(`${SITE}${path}`, init), env, {} as ExecutionContext) as Promise<Response>

const PAGES: [string, string][] = [
  ['/', '/train'],
  ['/stations', '/train/stations'],
  ['/station/central', '/train/station/central'],
  ['/trip/abc', '/train/trip/abc'],
  ['/map', '/train/map'],
  ['/alerts', '/train/alerts'],
  ['/feedback', '/feedback'],
  ['/nope', '/train'],
]
const EXCLUDED = [
  '/v1/x/departures',
  '/api/gtfs-proxy',
  '/__fixtures/v1/x',
  '/__manifest',
  '/sitemap.xml',
  '/robots.txt',
  '/sw.js',
  '/manifest.webmanifest',
  '/assets/x-abc.js',
  '/icon-192.png',
  '/home.data',
  '/__trip-ws-stats/x',
  '/data/train/stations.json',
]

describe('redirect to transit (P6)', () => {
  it.each(PAGES)('%s → %s, with the security headers and build marker', async (path, want) => {
    const res = await get(path, envWith(ON))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`${TRANSIT}${want}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('x-bft-build')).toBe('1a2b3c4')
  })

  it('301 only when REDIRECT_STATUS is "301"', async () => {
    expect((await get('/', envWith({ ...ON, REDIRECT_STATUS: '301' }))).status).toBe(301)
  })

  it.each(EXCLUDED)('%s is served as before', async (path) => {
    const res = await get(path, envWith(ON))
    expect(res.headers.get('location')).toBeNull()
  })

  it('POST, fetch() and WebSocket upgrades are served as before', async () => {
    expect((await get('/', envWith(ON), { method: 'POST' })).headers.get('location')).toBeNull()
    expect((await get('/', envWith(ON), { headers: { 'sec-fetch-mode': 'cors' } })).status).toBe(200)
    const ws = await get('/', envWith(ON), { headers: { upgrade: 'websocket', connection: 'Upgrade' } })
    expect(ws.headers.get('location')).toBeNull()
  })

  it('flag off (unset or not "1"): pages render as before', async () => {
    for (const flag of [undefined, '0']) {
      const res = await get(PAGES[1][0], envWith({ TRANSIT_SITE_URL: TRANSIT, REDIRECT_TO_TRANSIT: flag }))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
    }
  })
})

describe('wrangler.jsonc', () => {
  const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
  const read = (env?: string) => unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true })
  it('REDIRECT_TO_TRANSIT and REDIRECT_STATUS are unset in production', () => {
    for (const env of ['production', 'production-preview']) {
      const vars = read(env).vars as Record<string, unknown>
      expect(vars.REDIRECT_TO_TRANSIT, env).toBeUndefined()
      expect(vars.REDIRECT_STATUS, env).toBeUndefined()
    }
  })
  it('staging redirects to the staging transit host', () => {
    expect(read('staging').vars.TRANSIT_SITE_URL).toBe(TRANSIT)
  })
})
