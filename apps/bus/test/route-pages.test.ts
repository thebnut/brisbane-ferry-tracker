/**
 * Route pages (/route/{short}) render from data/bus/routes/{short}.json. The sitemap lists only routes whose page
 * renders, and the proxy holds route files to the contract.
 */
import { describe, expect, it } from 'vitest'
import { validateProxied } from '../app/lib/contract.server.ts'
import { sitemap } from '../workers/app.ts'

const LINES = JSON.stringify({
  schemaVersion: 1,
  mode: 'bus',
  generation: 'g',
  lines: [{ short: '66' }, { short: 'a/b' }, { short: 'M2' }],
})
const ROUTE = {
  schemaVersion: 1,
  mode: 'bus',
  generation: 'g',
  short: '66',
  patterns: [
    {
      directionId: 0,
      headsign: 'RBWH',
      trips: 300,
      stops: [{ key: '1', name: 'UQ Lakes', code: '001001', lat: -27.49, lon: 153.01 }],
    },
  ],
}

/** An API serving lines.json and the given route files; static assets carry no data (as in production). */
function envServing(files: Record<string, string>, calls: string[] = []) {
  const api = async (req: Request) => {
    const path = new URL(req.url).pathname
    calls.push(path)
    const body = files[path]
    return body ? new Response(body, { status: 200 }) : new Response('{"error":"not found"}', { status: 404 })
  }
  return {
    SITE_URL: 'https://bus.test',
    API_BASE: 'https://api.test',
    FIXTURES: '0',
    ASSETS: { fetch: async () => new Response('', { status: 404 }) },
    API: { fetch: api },
  } as unknown as Env
}
const get = (env: Env) => sitemap(new URL('https://bus.test/sitemaps/routes.xml'), env)

describe('sitemaps/routes.xml', () => {
  it('lists the routes whose page renders, skipping short names the route page rejects', async () => {
    const calls: string[] = []
    const res = await get(
      envServing({ '/data/bus/lines.json': LINES, '/data/bus/routes/66.json': JSON.stringify(ROUTE) }, calls),
    )
    expect(res?.status).toBe(200)
    const xml = (await res?.text()) ?? ''
    expect(xml.match(/<loc>[^<]+<\/loc>/g)).toEqual([
      '<loc>https://bus.test/route/66</loc>',
      '<loc>https://bus.test/route/M2</loc>',
    ])
    // One probe, not one request per route.
    expect(calls).toEqual(['/data/bus/lines.json', '/data/bus/routes/66.json'])
  })

  it('is a 503, not a list of 404 pages, while the published data has no route files yet', async () => {
    const res = await get(envServing({ '/data/bus/lines.json': LINES }))
    expect(res?.status).toBe(503)
  })

  it('is a 503 without lines.json', async () => {
    expect((await get(envServing({})))?.status).toBe(503)
  })
})

describe('route file proxy contract', () => {
  const path = '/data/bus/routes/66.json'
  it('passes a contract-valid route file', async () => {
    const res = await validateProxied(path, Response.json(ROUTE))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(ROUTE)
  })
  it('turns a malformed route file into a 502 contract mismatch', async () => {
    const res = await validateProxied(path, Response.json({ ...ROUTE, patterns: [{ directionId: 0 }] }))
    expect(res.status).toBe(502)
  })
  it('keeps a missing route a bodiless 404 (the page answers its own 404)', async () => {
    const res = await validateProxied(path, Response.json({ error: 'not found' }, { status: 404 }))
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('')
  })
})
