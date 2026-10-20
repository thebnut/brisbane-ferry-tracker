/**
 * bft-bus Worker entry. Static files (including /data/bus/* when the build carries it) never reach this code:
 * Workers static assets answer them first.
 *  - /v1/*, /data/bus/*  same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - /__fixtures/*       recorded responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /sitemap.xml        sitemap index; /sitemaps/{pages,routes,stops-n}.xml from the client data
 *  - /robots.txt        disallows everything unless INDEXABLE is "1"
 *  - www.<SITE_URL host> 301 to SITE_URL (path and query kept); unless INDEXABLE is "1" every response is X-Robots-Tag: noindex
 *  - REDIRECT_TO_TRANSIT "1": page navigations 302/301 to the same page on TRANSIT_SITE_URL (@bft/ui/redirect)
 *  - everything else     React Router SSR
 */

import { withBuild } from '@bft/core/build'
import { ROUTE_SHORT_RE, RouteIndexFile } from '@bft/core/contract'
import { DEMO_HEADER } from '@bft/ui/connectivity'
import { transitRedirect } from '@bft/ui/redirect'
import { proxied } from '@bft/ui/upstream'
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { cachedRouteIndex } from '../app/lib/route-index.server.ts'
import {
  robotsTxt,
  STOPS_PER_SITEMAP,
  sitemapIndexXml,
  stopKeysFromIndexText,
  urlsetXml,
} from '../app/lib/seo.ts'
import { fixtureFallbackOn, isFixtureMode } from '../app/lib/server.server.ts'
import { routePath, stopPath } from '../app/lib/stops.ts'
import {
  canonicalRedirect,
  newNonce,
  withRobotsTag,
  withSecurityHeaders,
  wwwRedirectLocation,
} from './security.ts'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

async function upstream(env: Env, target: string, signal?: AbortSignal): Promise<Response> {
  const init: RequestInit = { method: 'GET', headers: { accept: 'application/json' }, signal }
  return env.API
    ? env.API.fetch(new Request(`https://bft-api${target}`, init))
    : fetch(`${env.API_BASE}${target}`, init)
}

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  try {
    // One deadline for headers, body and contract check, and the visitor's abort reaches the API (R8-F1).
    return await proxied(request, async (signal) => {
      const res = await upstream(env, `${url.pathname}${url.search}`, signal)
      if (res.status >= 500 && fixtureFallbackOn(env)) return handleFixtureApi(url, Date.now(), env)
      // Contract check at the edge, so the browser can trust the shape without shipping zod.
      return validateProxied(url.pathname, res)
    })
  } catch (error) {
    if (fixtureFallbackOn(env)) return handleFixtureApi(url, Date.now(), env)
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: { 'cache-control': 'no-store' } },
    )
  }
}

const fixturesAllowed = (env: Env) => env.ALLOW_FIXTURES === '1' || env.FIXTURES === '1'

/** Raw text of a client-data file: the build's static copy, else fixtures (when forced), else the API. */
async function dataText(env: Env, path: string): Promise<string | null> {
  const local = await env.ASSETS.fetch(new Request(`https://assets${path}`))
  if (local.ok) return local.text()
  const res =
    env.FIXTURES === '1' || fixtureFallbackOn(env)
      ? await handleFixtureApi(new URL(`https://fixtures/__fixtures${path}`), Date.now(), env)
      : await upstream(env, path).catch(() => null)
  return res?.ok ? res.text() : null
}

const xml = (body: string, maxAge = 86400) =>
  new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
    },
  })

/** The safe short names in the route index (isolate-cached, as for route pages), or null when there is no valid index. */
async function routeIndexShorts(env: Env): Promise<string[] | null> {
  const load = async () => {
    const text = await dataText(env, '/data/bus/routes.json')
    if (!text) throw new Error('no route index')
    return RouteIndexFile.parse(JSON.parse(text))
  }
  try {
    const index = await cachedRouteIndex(load, { cache: env.FIXTURES !== '1' && !fixtureFallbackOn(env) })
    return index.routes.filter((s) => ROUTE_SHORT_RE.test(s))
  } catch {
    return null
  }
}

export async function sitemap(url: URL, env: Env): Promise<Response | null> {
  const site = env.SITE_URL
  if (url.pathname === '/sitemap.xml') {
    const text = await dataText(env, '/data/bus/stops.json')
    const count = text ? stopKeysFromIndexText(text).length : 0
    return xml(sitemapIndexXml(site, count, Date.now()), 3600)
  }
  if (url.pathname === '/sitemaps/pages.xml')
    return xml(
      urlsetXml(site, ['/', '/nearby', '/alerts', '/map', '/about'], {
        changefreq: 'daily',
        priority: '0.6',
      }),
    )
  if (url.pathname === '/sitemaps/routes.xml') {
    // Only routes whose page renders: data/bus/routes.json names the route files of the current publish (uploaded
    // after them) and the route page is a 404 for any other name. Without it (data published before route files
    // existed, or unreadable), a 503 tells crawlers to come back later rather than a list of 404 pages.
    const shorts = await routeIndexShorts(env)
    if (!shorts) return new Response('Unavailable', { status: 503 })
    const paths = shorts.map(routePath)
    return xml(urlsetXml(site, paths, { changefreq: 'weekly', priority: '0.5' }))
  }
  const m = /^\/sitemaps\/stops-(\d+)\.xml$/.exec(url.pathname)
  if (m) {
    const text = await dataText(env, '/data/bus/stops.json')
    if (!text) return new Response('Unavailable', { status: 503 })
    const n = Number(m[1])
    const keys = stopKeysFromIndexText(text).slice((n - 1) * STOPS_PER_SITEMAP, n * STOPS_PER_SITEMAP)
    if (n < 1 || keys.length === 0) return new Response('Not found', { status: 404 })
    return xml(urlsetXml(site, keys.map(stopPath), { changefreq: 'daily', priority: '0.7' }))
  }
  return null
}

export default {
  async fetch(request, env, ctx) {
    const nonce = newNonce()
    const www = wwwRedirectLocation(request.url, env.SITE_URL)
    const res = www ? canonicalRedirect(www) : await guarded(() => route(request, env, ctx, nonce))
    return withBuild(withRobotsTag(withSecurityHeaders(res, nonce), env.INDEXABLE === '1'), env.BUILD_SHA)
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
  const moved = env.REDIRECT_TO_TRANSIT === '1' ? transitRedirect(request, 'bus', env, nonce) : null
  if (moved) return moved
  const url = new URL(request.url)
  if (request.method === 'GET' && (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/data/bus/')))
    return proxyApi(request, env)
  if (url.pathname.startsWith('/__fixtures/')) {
    if (!fixturesAllowed(env)) return new Response('Not found', { status: 404 })
    return handleFixtureApi(url, Date.now(), env)
  }
  if (url.pathname === '/robots.txt')
    return new Response(robotsTxt(env.SITE_URL, env.INDEXABLE === '1'), {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  if (url.pathname === '/sitemap.xml' || url.pathname.startsWith('/sitemaps/')) {
    const res = await sitemap(url, env)
    if (res) return res
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
