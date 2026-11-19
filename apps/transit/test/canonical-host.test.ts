/** www → apex 301 and the INDEXABLE soft-launch flag, through the Worker's fetch handler. */

import { transitLocation } from '@bft/ui/redirect'
import { describe, expect, it, vi } from 'vitest'
import worker from '../workers/app.ts'
import { canonicalLocation, canonicalPagePath, wwwRedirectLocation } from '../workers/security.ts'

vi.mock('virtual:react-router/server-build', () => ({}))

const SITE = 'https://brisbanetransit.com'
const envWith = (vars: Record<string, string> = {}) =>
  ({ SITE_URL: SITE, API_BASE: 'http://x', ...vars }) as unknown as Env
const get = (url: string, env: Env) =>
  worker.fetch(new Request(url), env, {} as ExecutionContext) as Promise<Response>

describe('wwwRedirectLocation', () => {
  it('sends www to the apex with the path and query kept (hosts are case-insensitive)', () => {
    expect(wwwRedirectLocation('https://www.brisbanetransit.com/a?x=1&y=2', SITE)).toBe(`${SITE}/a?x=1&y=2`)
    expect(wwwRedirectLocation('http://WWW.BRISBANETRANSIT.COM/', SITE)).toBe(`${SITE}/`)
  })

  it('leaves the apex and every other host alone', () => {
    for (const u of [
      'https://brisbanetransit.com/a',
      'https://bft-transit-prod.brisbanetransit.workers.dev/a',
      'https://www.brisbanetrain.com/a',
      'https://www.brisbanetransit.com.evil.example/a',
      'https://evil.example/www.brisbanetransit.com',
    ])
      expect(wwwRedirectLocation(u, SITE), u).toBeNull()
  })

  it('does nothing for a www canonical or a bad SITE_URL', () => {
    expect(
      wwwRedirectLocation('https://www.www.brisbanetransit.com/', 'https://www.brisbanetransit.com'),
    ).toBeNull()
    expect(wwwRedirectLocation('https://www.brisbanetransit.com/', 'not a url')).toBeNull()
  })
})

describe('canonical host', () => {
  it('301s www to the fixed apex, keeping path and query, with the security headers', async () => {
    const res = await get('https://www.brisbanetransit.com/a/b?x=1', envWith())
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(`${SITE}/a/b?x=1`)
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
  })

  it('never redirects to a host taken from the request', async () => {
    const res = await get('https://www.brisbanetransit.com//evil.example/x', envWith())
    expect(new URL(res.headers.get('location') ?? '').host).toBe('brisbanetransit.com')
    const other = await get('https://www.brisbanetransit.com.evil.example/robots.txt', envWith())
    expect(other.status).toBe(200)
  })
})

describe('mode hubs: /ferry, /train, /bus → their /<mode>/ canonical', () => {
  const hub = (p: string) => canonicalLocation(`${SITE}${p}`, SITE)
  it('maps the bare hubs, on the same origin, query kept', () => {
    for (const m of ['ferry', 'train', 'bus']) {
      expect(hub(`/${m}`)).toBe(`${SITE}/${m}/`)
      expect(hub(`/${m}?from=a&to=b`)).toBe(`${SITE}/${m}/?from=a&to=b`)
      expect(hub(`/${m}//`)).toBe(`${SITE}/${m}/`)
      // Already canonical, a page under the hub, or its loader data: served as before (no loop).
      for (const p of [`/${m}/`, `/${m}/?x=1`, `/${m}/map`, `/${m}.data`, `/${m}x`, `/x/${m}`])
        expect(hub(p), p).toBeNull()
    }
    for (const p of ['/', '/saved', '/nearby', '/alerts', '/FERRY']) expect(hub(p), p).toBeNull()
  })

  it('301s GET and HEAD through the Worker, with the security headers; no noindex once indexable', async () => {
    const env = envWith({ INDEXABLE: '1' })
    const res = await get(`${SITE}/train?x=1`, env)
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe(`${SITE}/train/?x=1`)
    expect(res.headers.get('strict-transport-security')).toContain('max-age=')
    expect(res.headers.get('x-robots-tag')).toBeNull()
    const head = (await worker.fetch(
      new Request(`${SITE}/bus`, { method: 'HEAD' }),
      env,
      {} as ExecutionContext,
    )) as Response
    expect(head.status).toBe(301)
    expect(head.headers.get('location')).toBe(`${SITE}/bus/`)
  })

  it('other methods are not redirected (the 405 as before)', async () => {
    const res = (await worker.fetch(
      new Request(`${SITE}/ferry`, { method: 'POST' }),
      envWith(),
      {} as ExecutionContext,
    )) as Response
    expect(res.status).toBe(405)
  })
})

describe('INDEXABLE soft launch', () => {
  it('unset or "0": X-Robots-Tag noindex and robots.txt disallows all', async () => {
    for (const env of [envWith(), envWith({ INDEXABLE: '0' })]) {
      const res = await get(`${SITE}/robots.txt`, env)
      expect(res.headers.get('x-robots-tag')).toBe('noindex')
      expect(await res.text()).toBe('User-agent: *\nDisallow: /\n')
    }
  })

  it('"1" (production, release 24): no header, and robots.txt allows all but the fixtures and names the sitemap', async () => {
    const res = await get(`${SITE}/robots.txt`, envWith({ INDEXABLE: '1' }))
    expect(res.headers.get('x-robots-tag')).toBeNull()
    expect(await res.text()).toBe(
      `User-agent: *\nAllow: /\nDisallow: /__fixtures/\n\nSitemap: ${SITE}/sitemap.xml\n`,
    )
  })
})

describe('canonical page URLs (one 301: unprefixed old paths, trailing slashes, http → https)', () => {
  const loc = (u: string) => canonicalLocation(u, SITE)

  it.each([
    // The standalone apps' bare paths, cited on this host (ChatGPT) or typed: under their mode prefix.
    ['/terminal/south-bank', '/ferry/terminal/south-bank'],
    ['/terminal/south-bank/', '/ferry/terminal/south-bank'],
    ['/station/central', '/train/station/central'],
    ['/stations', '/train/stations'],
    ['/stop/1', '/bus/stop/1'],
    ['/stop/10802/', '/bus/stop/10802'],
    ['/route/66', '/bus/route/66'],
    // A padded stop number lands on the canonical unpadded page in the same hop.
    ['/stop/000001', '/bus/stop/1'],
    ['/stop/010813', '/bus/stop/10813'],
    // One canonical per page: the sitemap has no trailing slash on terminals, stations, stops and the rest.
    ['/ferry/terminal/south-bank/', '/ferry/terminal/south-bank'],
    ['/train/station/central/', '/train/station/central'],
    ['/train/stations/', '/train/stations'],
    ['/bus/stop/1/', '/bus/stop/1'],
    ['/bus/route/66/', '/bus/route/66'],
    ['/whats-new/', '/whats-new'],
    ['/saved/', '/saved'],
    ['/ferry/terminal/south-bank//', '/ferry/terminal/south-bank'],
  ])('%s → %s', (from, to) => {
    expect(loc(`${SITE}${from}`)).toBe(`${SITE}${to}`)
    expect(loc(`${SITE}${from}?utm_source=chatgpt.com&x=1`)).toBe(`${SITE}${to}?utm_source=chatgpt.com&x=1`)
    // Never a loop: the target is already canonical.
    expect(loc(`${SITE}${to}`)).toBeNull()
    expect(canonicalPagePath(to)).toBe(to)
  })

  it('leaves canonical pages, the API, client data, fixtures and React Router requests alone', () => {
    for (const p of [
      '/',
      '/ferry/',
      '/ferry/terminal/south-bank',
      '/bus/stop/1',
      '/whats-new',
      '/v1/ferry/departures/',
      '/v1/',
      '/data/bus/stops.json',
      '/api/feedback/',
      '/__fixtures/v1/x/',
      '/__manifest',
      '/ferry/terminal/south-bank.data',
      '/terminal/south-bank.data',
      '/robots.txt',
      '/llms.txt',
      '/sitemap.xml',
    ])
      expect(loc(`${SITE}${p}`), p).toBeNull()
  })

  it('the final mounted canonical in one hop, whatever needs fixing (Codex r1)', () => {
    for (const [from, to] of [
      // Padded stop numbers already under /bus: unpadded here, not left to the stop page's second 301.
      [`${SITE}/bus/stop/000001`, `${SITE}/bus/stop/1`],
      [`${SITE}/bus/stop/000001/?x=1`, `${SITE}/bus/stop/1?x=1`],
      ['http://brisbanetransit.com/bus/stop/010813', `${SITE}/bus/stop/10813`],
      // The stop directory's spelling, as its loader would 301 to.
      [`${SITE}/bus/stops/B/1/`, `${SITE}/bus/stops/b`],
      [`${SITE}/bus/stops/b/02`, `${SITE}/bus/stops/b/2`],
      [`${SITE}/bus/stops/B`, `${SITE}/bus/stops/b`],
    ])
      expect(loc(from), from).toBe(to)
    // Already canonical, or not a directory page (its loader 404s): left alone.
    for (const p of [
      '/bus/stop/0',
      '/bus/stop/0000001',
      '/bus/stops/b',
      '/bus/stops/b/2',
      '/bus/stops/bb',
      '/bus/stops/b/0',
    ])
      expect(loc(`${SITE}${p}`), p).toBeNull()
  })

  it('http → https on the canonical host only, path canonicalised in the same hop', () => {
    expect(loc('http://brisbanetransit.com/')).toBe(`${SITE}/`)
    expect(loc('http://brisbanetransit.com/ferry/?x=1')).toBe(`${SITE}/ferry/?x=1`)
    expect(loc('http://brisbanetransit.com/terminal/south-bank/')).toBe(`${SITE}/ferry/terminal/south-bank`)
    expect(loc('http://brisbanetransit.com/robots.txt')).toBe(`${SITE}/robots.txt`)
    // Plain-HTTP API and data clients keep working.
    expect(loc('http://brisbanetransit.com/v1/health')).toBeNull()
    expect(loc('http://brisbanetransit.com/data/bus/stops.json')).toBeNull()
    // Another host (local dev, workers.dev previews) keeps its own scheme and origin.
    expect(loc('http://localhost:5173/')).toBeNull()
    expect(loc('http://localhost:5173/train')).toBe('http://localhost:5173/train/')
    expect(canonicalLocation('http://brisbanetransit.com/', 'http://brisbanetransit.com')).toBeNull()
    expect(canonicalLocation('http://brisbanetransit.com/', 'not a url')).toBeNull()
  })

  it('never another host, whatever the path', () => {
    for (const p of ['//evil.example/', '//evil.example//', '/%2F%2Fevil.example/', '/\\evil.example/']) {
      const to = loc(`${SITE}${p}`)
      if (to) expect(new URL(to).host).toBe('brisbanetransit.com')
    }
  })

  it('through the Worker: one 301 for each, with the security headers and no noindex', async () => {
    const env = envWith({ INDEXABLE: '1' })
    for (const [from, to] of [
      ['https://brisbanetransit.com/terminal/south-bank?x=1', `${SITE}/ferry/terminal/south-bank?x=1`],
      ['https://brisbanetransit.com/station/central', `${SITE}/train/station/central`],
      ['https://brisbanetransit.com/stop/000001', `${SITE}/bus/stop/1`],
      ['https://brisbanetransit.com/ferry/terminal/south-bank/', `${SITE}/ferry/terminal/south-bank`],
      ['http://brisbanetransit.com/', `${SITE}/`],
      // www, http and an old path: still one hop.
      ['http://www.brisbanetransit.com/terminal/south-bank/?x=1', `${SITE}/ferry/terminal/south-bank?x=1`],
      ['http://www.brisbanetransit.com/bus/stop/000001?x=1', `${SITE}/bus/stop/1?x=1`],
    ]) {
      const res = await get(from as string, env)
      expect(res.status, from).toBe(301)
      expect(res.headers.get('location'), from).toBe(to)
      expect(res.headers.get('strict-transport-security')).toContain('max-age=')
      expect(res.headers.get('x-robots-tag')).toBeNull()
    }
  })
})

describe('old mode hosts → transit: the first Location is already canonical (one hop in all)', () => {
  // transitPath is what the train and bus hosts 301 to; canonicalLocation is transit's own 301. Composed, the second
  // must never fire, and the query must survive the first.
  it.each([
    ['bus', '/stops/B/1?x=1'],
    ['bus', '/stops/b/02?x=1'],
    ['bus', '/bus/stops/S/'],
    ['bus', '/stops'],
    ['bus', '/stop/000001?utm_source=x'],
    ['bus', '/bus/stop/010813/'],
    ['bus', '/route/66/'],
    ['bus', '/'],
    ['train', '/station/central/?a=1'],
    ['train', '/stations/'],
    ['train', '/train'],
    ['ferry', '/terminal/south-bank/?x=1'],
    ['ferry', '/ferry/terminal/bulimba'],
  ] as const)('%s %s', (mode, path) => {
    const location = transitLocation(mode, new URL(`https://old.example${path}`), SITE)
    expect(location).not.toBeNull()
    expect(location?.startsWith(`${SITE}/`)).toBe(true)
    expect(new URL(location ?? '').search).toBe(new URL(`https://old.example${path}`).search)
    expect(canonicalLocation(location ?? '', SITE)).toBeNull()
  })
})
