/**
 * bft-train Worker entry. Static files (JS, CSS, icons, data/train/*.json) never reach this code: Workers static
 * assets answer them first.
 *  - /v1/*            same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - /__fixtures/v1/* recorded /v1 responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /sitemap.xml     home, stations, alerts and all 154 station pages
 *  - /robots.txt      disallows everything unless INDEXABLE is "1" (staging stays out of search)
 *  - everything else  React Router SSR
 */
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { robotsTxt, sitemapXml } from '../app/lib/seo.ts'
import { siteInfo } from '../app/lib/server.server.ts'
import { newNonce, withSecurityHeaders, wsOriginOf } from './security.ts'
import { routeTripSocket } from './tripSocket.ts'

export { TripSocket } from './tripSocket.ts'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const target = `${url.pathname}${url.search}`
  const init: RequestInit = { method: 'GET', headers: { accept: 'application/json' } }
  try {
    const res = env.API
      ? await env.API.fetch(new Request(`https://bft-api${target}`, init))
      : await fetch(`${env.API_BASE}${target}`, init)
    // Contract check at the edge, so the browser can trust the shape without shipping zod.
    return await validateProxied(url.pathname, res)
  } catch (error) {
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    const nonce = newNonce()
    const socket = routeTripSocket(request, env)
    const res = socket ? await socket : await route(request, env, ctx, nonce)
    // A WebSocket upgrade (101) goes back untouched: a Response can't be rebuilt with status 101 or its webSocket.
    if (res.status === 101) return res
    return withSecurityHeaders(res, nonce, wsOriginOf(env.API_WS_BASE))
  },
} satisfies ExportedHandler<Env>

async function route(request: Request, env: Env, ctx: ExecutionContext, nonce: string): Promise<Response> {
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname.startsWith('/v1/')) return proxyApi(request, env)
  if (url.pathname.startsWith('/__fixtures/v1/')) {
    if (env.ALLOW_FIXTURES !== '1' && env.FIXTURES !== '1') return new Response('Not found', { status: 404 })
    return handleFixtureApi(url, Date.now())
  }
  const site = siteInfo(env)
  if (url.pathname === '/sitemap.xml') {
    return new Response(sitemapXml(site.siteUrl, Date.now()), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  }
  if (url.pathname === '/robots.txt') {
    return new Response(robotsTxt(site.siteUrl, site.indexable), {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    })
  }
  const context = new RouterContextProvider()
  context.set(cloudflareContext, { env, ctx, nonce })
  return requestHandler(request, context)
}
