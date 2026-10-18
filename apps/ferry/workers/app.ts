/**
 * bft-ferry Worker entry. Static files never reach this code (Workers static assets answer them first).
 *  - /v1/*            same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - /__fixtures/v1/* recorded /v1 responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /api/gtfs-proxy, /api/feedback  legacy endpoints for old iOS builds and the legacy app (workers/legacy.ts)
 *  - /sitemap.xml     generated, same URLs as the legacy postbuild sitemap
 *  - everything else  React Router SSR
 */
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { sitemapXml } from '../app/lib/seo.ts'
import { handleLegacy } from './legacy.ts'

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
    if (res.status >= 500 && env.FIXTURE_FALLBACK === '1') return handleFixtureApi(url, Date.now())
    // Contract check at the edge, so the browser can trust the shape without shipping zod.
    return await validateProxied(url.pathname, res)
  } catch (error) {
    if (env.FIXTURE_FALLBACK === '1') return handleFixtureApi(url, Date.now())
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const legacy = await handleLegacy(request, env)
    if (legacy) return legacy
    if (request.method === 'GET' && url.pathname.startsWith('/v1/')) return proxyApi(request, env)
    if (url.pathname.startsWith('/__fixtures/v1/')) {
      if (env.ALLOW_FIXTURES !== '1' && env.FIXTURES !== '1')
        return new Response('Not found', { status: 404 })
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
    context.set(cloudflareContext, { env, ctx })
    return requestHandler(request, context)
  },
} satisfies ExportedHandler<Env>
