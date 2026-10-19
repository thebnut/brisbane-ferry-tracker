/**
 * bft-train Worker entry. Static files (JS, CSS, icons, data/train/*.json) never reach this code: Workers static
 * assets answer them first.
 *  - /v1/*            same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - /__fixtures/v1/* recorded /v1 responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /sitemap.xml     home, stations, alerts and all 154 station pages
 *  - /robots.txt      disallows everything unless INDEXABLE is "1" (staging stays out of search)
 *  - www.<SITE_URL host> 301 to SITE_URL (path and query kept); unless INDEXABLE is "1" every response is X-Robots-Tag: noindex
 *  - everything else  React Router SSR
 */

import { withBuild } from '@bft/core/build'
import { DEMO_HEADER } from '@bft/ui/connectivity'
import { proxied } from '@bft/ui/upstream'
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { robotsTxt, sitemapXml } from '../app/lib/seo.ts'
import { isFixtureMode, siteInfo } from '../app/lib/server.server.ts'
import {
  canonicalRedirect,
  newNonce,
  withRobotsTag,
  withSecurityHeaders,
  wsOriginOf,
  wwwRedirectLocation,
} from './security.ts'
import { routeTripSocket } from './tripSocket.ts'

export { TripSocket } from './tripSocket.ts'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const target = `${url.pathname}${url.search}`
  try {
    // One deadline for headers, body and contract check, and the visitor's abort reaches the API (R8-F1).
    return await proxied(request, async (signal) => {
      const init: RequestInit = { method: 'GET', headers: { accept: 'application/json' }, signal }
      const res = env.API
        ? await env.API.fetch(new Request(`https://bft-api${target}`, init))
        : await fetch(`${env.API_BASE}${target}`, init)
      // Contract check at the edge, so the browser can trust the shape without shipping zod.
      return validateProxied(url.pathname, res)
    })
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
    const www = wwwRedirectLocation(request.url, env.SITE_URL)
    const res = www
      ? canonicalRedirect(www)
      : await guarded(() => routeTripSocket(request, env) ?? route(request, env, ctx, nonce))
    // A WebSocket upgrade (101) goes back untouched: a Response can't be rebuilt with status 101 or its webSocket.
    // TripSocket sets x-bft-build on it itself.
    if (res.status === 101) return res
    return withBuild(
      withRobotsTag(withSecurityHeaders(res, nonce, wsOriginOf(env.API_WS_BASE)), siteInfo(env).indexable),
      env.BUILD_SHA,
    )
  },
} satisfies ExportedHandler<Env>

async function guarded(handle: () => Promise<Response>): Promise<Response> {
  try {
    return await handle()
  } catch (error) {
    // A throw would become Cloudflare's own error page, without the security headers or the build marker.
    console.error('worker error', error instanceof Error ? error.message : String(error))
    return new Response('Internal error', {
      status: 500,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
}

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
  const res = await requestHandler(request, context)
  // A visitor's demo session (not FIXTURES=1 for everyone): marked so no cache keeps it (R7-B1).
  if (env.FIXTURES === '1' || !isFixtureMode(request, env)) return res
  const marked = new Response(res.body, res)
  marked.headers.set(DEMO_HEADER, '1')
  marked.headers.set('cache-control', 'private, no-store')
  return marked
}
