/**
 * Route pages (/route/{short}) render from data/bus/routes/{short}.json for a route data/bus/routes.json lists. The
 * sitemap lists that index, and the proxy holds route files and the index to the contract.
 */
import { RouterContextProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { cachedRouteIndex, ROUTE_INDEX_TTL_MS, resetRouteIndexCache } from '../app/lib/route-index.server.ts'
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

beforeEach(() => resetRouteIndexCache())
afterEach(() => vi.useRealTimers())

/**
 * An API serving the given data files (status 404 otherwise); static assets carry no data, as in production. 'fail'
 * answers 500, and 'hang' never answers until the caller aborts.
 */
function envServing(files: Record<string, unknown>, calls: string[] = []) {
  const api = async (req: Request) => {
    const path = new URL(req.url).pathname
    calls.push(path)
    const body = files[path]
    if (body === 'hang')
      return new Promise<Response>((_, reject) =>
        req.signal.addEventListener('abort', () => reject(new Error('aborted'))),
      )
    if (body === 'fail') return new Response('{"error":"boom"}', { status: 500 })
    // The edge's answer when R2 is slow (passthrough deadline), and a 200 that isn't a route file.
    if (body === 'unavailable')
      return new Response('{"error":"static data unavailable","detail":"passthrough"}', { status: 503 })
    if (body === 'hang-free-invalid') return new Response('{"patterns":{}}', { status: 200 })
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

const load = async (short: string, files: Record<string, unknown>, calls: string[] = []) => {
  const ctx = new RouterContextProvider()
  ctx.set(cloudflareContext, { env: envServing(files, calls), ctx: {} as ExecutionContext, nonce: 'n' })
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

describe('route page loader', () => {
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

  it('when the route file itself cannot be read: a 503 page state (Try again), never a thrown error', async () => {
    for (const file of ['fail', 'unavailable', 'hang-free-invalid']) {
      const r = await load('M2', { '/data/bus/routes.json': INDEX, '/data/bus/routes/M2.json': file })
      const ok = r.ok as unknown as { data: { route: unknown }; init: { status: number } }
      expect(r.status, file).toBeUndefined()
      expect(ok.init.status, file).toBe(503)
      expect(ok.data.route, file).toBeNull()
    }
  })
})

describe('route index cache', () => {
  const indexReads = (calls: string[]) => calls.filter((c) => c === '/data/bus/routes.json').length
  const files = (index: unknown) => ({
    '/data/bus/routes.json': index,
    '/data/bus/routes/M2.json': route('M2'),
  })
  const without = (short: string) => ({
    ...INDEX,
    generation: 'g2',
    routes: INDEX.routes.filter((r) => r !== short),
  })
  const loadAll = (calls: string[], fs: Record<string, unknown>) => load('M2', fs, calls)

  it('reads the index once for two renders within the time to live, and the sitemap shares it', async () => {
    const calls: string[] = []
    expect((await loadAll(calls, files(INDEX))).ok?.route.short).toBe('M2')
    expect((await loadAll(calls, files(INDEX))).ok?.route.short).toBe('M2')
    expect((await getSitemap(envServing(files(INDEX), calls)))?.status).toBe(200)
    expect(indexReads(calls)).toBe(1)
    // The route file itself is still read per render.
    expect(calls.filter((c) => c === '/data/bus/routes/M2.json')).toHaveLength(2)
  })

  it('reads a new publish once the time to live has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const calls: string[] = []
    expect((await loadAll(calls, files(INDEX))).ok).toBeTruthy()
    vi.advanceTimersByTime(ROUTE_INDEX_TTL_MS - 1)
    expect((await loadAll(calls, files(without('M2')))).ok).toBeTruthy()
    expect(indexReads(calls)).toBe(1)
    vi.advanceTimersByTime(1)
    expect((await loadAll(calls, files(without('M2')))).status).toBe(404)
    expect(indexReads(calls)).toBe(2)
  })

  it('never caches a failed, missing or invalid index', async () => {
    const calls: string[] = []
    for (const bad of ['fail', undefined, { routes: 'x' }])
      expect((await loadAll(calls, files(bad))).ok?.route.short).toBe('M2')
    expect((await getSitemap(envServing({}, calls)))?.status).toBe(503)
    expect(indexReads(calls)).toBe(4)
    // The first good answer is used and cached straight away.
    expect((await loadAll(calls, files(without('M2')))).status).toBe(404)
    expect((await getSitemap(envServing(files(INDEX), calls)))?.status).toBe(200)
    expect(indexReads(calls)).toBe(5)
  })

  it('a hung index fetch holds up only its own render, within its own budget', async () => {
    vi.useFakeTimers()
    const hungCalls: string[] = []
    let hungDone = false
    const hung = loadAll(hungCalls, files('hang')).finally(() => {
      hungDone = true
    })
    // A later render is not blocked by the hung one: it fetches for itself and fills the cache.
    const calls: string[] = []
    expect((await loadAll(calls, files(without('M2')))).status).toBe(404)
    expect(hungDone).toBe(false)
    // The hung render ends at its own 2.5 s budget, from the route file alone, and does not touch the cache.
    await vi.advanceTimersByTimeAsync(2500)
    expect((await hung).ok?.route.short).toBe('M2')
    expect((await loadAll(calls, files(INDEX))).status).toBe(404)
    expect(indexReads(calls)).toBe(1)
  })

  it('an older fetch that finishes last does not replace a newer answer', async () => {
    let finishOld: (v: typeof INDEX) => void = () => {}
    const old = cachedRouteIndex(() => new Promise((resolve) => (finishOld = resolve)))
    await new Promise((r) => setTimeout(r, 2))
    expect(await cachedRouteIndex(async () => without('M2'))).toMatchObject({ generation: 'g2' })
    finishOld(INDEX)
    expect(await old).toMatchObject({ generation: 'g' })
    expect(await cachedRouteIndex(async () => INDEX)).toMatchObject({ generation: 'g2' })
  })

  it('is bypassed for fixtures and demo data', async () => {
    let reads = 0
    const load = async () => {
      reads++
      return INDEX
    }
    await cachedRouteIndex(load, { cache: false })
    await cachedRouteIndex(load, { cache: false })
    expect(reads).toBe(2)
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
