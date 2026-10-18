/**
 * bft-transit Worker entry. Static files never reach this code: Workers static assets answer them first.
 *  - GET /v1/*, /data/*   same-origin proxy to the API Worker (service binding in staging, HTTP in dev), contract-checked
 *  - POST /v1/ask         Ask box → bft-api /v1/ask with the visitor's IP (per-IP quota) and Turnstile token
 *  - /__fixtures/*        recorded responses for fixture mode (only when ALLOW_FIXTURES or FIXTURES is "1")
 *  - /robots.txt          disallow: the mode pages' canonical copies are the standalone apps
 *  - everything else      React Router SSR. The mounted mode pages are the standalone apps' route modules, so their
 *                         loaders read their own app's context: each gets this Env with its own canonical SITE_URL.
 */
import { cloudflareContext as busContext } from '@bft/bus/app/lib/context.ts'
import { cloudflareContext as ferryContext } from '@bft/ferry/app/lib/context.ts'
import { cloudflareContext as trainContext } from '@bft/train/app/lib/context.ts'
import { createRequestHandler, RouterContextProvider } from 'react-router'
import { cloudflareContext } from '../app/lib/context.ts'
import { validateProxied } from '../app/lib/contract.server.ts'
import { fixtureAsk, handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { apiFetch } from '../app/lib/server.server.ts'

const requestHandler = createRequestHandler(
  () => import('virtual:react-router/server-build'),
  import.meta.env.MODE,
)

const noStore = { 'cache-control': 'no-store' }

export async function proxyApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  try {
    const res = await apiFetch(env, `${url.pathname}${url.search}`, { headers: { accept: 'application/json' } })
    return await validateProxied(url.pathname, res)
  } catch (error) {
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: noStore },
    )
  }
}

/** POST /v1/ask: body passed through (≤ 2 KB); the API sees the visitor's IP for its per-IP quota and Turnstile. */
export async function proxyAsk(request: Request, env: Env): Promise<Response> {
  const body = await request.text()
  if (body.length > 2048) return Response.json({ error: 'bad_request' }, { status: 413, headers: noStore })
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' }
  const ip = request.headers.get('cf-connecting-ip')
  if (ip) headers['cf-connecting-ip'] = ip
  try {
    const res = await apiFetch(env, '/v1/ask', { method: 'POST', headers, body })
    const checked = await validateProxied('/v1/ask', res)
    checked.headers.set('cache-control', 'no-store')
    return checked
  } catch (error) {
    return Response.json(
      { error: 'upstream_unavailable', detail: error instanceof Error ? error.message : String(error) },
      { status: 502, headers: noStore },
    )
  }
}

const fixturesAllowed = (env: Env) => env.ALLOW_FIXTURES === '1' || env.FIXTURES === '1'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/v1/ask' && request.method === 'POST') return proxyAsk(request, env)
    if (request.method === 'GET' && (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/data/')))
      return proxyApi(request, env)
    if (url.pathname.startsWith('/__fixtures/')) {
      if (!fixturesAllowed(env)) return new Response('Not found', { status: 404 })
      if (url.pathname === '/__fixtures/v1/ask' && request.method === 'POST') {
        const b = (await request.json().catch(() => null)) as { question?: unknown } | null
        return fixtureAsk(typeof b?.question === 'string' ? b.question : '')
      }
      return handleFixtureApi(url, Date.now(), env)
    }
    if (url.pathname === '/robots.txt')
      return new Response('User-agent: *\nDisallow: /\n', {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      })
    const context = new RouterContextProvider()
    context.set(cloudflareContext, { env, ctx })
    context.set(ferryContext, { env: { ...env, SITE_URL: env.FERRY_SITE_URL ?? env.SITE_URL }, ctx })
    context.set(trainContext, { env: { ...env, SITE_URL: env.TRAIN_SITE_URL ?? env.SITE_URL }, ctx })
    context.set(busContext, { env: { ...env, SITE_URL: env.BUS_SITE_URL ?? env.SITE_URL }, ctx })
    return requestHandler(request, context)
  },
} satisfies ExportedHandler<Env>
