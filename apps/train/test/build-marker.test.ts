// @vitest-environment node
/** x-bft-build on every Worker response (HTML, the /v1 proxy and errors), through the Worker's fetch handler. */
import { describe, expect, it, vi } from 'vitest'
import worker from '../workers/app.ts'

vi.mock('virtual:react-router/server-build', () => ({}))
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }))
// SSR stands in for React Router: any HTML page.
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  createRequestHandler: () => async (request: Request) => {
    if (new URL(request.url).pathname === '/throw') throw new Error('boom')
    return new Response('<!doctype html><title>t</title>', {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
}))

const SHA = '1a2b3c4'
const SITE = 'https://brisbanetrain.com'
/** The API answers with its own marker, which the app must replace with its own. */
const api = (answer: () => Response | Promise<Response>) =>
  ({ fetch: vi.fn(async () => answer()) }) as unknown as Fetcher
const envWith = (vars: Record<string, unknown> = {}) =>
  ({
    SITE_URL: SITE,
    API_BASE: 'http://x',
    ALLOW_FIXTURES: '0',
    FIXTURES: '0',
    BUILD_SHA: SHA,
    API: api(() => Response.json({ ok: true }, { headers: { 'x-bft-build': 'fffffff' } })),
    ...vars,
  }) as unknown as Env
const get = (path: string, env: Env) =>
  worker.fetch(new Request(`${SITE}${path}`), env, {} as ExecutionContext) as Promise<Response>

describe('x-bft-build', () => {
  it('is on HTML pages', async () => {
    const res = await get('/', envWith())
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('x-bft-build')).toBe(SHA)
  })

  it("is on /v1 proxy responses, as this Worker's build (not the API's)", async () => {
    const res = await get('/v1/health', envWith())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-bft-build')).toBe(SHA)
  })

  it('is on errors: an unreachable API (502) and a 404', async () => {
    const down = envWith({ API: api(() => Promise.reject(new Error('down'))) })
    const bad = await get('/v1/health', down)
    expect(bad.status).toBe(502)
    expect(bad.headers.get('x-bft-build')).toBe(SHA)
    const missing = await get('/__fixtures/v1/alerts', envWith())
    expect(missing.status).toBe(404)
    expect(missing.headers.get('x-bft-build')).toBe(SHA)
  })

  it('is on a thrown error too: a generic 500 with the security headers, not the platform error page', async () => {
    const res = await get('/throw', envWith())
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Internal error')
    expect(res.headers.get('x-bft-build')).toBe(SHA)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('is on a malformed trip WebSocket path (the router throws URIError)', async () => {
    const env = envWith({ TRIP_WS: '1', TRIP_SOCKET: { idFromName: vi.fn(), get: vi.fn() } })
    const res = await get('/v1/train/trips/%ZZ/ws', env)
    expect(res.status).toBe(500)
    expect(res.headers.get('x-bft-build')).toBe(SHA)
  })

  it('is "dev" without BUILD_SHA, and never echoes a value that is not a sha', async () => {
    expect((await get('/', envWith({ BUILD_SHA: undefined }))).headers.get('x-bft-build')).toBe('dev')
    for (const junk of ['main', 'feat/x', '/Users/brett', '1a2b3c4 host', '1A2B3C4'])
      expect((await get('/', envWith({ BUILD_SHA: junk }))).headers.get('x-bft-build'), junk).toBe('dev')
    expect((await get('/', envWith({ BUILD_SHA: `${SHA}-dirty` }))).headers.get('x-bft-build')).toBe(
      `${SHA}-dirty`,
    )
  })
})
