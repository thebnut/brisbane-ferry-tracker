/**
 * Route pages (/route/{short}) render from data/bus/routes/{short}.json for a route data/bus/routes.json lists. The
 * sitemap lists that index, and the proxy holds route files and the index to the contract.
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { loader } from '../app/routes/route.tsx'
import { sitemap } from '../workers/app.ts'

const INDEX = { schemaVersion: 1, mode: 'bus', generation: 'g', routes: ['66', 'a/b', 'M2'] }
const route = (short: string) => ({
  schemaVersion: 1,
  mode: 'bus',
  generation: 'g',
  short,
  patterns: [
    {
      directionId: 0,
      headsign: 'RBWH',
      trips: 300,
      stops: [{ key: '1', name: 'UQ Lakes', code: '001001', lat: -27.49, lon: 153.01 }],
    },
  ],
})

/** An API serving the given data files (status 404 otherwise); static assets carry no data, as in production. */
function envServing(files: Record<string, unknown>, calls: string[] = []) {
  const api = async (req: Request) => {
    const path = new URL(req.url).pathname
    calls.push(path)
    const body = files[path]
    if (body === 'fail') return new Response('{"error":"boom"}', { status: 500 })
    return body
      ? new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })
      : new Response('{"error":"not found"}', { status: 404 })
  }
  return {
    SITE_URL: 'https://bus.test',
    API_BASE: 'https://api.test',
    FIXTURES: '0',
    ASSETS: { fetch: async () => new Response('', { status: 404 }) },
    API: { fetch: api },
  } as unknown as Env
}
const getSitemap = (env: Env) => sitemap(new URL('https://bus.test/sitemaps/routes.xml'), env)

describe('sitemaps/routes.xml', () => {
  it('lists the routes in the route index, skipping short names the route page rejects', async () => {
    const calls: string[] = []
    const res = await getSitemap(envServing({ '/data/bus/routes.json': INDEX }, calls))
    expect(res?.status).toBe(200)
    expect(((await res?.text()) ?? '').match(/<loc>[^<]+<\/loc>/g)).toEqual([
      '<loc>https://bus.test/route/66</loc>',
      '<loc>https://bus.test/route/M2</loc>',
    ])
    // One small file, no probing of route files.
    expect(calls).toEqual(['/data/bus/routes.json'])
  })

  it('is a 503, not a list of 404 pages, while the published data has no route index', async () => {
    expect((await getSitemap(envServing({ '/data/bus/lines.json': '{}' })))?.status).toBe(503)
  })

  it('is a 503 for an index that fails the contract or is not JSON', async () => {
    expect((await getSitemap(envServing({ '/data/bus/routes.json': { routes: 'x' } })))?.status).toBe(503)
    expect((await getSitemap(envServing({ '/data/bus/routes.json': '<html>' })))?.status).toBe(503)
  })
})

describe('route page loader', () => {
  const load = async (short: string, files: Record<string, unknown>) => {
    const ctx = new RouterContextProvider()
    ctx.set(cloudflareContext, { env: envServing(files), ctx: {} as ExecutionContext, nonce: 'n' })
    const args = {
      request: new Request(`https://bus.test/route/${short}`),
      context: ctx,
      params: { route: short },
    }
    try {
      return { ok: await loader(args as unknown as Parameters<typeof loader>[0]) }
    } catch (thrown) {
      return { status: (thrown as { init?: { status?: number } }).init?.status }
    }
  }

  it('renders a current route from its route file', async () => {
    const r = await load('M2', { '/data/bus/routes.json': INDEX, '/data/bus/routes/M2.json': route('M2') })
    expect(r.ok?.route.short).toBe('M2')
  })

  it('is a 404 for a route file left over from an older feed (not in the index)', async () => {
    const r = await load('999', { '/data/bus/routes.json': INDEX, '/data/bus/routes/999.json': route('999') })
    expect(r.status).toBe(404)
  })

  it('is a 404 for a listed route whose file is missing, and for an unknown route', async () => {
    expect((await load('66', { '/data/bus/routes.json': INDEX })).status).toBe(404)
    expect((await load('nope', {})).status).toBe(404)
  })

  it('without a readable index, the route file alone decides', async () => {
    const r = await load('M2', { '/data/bus/routes.json': 'fail', '/data/bus/routes/M2.json': route('M2') })
    expect(r.ok?.route.short).toBe('M2')
  })

  it('is a 503 when the route file itself cannot be read', async () => {
    expect(
      (await load('M2', { '/data/bus/routes.json': INDEX, '/data/bus/routes/M2.json': 'fail' })).status,
    ).toBe(503)
  })
})

describe('route data proxy contract', () => {
  it('passes a contract-valid route file and route index', async () => {
    const r = await validateProxied('/data/bus/routes/66.json', Response.json(route('66')))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual(route('66'))
    expect((await validateProxied('/data/bus/routes.json', Response.json(INDEX))).status).toBe(200)
  })
  it('turns a malformed route file or index into a 502 contract mismatch', async () => {
    const bad = { ...route('66'), patterns: [{ directionId: 0 }] }
    expect((await validateProxied('/data/bus/routes/66.json', Response.json(bad))).status).toBe(502)
    expect((await validateProxied('/data/bus/routes.json', Response.json(route('66')))).status).toBe(502)
  })
  it('keeps a missing route a bodiless 404 (the page answers its own 404)', async () => {
    const res = await validateProxied(
      '/data/bus/routes/66.json',
      Response.json({ error: 'x' }, { status: 404 }),
    )
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
})
