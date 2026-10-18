/**
 * bft-bus Worker entry. Static files (including /data/bus/* when the build carries it) never reach this code:
 * Workers static assets answer them first.
 *  - /v1/*, /data/bus/*  same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - /__fixtures/*       recorded responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /sitemap.xml        sitemap index; /sitemaps/{pages,routes,stops-n}.xml from the client data
 *  - /robots.txt
 *  - everything else     React Router SSR
 */
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import {
  robotsTxt,
  routeShortsFromLinesText,
  STOPS_PER_SITEMAP,
  sitemapIndexXml,
  stopKeysFromIndexText,
  urlsetXml,
} from '../app/lib/seo.ts'
import { routePath, stopPath } from '../app/lib/stops.ts'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

async function upstream(env: Env, target: string): Promise<Response> {
  const init: RequestInit = { method: 'GET', headers: { accept: 'application/json' } }
  return env.API
    ? env.API.fetch(new Request(`https://bft-api${target}`, init))
    : fetch(`${env.API_BASE}${target}`, init)
}

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  try {
    const res = await upstream(env, `${url.pathname}${url.search}`)
    if (res.status >= 500 && env.FIXTURE_FALLBACK === '1') return handleFixtureApi(url, Date.now(), env)
    // Contract check at the edge, so the browser can trust the shape without shipping zod.
    return await validateProxied(url.pathname, res)
  } catch (error) {
    if (env.FIXTURE_FALLBACK === '1') return handleFixtureApi(url, Date.now(), env)
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
    env.FIXTURES === '1' || env.FIXTURE_FALLBACK === '1'
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

async function sitemap(url: URL, env: Env): Promise<Response | null> {
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
    const text = await dataText(env, '/data/bus/lines.json')
    if (!text) return new Response('Unavailable', { status: 503 })
    const paths = routeShortsFromLinesText(text).map(routePath)
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
    const url = new URL(request.url)
    if (
      request.method === 'GET' &&
      (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/data/bus/'))
    )
      return proxyApi(request, env)
    if (url.pathname.startsWith('/__fixtures/')) {
      if (!fixturesAllowed(env)) return new Response('Not found', { status: 404 })
      return handleFixtureApi(url, Date.now(), env)
    }
    if (url.pathname === '/robots.txt')
      return new Response(robotsTxt(env.SITE_URL), {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    if (url.pathname === '/sitemap.xml' || url.pathname.startsWith('/sitemaps/')) {
      const res = await sitemap(url, env)
      if (res) return res
    }
    const context = new RouterContextProvider()
    context.set(cloudflareContext, { env, ctx })
    return requestHandler(request, context)
  },
} satisfies ExportedHandler<Env>
