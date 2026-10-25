/**
 * bft-ferry Worker entry. Static files never reach this code (Workers static assets answer them first).
 *  - /v1/*            same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - /__fixtures/v1/* recorded /v1 responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /api/gtfs-proxy, /api/feedback  legacy endpoints for old iOS builds and the legacy app (workers/legacy.ts)
 *  - /sitemap.xml     generated, same URLs as the legacy postbuild sitemap
 *  - REDIRECT_TO_TRANSIT "1": page navigations 302/301 to the same page on TRANSIT_SITE_URL (@bft/ui/redirect)
 *  - everything else  React Router SSR
 */

import { withBuild } from '@bft/core/build'
import { gaId } from '@bft/ui/analytics-config'
import { DEMO_HEADER } from '@bft/ui/connectivity'
import { transitRedirect } from '@bft/ui/redirect'
import { proxied } from '@bft/ui/upstream'
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { sitemapXml } from '../app/lib/seo.ts'
import { fixtureFallbackOn, isFixtureMode } from '../app/lib/server.server.ts'
import { handleLegacy } from './legacy.ts'
import { newNonce, withSecurityHeaders } from './security.ts'

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
      if (res.status >= 500 && fixtureFallbackOn(env)) return handleFixtureApi(url, Date.now())
      // Contract check at the edge, so the browser can trust the shape without shipping zod.
      return validateProxied(url.pathname, res)
    })
  } catch (error) {
    if (fixtureFallbackOn(env)) return handleFixtureApi(url, Date.now())
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    const nonce = newNonce()
    return withBuild(
      withSecurityHeaders(
        await guarded(() => route(request, env, ctx, nonce)),
        nonce,
        gaId(env.GA_MEASUREMENT_ID) != null,
      ),
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
  // P6: page navigations move to BrisbaneTransit when REDIRECT_TO_TRANSIT is "1" (APIs, data and static files never);
  // a browser's first visit gets the favourites handoff page instead (P6b).
  const moved = env.REDIRECT_TO_TRANSIT === '1' ? transitRedirect(request, 'ferry', env, nonce) : null
  if (moved) return moved
  const url = new URL(request.url)
  const legacy = await handleLegacy(request, env)
  if (legacy) return legacy
  if (request.method === 'GET' && url.pathname.startsWith('/v1/')) return proxyApi(request, env)
  if (url.pathname.startsWith('/__fixtures/v1/')) {
    if (env.ALLOW_FIXTURES !== '1' && env.FIXTURES !== '1') return new Response('Not found', { status: 404 })
    return handleFixtureApi(url, Date.now())
  }
  if (url.pathname === '/sitemap.xml') {
    return new Response(sitemapXml(env.SITE_URL, Date.now()), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
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
